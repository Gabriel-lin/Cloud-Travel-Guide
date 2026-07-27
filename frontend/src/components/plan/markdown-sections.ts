/**
 * Split assistant markdown so document-like sections (文件速览 / *.md headings)
 * can be rendered inside ArtifactPreview with collapse + download controls.
 */

export type MarkdownSection =
  | { type: "plain"; content: string }
  | { type: "doc"; title: string; content: string };

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const LOOSE_DOC_TITLE_RE =
  /^(?:📄\s*)?(?:\*\*|__)?\s*(文件速览|文档预览|文件预览|.+\.(?:md|markdown|pdf))\s*(?:\*\*|__)?\s*$/u;

function stripMdInline(title: string): string {
  return title
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/^\s*📄\s*/u, "")
    .trim();
}

export function isDocumentSectionTitle(rawTitle: string): boolean {
  const title = stripMdInline(rawTitle);
  if (!title) return false;
  if (/文件速览|文档预览|文件预览|速览/.test(title)) return true;
  if (/file\s*preview|quick\s*look|document\s*preview/i.test(title)) return true;
  if (/\.(md|markdown|pdf)$/i.test(title)) return true;
  if (/^📄/u.test(rawTitle.trim())) return true;
  return false;
}

export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  if (!markdown.trim()) return [{ type: "plain", content: markdown }];

  const lines = markdown.split("\n");
  const sections: MarkdownSection[] = [];
  let plainBuf: string[] = [];
  let docTitle: string | null = null;
  let docLevel = 0;
  let docBuf: string[] = [];

  const flushPlain = () => {
    if (plainBuf.length === 0) return;
    const content = plainBuf.join("\n");
    if (content.trim()) sections.push({ type: "plain", content });
    plainBuf = [];
  };

  const flushDoc = () => {
    if (docTitle == null) return;
    sections.push({
      type: "doc",
      title: stripMdInline(docTitle) || docTitle,
      content: docBuf.join("\n").replace(/^\n+/, ""),
    });
    docTitle = null;
    docLevel = 0;
    docBuf = [];
  };

  const startDoc = (title: string, level: number) => {
    flushPlain();
    flushDoc();
    docTitle = title;
    docLevel = level;
    docBuf = [];
  };

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match) {
      const level = match[1].length;
      const title = match[2];

      if (docTitle != null && level <= docLevel) {
        flushDoc();
      }

      if (docTitle == null && isDocumentSectionTitle(title)) {
        startDoc(title, level);
        continue;
      }

      if (docTitle != null && level <= docLevel) {
        // flushed above; fall through to plain/doc body handling
        if (isDocumentSectionTitle(title)) {
          startDoc(title, level);
          continue;
        }
      }
    } else if (docTitle == null && LOOSE_DOC_TITLE_RE.test(line.trim())) {
      const loose = LOOSE_DOC_TITLE_RE.exec(line.trim());
      startDoc(loose?.[1] ?? line.trim(), 2);
      continue;
    }

    if (docTitle != null) {
      docBuf.push(line);
    } else {
      plainBuf.push(line);
    }
  }

  flushDoc();
  flushPlain();

  if (sections.length === 0) {
    return [{ type: "plain", content: markdown }];
  }

  return sections;
}

export function sectionsHaveDocument(sections: readonly MarkdownSection[]): boolean {
  return sections.some((s) => s.type === "doc");
}
