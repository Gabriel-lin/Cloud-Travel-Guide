"""Server-side Markdown → PDF export (production path for agent file delivery)."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from backend.app.agents.tools.base import resolve_workspace_path
from backend.app.core.config import get_settings
from backend.app.services.markdown_render import markdown_to_html_document


def convert_markdown_file_to_pdf(
    source_path: str,
    *,
    output_path: str | None = None,
) -> Path:
    """Convert a workspace-relative markdown file to PDF. Returns absolute output path."""
    source = resolve_workspace_path(source_path)
    if not source.is_file():
        raise FileNotFoundError(f"source file not found: {source_path}")
    if source.suffix.lower() not in {".md", ".markdown"}:
        raise ValueError("source must be a .md or .markdown file")

    destination = resolve_workspace_path(output_path) if output_path else source.with_suffix(".pdf")

    destination.parent.mkdir(parents=True, exist_ok=True)

    settings = get_settings()
    md_text = source.read_text(encoding="utf-8")
    mermaid_mode: Literal["image", "playwright", "skip"] = (
        "image" if settings.document_mermaid_render else "skip"
    )
    html_doc = markdown_to_html_document(
        md_text,
        title=source.stem,
        mermaid_mode=mermaid_mode,
        mermaid_base_url=settings.mermaid_ink_base_url,
        mermaid_timeout_sec=settings.document_mermaid_timeout_sec,
    )
    from weasyprint import HTML

    HTML(string=html_doc, base_url=str(source.parent)).write_pdf(str(destination))
    return destination.resolve()
