"""First-class document export tools (prefer over ad-hoc sandbox scripts)."""

from __future__ import annotations

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from backend.app.agents.tools.base import dumps_json, workspace_relative
from backend.app.services.document_export import convert_markdown_file_to_pdf


class ConvertMarkdownToPdfInput(BaseModel):
    source_path: str = Field(
        description="Workspace-relative path to a .md or .markdown file, e.g. 川西7天自驾小众环线.md"
    )
    output_path: str | None = Field(
        default=None,
        description="Optional workspace-relative PDF output path. Defaults to same name with .pdf",
    )


def _convert_markdown_to_pdf(source_path: str, output_path: str | None = None) -> str:
    try:
        destination = convert_markdown_file_to_pdf(source_path, output_path=output_path)
    except Exception as exc:
        return dumps_json({"ok": False, "error": str(exc), "sourcePath": source_path})
    rel = workspace_relative(destination)
    return dumps_json(
        {
            "ok": True,
            "sourcePath": source_path,
            "outputPath": rel,
            "mimeType": "application/pdf",
            "message": f"PDF written to {rel}",
        }
    )


def build_convert_markdown_to_pdf_tool() -> StructuredTool:
    return StructuredTool.from_function(
        name="convert_markdown_to_pdf",
        description=(
            "Convert a markdown file in the agent workspace to a styled PDF using the "
            "platform document renderer. Prefer this over run_sandbox_job for MD→PDF. "
            "Returns outputPath for preview/download."
        ),
        func=_convert_markdown_to_pdf,
        args_schema=ConvertMarkdownToPdfInput,
    )
