"""Playwright HTML → PDF helper (available in profile=playwright sandboxes)."""

from __future__ import annotations

from pathlib import Path

from markdown_render import markdown_to_html_document
from playwright.sync_api import sync_playwright


def html_to_pdf(
    html: str,
    output_path: str | Path,
    *,
    base_url: str | Path | None = None,
    wait_for_mermaid: bool = False,
) -> Path:
    """Render HTML string to PDF using headless Chromium."""
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    base = str(Path(base_url).resolve()) if base_url else None

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.set_content(html, wait_until="networkidle", base_url=base)
            if wait_for_mermaid:
                page.wait_for_selector(".mermaid svg", timeout=30_000)
            page.emulate_media(media="print")
            page.pdf(
                path=str(destination),
                format="A4",
                print_background=True,
                margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
            )
        finally:
            browser.close()

    return destination.resolve()


def markdown_file_to_pdf(
    markdown_path: str | Path,
    output_path: str | Path | None = None,
) -> Path:
    """Convert a markdown file to PDF via markdown → HTML → Chromium (supports mermaid)."""
    source = Path(markdown_path)
    destination = Path(output_path) if output_path else source.with_suffix(".pdf")
    text = source.read_text(encoding="utf-8")
    html_doc = markdown_to_html_document(
        text,
        title=source.stem,
        mermaid_mode="playwright",
    )
    return html_to_pdf(
        html_doc,
        destination,
        base_url=source.parent,
        wait_for_mermaid="```mermaid" in text.lower(),
    )
