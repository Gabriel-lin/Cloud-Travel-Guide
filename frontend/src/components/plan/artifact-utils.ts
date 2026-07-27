/** Helpers for chat file / code artifacts (download, mime, encoding). */

export type ArtifactKind = "markdown" | "pdf" | "text" | "binary";

export type DownloadOptions = {
  kind?: ArtifactKind;
  mimeType?: string;
  /** Markdown/plain body — used to infer filename when title is generic. */
  contentHint?: string;
  onSuccess?: (filename: string) => void;
};

const GENERIC_DOC_TITLE_RE =
  /^(?:文件速览|文档预览|文件预览|速览|file\s*(?:quick\s*)?view|document\s*preview)$/iu;

export function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

export function extensionOf(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function stripMarkdownInline(title: string): string {
  return title
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/^\s*📄\s*/u, "")
    .trim();
}

function sanitizeFilenameStem(name: string): string {
  const cleaned = stripMarkdownInline(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 120) || "document";
}

function isGenericDocTitle(name: string): boolean {
  const stem = sanitizeFilenameStem(name.replace(/\.[^.]+$/u, ""));
  return GENERIC_DOC_TITLE_RE.test(stem);
}

function extensionForKind(kind?: ArtifactKind, mimeType?: string): string {
  if (kind === "pdf" || mimeType === "application/pdf") return ".pdf";
  if (kind === "markdown" || mimeType?.includes("markdown")) return ".md";
  if (mimeType === "application/json") return ".json";
  if (mimeType?.startsWith("text/html")) return ".html";
  if (kind === "text" || mimeType?.startsWith("text/")) return ".txt";
  return "";
}

function inferNameFromMarkdown(content: string): string | null {
  const h1 = content.match(/^#\s+(.+?)\s*$/m);
  if (!h1) return null;
  const stem = sanitizeFilenameStem(h1[1]);
  if (!stem || isGenericDocTitle(stem)) return null;
  return `${stem}.md`;
}

/** Normalize a user-facing download filename (basename, extension, generic titles). */
export function resolveDownloadFilename(
  rawName: string,
  options?: Pick<DownloadOptions, "kind" | "mimeType" | "contentHint">,
): string {
  const fromPath = basename(rawName.trim());
  let name = fromPath || "download";

  if (isGenericDocTitle(name) && options?.contentHint) {
    const inferred = inferNameFromMarkdown(options.contentHint);
    if (inferred) return inferred;
  }

  if (isGenericDocTitle(name)) {
    const ext = extensionForKind(options?.kind, options?.mimeType) || ".txt";
    return `document${ext}`;
  }

  if (!extensionOf(name)) {
    const ext = extensionForKind(options?.kind, options?.mimeType);
    if (ext) return `${sanitizeFilenameStem(name)}${ext}`;
  }

  const ext = extensionOf(name);
  const stem = sanitizeFilenameStem(name.replace(/\.[^.]+$/u, ""));
  return ext ? `${stem}.${ext}` : stem;
}

export function mimeForPath(path: string): string {
  switch (extensionOf(path)) {
    case "md":
    case "markdown":
      return "text/markdown";
    case "pdf":
      return "application/pdf";
    case "json":
      return "application/json";
    case "html":
    case "htm":
      return "text/html";
    case "txt":
      return "text/plain";
    case "ts":
    case "tsx":
      return "text/typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "text/javascript";
    case "py":
      return "text/x-python";
    case "css":
      return "text/css";
    case "yml":
    case "yaml":
      return "text/yaml";
    default:
      return "application/octet-stream";
  }
}

export function isMarkdownPath(path: string): boolean {
  const ext = extensionOf(path);
  return ext === "md" || ext === "markdown";
}

export function isPdfPath(path: string): boolean {
  return extensionOf(path) === "pdf";
}

export function encodeUtf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function decodeUtf8Base64(data: string): string {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function downloadBlob(
  filename: string,
  blob: Blob,
  options?: Pick<DownloadOptions, "onSuccess">,
): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  options?.onSuccess?.(filename);
}

export function downloadText(
  rawName: string,
  text: string,
  mime = "text/plain;charset=utf-8",
  options?: DownloadOptions,
): void {
  const filename = resolveDownloadFilename(rawName, options);
  downloadBlob(
    filename,
    new Blob([text], { type: mime }),
    { onSuccess: options?.onSuccess },
  );
}

export function downloadBase64(
  rawName: string,
  base64: string,
  mime: string,
  options?: DownloadOptions,
): void {
  const filename = resolveDownloadFilename(rawName, options);
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  downloadBlob(filename, new Blob([bytes], { type: mime }), {
    onSuccess: options?.onSuccess,
  });
}

export function formatJsonish(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export type WriteFileArgs = {
  filePath?: string;
  text?: string;
};

/** LangChain WriteFileTool / ReadFileTool arg shapes. */
export function parseFileToolArgs(args: unknown): WriteFileArgs {
  if (!args || typeof args !== "object") return {};
  const record = args as Record<string, unknown>;
  const filePath =
    (typeof record.file_path === "string" && record.file_path) ||
    (typeof record.filePath === "string" && record.filePath) ||
    (typeof record.path === "string" && record.path) ||
    undefined;
  const text =
    (typeof record.text === "string" && record.text) ||
    (typeof record.content === "string" && record.content) ||
    undefined;
  return { filePath, text };
}

export function normalizeToolArgs(input: unknown): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { input };
    }
    return { input };
  }
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { value: input };
}
