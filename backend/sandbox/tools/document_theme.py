"""Cloud Travel Guide document theme — keep in sync with frontend/src/app/globals.css (:root)."""

from __future__ import annotations

# Light theme tokens (PDF / print; matches app :root)
SURFACE_950 = "#f0f7f3"
SURFACE_900 = "#ffffff"
SURFACE_800 = "#e8f3ec"
SURFACE_700 = "#d6ebe0"
SURFACE_600 = "#bdd9cc"

INK_100 = "#0a1610"
INK_200 = "#1a2e24"
INK_300 = "#3d5c4a"
INK_400 = "#5f7d6a"

BRAND_50 = "#ecfdf5"
BRAND_100 = "#d1fae5"
BRAND_400 = "#34d399"
BRAND_500 = "#10b981"
BRAND_600 = "#059669"
BRAND_700 = "#047857"

# Code blocks mirror app dark surfaces for contrast in exported docs
CODE_BG = "#0b1610"
CODE_FG = "#b8e8ce"
CODE_BORDER = "#1c3629"

DOCUMENT_PDF_CSS = f"""
@page {{
  size: A4;
  margin: 2.1cm 1.75cm 2.3cm;
  background-color: {SURFACE_950};
  @bottom-center {{
    content: counter(page);
    font-family: "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 9pt;
    color: {INK_400};
  }}
}}

html {{
  background-color: {SURFACE_950};
}}

body {{
  font-family: "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei",
    "Helvetica Neue", Arial, sans-serif;
  font-size: 10.5pt;
  line-height: 1.62;
  color: {INK_200};
  background-color: {SURFACE_950};
  margin: 0;
  padding: 0;
}}

.ctg-document {{
  background: {SURFACE_900};
  border: 1px solid {SURFACE_700};
  border-radius: 10px;
  padding: 1.35cm 1.25cm 1.15cm;
  box-shadow: 0 1px 0 {SURFACE_600};
}}

.ctg-document > :first-child {{
  margin-top: 0;
}}

h1, h2, h3, h4, h5, h6 {{
  color: {INK_100};
  line-height: 1.28;
  font-weight: 600;
  letter-spacing: -0.01em;
}}

h1 {{
  font-size: 22pt;
  margin: 0 0 0.85em;
  padding: 0.35em 0 0.55em;
  border-bottom: 3px solid {BRAND_600};
  background: linear-gradient(180deg, {BRAND_50} 0%, transparent 72%);
}}

h2 {{
  font-size: 15pt;
  margin: 1.35em 0 0.5em;
  padding: 0.2em 0 0.2em 0.65em;
  border-left: 4px solid {BRAND_500};
  background: linear-gradient(90deg, {SURFACE_800} 0%, transparent 88%);
}}

h3 {{
  font-size: 12.5pt;
  margin: 1.1em 0 0.4em;
  color: {INK_100};
}}

h4 {{
  font-size: 11pt;
  margin: 0.95em 0 0.35em;
  color: {INK_200};
}}

h5 {{
  font-size: 10.5pt;
  margin: 0.85em 0 0.3em;
  color: {INK_300};
}}

h6 {{
  font-size: 9pt;
  margin: 0.75em 0 0.25em;
  color: {INK_400};
  text-transform: uppercase;
  letter-spacing: 0.06em;
}}

p {{
  margin: 0.4em 0;
}}

strong, b {{
  color: {INK_100};
  font-weight: 600;
}}

em {{
  color: {INK_300};
}}

a {{
  color: {BRAND_600};
  text-decoration: none;
  border-bottom: 1px solid {BRAND_400};
}}

ul, ol {{
  margin: 0.45em 0 0.55em;
  padding-left: 1.35em;
}}

li {{
  margin: 0.22em 0;
}}

li::marker {{
  color: {BRAND_600};
}}

code {{
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  color: {BRAND_700};
  background: {BRAND_50};
  border: 1px solid {BRAND_100};
  padding: 0.08em 0.35em;
  border-radius: 4px;
}}

pre {{
  background: {CODE_BG};
  color: {CODE_FG};
  border: 1px solid {CODE_BORDER};
  padding: 0.8em 1em;
  border-radius: 8px;
  font-size: 0.86em;
  white-space: pre-wrap;
  margin: 0.75em 0;
}}

pre code {{
  background: transparent;
  color: inherit;
  border: none;
  padding: 0;
}}

blockquote {{
  margin: 0.85em 0;
  padding: 0.65em 0.9em 0.65em 1em;
  border-left: 4px solid {BRAND_500};
  background: {SURFACE_800};
  color: {INK_300};
  border-radius: 0 8px 8px 0;
}}

blockquote p {{
  margin: 0.25em 0;
}}

table {{
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
  margin: 0.9em 0;
  font-size: 0.94em;
  table-layout: fixed;
  border: 1px solid {SURFACE_700};
  border-radius: 8px;
  overflow: hidden;
}}

thead th {{
  background: {BRAND_600};
  color: {SURFACE_900};
  font-weight: 600;
}}

th, td {{
  border-bottom: 1px solid {SURFACE_700};
  padding: 0.42em 0.58em;
  text-align: left;
  vertical-align: top;
  word-wrap: break-word;
}}

tbody tr:nth-child(even) td {{
  background: {SURFACE_800};
}}

tbody tr:last-child td {{
  border-bottom: none;
}}

hr {{
  border: none;
  height: 1px;
  margin: 1.35em 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    {BRAND_400} 18%,
    {BRAND_600} 50%,
    {BRAND_400} 82%,
    transparent 100%
  );
}}

.mermaid-diagram {{
  margin: 1em 0;
  padding: 0.75em;
  text-align: center;
  background: {SURFACE_800};
  border: 1px solid {SURFACE_700};
  border-radius: 8px;
}}

.mermaid-diagram img {{
  max-width: 100%;
  height: auto;
}}

.mermaid-fallback {{
  margin: 1em 0;
  padding: 0.75em 1em;
  background: {SURFACE_800};
  border: 1px dashed {SURFACE_600};
  border-radius: 8px;
  color: {INK_400};
}}
"""

MERMAID_THEME_SCRIPT = f"""
<script type="module">
  import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
  mermaid.initialize({{
    startOnLoad: false,
    theme: "base",
    themeVariables: {{
      primaryColor: "{BRAND_100}",
      primaryTextColor: "{INK_100}",
      primaryBorderColor: "{BRAND_600}",
      secondaryColor: "{SURFACE_800}",
      tertiaryColor: "{SURFACE_950}",
      lineColor: "{BRAND_500}",
      textColor: "{INK_200}",
      mainBkg: "{SURFACE_900}",
      nodeBorder: "{BRAND_600}",
      clusterBkg: "{SURFACE_800}",
      titleColor: "{INK_100}",
      edgeLabelBackground: "{SURFACE_900}",
      fontFamily: '"Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
    }},
    securityLevel: "loose"
  }});
  await mermaid.run({{ querySelector: ".mermaid" }});
</script>
"""
