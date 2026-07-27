"""Hardened Docker runner for sandbox jobs."""

from __future__ import annotations

import contextlib
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.app.core.config import get_settings
from backend.sandbox_worker.profiles import list_sandbox_images, resolve_sandbox_image

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class DockerRunResult:
    exit_code: int
    stdout: str
    stderr: str
    artifact_paths: list[str]
    container_id: str | None = None
    timed_out: bool = False
    cancelled: bool = False


class DockerSandboxRunner:
    """Run ephemeral containers with hardened defaults (runc or runsc)."""

    def __init__(self) -> None:
        self.settings = get_settings()

    @staticmethod
    def _ensure_image(client: Any, image: str) -> None:
        """Pull the sandbox image if it is not already present on the Docker host."""
        import docker

        try:
            client.images.get(image)
            return
        except docker.errors.ImageNotFound:
            pass

        logger.info("pulling sandbox image %s", image)
        try:
            client.images.pull(image)
        except Exception as exc:
            raise RuntimeError(
                f"Sandbox image {image!r} is not available and could not be pulled: {exc}"
            ) from exc

        try:
            client.images.get(image)
        except docker.errors.ImageNotFound as exc:
            raise RuntimeError(f"Sandbox image {image!r} is still missing after pull") from exc

    @staticmethod
    def ensure_default_images(client: Any | None = None) -> None:
        """Pre-pull configured python/bash sandbox images (best-effort at worker startup)."""
        settings = get_settings()
        try:
            import docker
        except ImportError as exc:
            raise RuntimeError("docker package is required for sandbox-worker") from exc

        own_client = client is None
        if own_client:
            client = docker.from_env()
        try:
            for image in list_sandbox_images(settings):
                DockerSandboxRunner._ensure_image(client, image)
        finally:
            if own_client:
                client.close()

    @staticmethod
    def kill_containers(container_ids: list[str]) -> None:
        """Force-remove orphan containers left by a dead worker (best-effort)."""
        if not container_ids:
            return
        try:
            import docker
        except ImportError:
            logger.warning("docker package missing; cannot kill orphans %s", container_ids)
            return
        client = docker.from_env()
        for cid in container_ids:
            try:
                container = client.containers.get(cid)
                container.remove(force=True)
                logger.info("killed orphan container %s", cid[:12])
            except Exception as exc:
                logger.warning("failed to kill orphan %s: %s", cid[:12], exc)

    def run_job(
        self,
        *,
        job_id: str,
        language: str,
        script: str,
        timeout_sec: int,
        profile: str | None = None,
        cancel_check: Callable[[], bool] | None = None,
        on_container_id: Callable[[str], None] | None = None,
        heartbeat: Callable[[], bool] | None = None,
        heartbeat_sec: float | None = None,
    ) -> DockerRunResult:
        settings = self.settings
        workspace_root = Path(settings.agent_workspace_dir).resolve()
        job_dir = workspace_root / "jobs" / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        script_name = "main.py" if language == "python" else "main.sh"
        script_path = job_dir / script_name
        script_path.write_text(script, encoding="utf-8")
        if language == "bash":
            script_path.chmod(0o755)

        try:
            image = resolve_sandbox_image(settings, language=language, profile=profile)
        except ValueError as exc:
            raise RuntimeError(str(exc)) from exc
        # Paths inside the sandbox container (volume mount root = /agent_workspace).
        sandbox_job_dir = f"/agent_workspace/jobs/{job_id}"
        command = (
            ["python", f"{sandbox_job_dir}/{script_name}"]
            if language == "python"
            else ["bash", f"{sandbox_job_dir}/{script_name}"]
        )

        try:
            import docker
            from docker.types import Mount
        except ImportError as exc:
            raise RuntimeError("docker package is required for sandbox-worker") from exc

        client = docker.from_env()
        runtime = settings.sandbox_runtime
        normalized_profile = (profile or "default").strip().lower()
        mem_limit = (
            settings.sandbox_playwright_memory_limit
            if normalized_profile == "playwright"
            else settings.sandbox_memory_limit
        )
        host_config_kwargs: dict[str, Any] = {
            "network_mode": "none" if not settings.sandbox_allow_network else "bridge",
            "mem_limit": mem_limit,
            "nano_cpus": int(settings.sandbox_cpu_limit * 1e9),
            "pids_limit": settings.sandbox_pids_limit,
            "cap_drop": ["ALL"],
            "security_opt": ["no-new-privileges:true"],
            "read_only": True,
            "tmpfs": {"/tmp": "rw,noexec,nosuid,size=128m"},
        }
        if normalized_profile == "playwright":
            host_config_kwargs["shm_size"] = settings.sandbox_playwright_shm_size

        volume_name = (settings.sandbox_workspace_volume or "").strip()
        mounts: list[Any] = []
        if volume_name:
            # Named volume is visible to the Docker daemon (unlike container-local bind paths).
            mounts.append(
                Mount(
                    target="/agent_workspace",
                    source=volume_name,
                    type="volume",
                    read_only=False,
                )
            )
        else:
            # Local/dev fallback when not running under compose.
            host_config_kwargs["binds"] = {str(job_dir): {"bind": sandbox_job_dir, "mode": "rw"}}

        create_kwargs: dict[str, Any] = {
            "image": image,
            "command": command,
            "user": settings.sandbox_user,
            "working_dir": sandbox_job_dir,
            "detach": True,
            **host_config_kwargs,
        }
        if mounts:
            create_kwargs["mounts"] = mounts
        if runtime and runtime != "runc":
            create_kwargs["runtime"] = runtime

        container = None
        timed_out = False
        cancelled = False
        exit_code = 1
        stdout = ""
        stderr = ""
        container_id: str | None = None
        stop_watch = threading.Event()

        def _watch_cancel_and_heartbeat() -> None:
            nonlocal cancelled
            interval = (
                heartbeat_sec if heartbeat_sec is not None else settings.sandbox_job_heartbeat_sec
            )
            next_beat = time.monotonic()
            while not stop_watch.wait(0.5):
                if heartbeat is not None and time.monotonic() >= next_beat:
                    ok = True
                    with contextlib.suppress(Exception):
                        ok = heartbeat()
                    if not ok:
                        cancelled = True
                        if container is not None:
                            with contextlib.suppress(Exception):
                                container.kill()
                        return
                    next_beat = time.monotonic() + interval
                if cancel_check is not None and cancel_check():
                    cancelled = True
                    if container is not None:
                        with contextlib.suppress(Exception):
                            container.kill()
                    return

        watcher: threading.Thread | None = None
        try:
            self._ensure_image(client, image)
            container = client.containers.create(**create_kwargs)
            container.start()
            container_id = container.id
            if on_container_id is not None and container_id:
                on_container_id(container_id)

            if cancel_check is not None or heartbeat is not None:
                watcher = threading.Thread(
                    target=_watch_cancel_and_heartbeat,
                    name=f"sandbox-watch-{job_id[:8]}",
                    daemon=True,
                )
                watcher.start()

            result = container.wait(timeout=timeout_sec)
            exit_code = int(result.get("StatusCode", 1))
            logs = container.logs(stdout=True, stderr=True, timestamps=False)
            raw = logs.decode("utf-8", errors="replace") if isinstance(logs, bytes) else str(logs)
            stdout = raw[-settings.sandbox_log_preview_bytes :]
        except Exception as exc:
            msg = str(exc).lower()
            timed_out = "timeout" in msg or "timed out" in msg
            if container is not None:
                with contextlib.suppress(Exception):
                    container.kill()
                container_id = container.id
            if cancelled:
                exit_code = 137
                stderr = "cancelled"
            elif timed_out:
                exit_code = 124
                stderr = f"timed out after {timeout_sec}s"
            else:
                logger.exception("docker run failed job=%s", job_id)
                raise
        finally:
            stop_watch.set()
            if watcher is not None:
                watcher.join(timeout=2)
            if container is not None:
                try:
                    container.remove(force=True)
                except Exception:
                    logger.warning("failed to remove container for job=%s", job_id)

        if cancelled and not stderr:
            stderr = "cancelled"
            exit_code = 137

        artifacts = self._list_artifacts(job_dir, script_name)
        return DockerRunResult(
            exit_code=exit_code,
            stdout=stdout[: settings.sandbox_log_preview_bytes],
            stderr=stderr[: settings.sandbox_log_preview_bytes],
            artifact_paths=artifacts,
            container_id=container_id,
            timed_out=timed_out and not cancelled,
            cancelled=cancelled,
        )

    @staticmethod
    def _list_artifacts(job_dir: Path, script_name: str) -> list[str]:
        artifacts: list[str] = []
        for path in sorted(job_dir.rglob("*")):
            if not path.is_file():
                continue
            if path.name == script_name:
                continue
            rel = path.relative_to(job_dir).as_posix()
            artifacts.append(f"jobs/{job_dir.name}/{rel}")
            if len(artifacts) >= 50:
                break
        return artifacts
