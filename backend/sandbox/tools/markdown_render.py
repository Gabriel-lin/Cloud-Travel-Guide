"""Shared Markdown → HTML helpers for document export and sandbox PDF tools."""

from __future__ import annotations

import base64
import html
import re
from typing import Literal

import httpx
import markdown


def _load_document_theme() -> tuple[str, str]:
    import importlib

    try:
        mod = importlib.import_module("backend.sandbox.tools.document_theme")
    except ImportError:
        mod = importlib.import_module("document_theme")
    return mod.DOCUMENT_PDF_CSS, mod.MERMAID_THEME_SCRIPT


DOCUMENT_PDF_CSS, MERMAID_THEME_SCRIPT = _load_document_theme()

_MERMAID_FENCE = re.compile(
    r"```mermaid\s*\n(.*?)```",
    re.DOTALL | re.IGNORECASE,
)


def _mermaid_image_url(diagram: str, *, base_url: str) -> str:
    encoded = base64.urlsafe_b64encode(diagram.strip().encode("utf-8")).decode("ascii")
    return f"{base_url.rstrip('/')}/{encoded}"


def _fetch_mermaid_image_data_uri(
    diagram: str,
    *,
    base_url: str,
    timeout_sec: float,
) -> str | None:
    """Fetch a raster diagram from mermaid.ink (WeasyPrint cannot render SVG strokes)."""
    url = _mermaid_image_url(diagram, base_url=base_url)
    try:
        with httpx.Client(timeout=timeout_sec) as client:
            response = client.get(url)
            response.raise_for_status()
            content_type = response.headers.get("content-type", "image/png").split(";")[0].strip()
            if not content_type.startswith("image/"):
                return None
            encoded = base64.b64encode(response.content).decode("ascii")
            return f"data:{content_type};base64,{encoded}"
    except Exception:
        return None
    return None


def _replace_mermaid_blocks(
    md_text: str,
    *,
    mode: Literal["image", "playwright"],
    mermaid_base_url: str,
    mermaid_timeout_sec: float,
) -> str:
    def repl(match: re.Match[str]) -> str:
        diagram = match.group(1).strip()
        if mode == "playwright":
            return f'<pre class="mermaid">{html.escape(diagram)}</pre>'
        data_uri = _fetch_mermaid_image_data_uri(
            diagram,
            base_url=mermaid_base_url,
            timeout_sec=mermaid_timeout_sec,
        )
        if data_uri:
            return f'<div class="mermaid-diagram"><img src="{data_uri}" alt="流程图" /></div>'
        escaped = html.escape(diagram)
        return (
            '<div class="mermaid-fallback">'
            "<p><strong>流程图</strong>（未能远程渲染，显示源码）</p>"
            f"<pre><code>{escaped}</code></pre>"
            "</div>"
        )

    return _MERMAID_FENCE.sub(repl, md_text)


def markdown_to_html_document(
    md_text: str,
    *,
    title: str = "Export",
    mermaid_mode: Literal["image", "playwright", "skip"] = "image",
    mermaid_base_url: str = "https://mermaid.ink/img",
    mermaid_timeout_sec: float = 20.0,
) -> str:
    """Convert markdown to a full HTML document."""
    prepared = md_text
    if mermaid_mode != "skip":
        prepared = _replace_mermaid_blocks(
            prepared,
            mode=mermaid_mode,
            mermaid_base_url=mermaid_base_url,
            mermaid_timeout_sec=mermaid_timeout_sec,
        )

    body = markdown.markdown(
        prepared,
        extensions=["extra", "sane_lists", "tables", "fenced_code", "nl2br"],
        output_format="html5",
    )

    mermaid_scripts = ""
    if mermaid_mode == "playwright":
        mermaid_scripts = MERMAID_THEME_SCRIPT

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>{html.escape(title)}</title>
  <style>{DOCUMENT_PDF_CSS}</style>
</head>
<body>
<article class="ctg-document">
{body}
</article>
{mermaid_scripts}
</body>
</html>"""
