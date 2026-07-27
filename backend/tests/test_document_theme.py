"""Tests for CTG document export theme."""

from __future__ import annotations

from backend.sandbox.tools.document_theme import (
    BRAND_600,
    DOCUMENT_PDF_CSS,
    INK_100,
    SURFACE_950,
)
from backend.sandbox.tools.markdown_render import markdown_to_html_document


def test_document_pdf_css_uses_brand_palette() -> None:
    assert BRAND_600 in DOCUMENT_PDF_CSS
    assert INK_100 in DOCUMENT_PDF_CSS
    assert SURFACE_950 in DOCUMENT_PDF_CSS
    assert ".ctg-document" in DOCUMENT_PDF_CSS


def test_markdown_html_wraps_body_in_document_shell() -> None:
    html = markdown_to_html_document("# Title\n\nParagraph.", title="Title")
    assert '<article class="ctg-document">' in html
    assert "border-left: 4px solid" in html
