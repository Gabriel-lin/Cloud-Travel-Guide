"""Tests for markdown render helpers."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from backend.sandbox.tools.markdown_render import markdown_to_html_document


def test_markdown_to_html_document_renders_mermaid_image() -> None:
    md = "# Trip\n\n```mermaid\ngraph LR\n  A[成都] --> B[稻城]\n```\n"
    mock_response = MagicMock()
    mock_response.content = b"\x89PNG\r\n"
    mock_response.headers = {"content-type": "image/png"}
    mock_response.raise_for_status = MagicMock()

    with patch("backend.sandbox.tools.markdown_render.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.get.return_value = mock_response
        html = markdown_to_html_document(md, mermaid_mode="image")

    assert "mermaid-diagram" in html
    assert "data:image/png;base64," in html
    client.get.assert_called_once()


def test_markdown_to_html_document_playwright_mode() -> None:
    md = "```mermaid\ngraph TD\n  X --> Y\n```"
    html = markdown_to_html_document(md, mermaid_mode="playwright")
    assert '<pre class="mermaid">' in html
    assert "mermaid.esm.min.mjs" in html
