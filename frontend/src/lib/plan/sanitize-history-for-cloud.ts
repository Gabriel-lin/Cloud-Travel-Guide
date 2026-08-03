import type { PlanThreadHistoryRepo } from "@/service/plan";

/** Prefix stored in file-part `data` when bytes live in the agent workspace. */
export const WORKSPACE_FILE_DATA_PREFIX = "workspace:";

/** Inline base64 above this is rewritten to a workspace ref (or dropped). */
export const MAX_INLINE_FILE_CHARS = 8_192;

/** Tool/text payloads above this are truncated for cloud storage. */
export const MAX_TOOL_RESULT_CHARS = 32_768;

export function toWorkspaceFileDataRef(path: string): string {
  return `${WORKSPACE_FILE_DATA_PREFIX}${path}`;
}

export function parseWorkspaceFileDataRef(data: string): string | null {
  if (typeof data !== "string") return null;
  if (!data.startsWith(WORKSPACE_FILE_DATA_PREFIX)) return null;
  const path = data.slice(WORKSPACE_FILE_DATA_PREFIX.length).trim();
  return path || null;
}

function truncateString(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}

function basenamePath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || path;
}

function workspacePathFromToolResultText(result: unknown): string | null {
  if (typeof result !== "string") return null;
  const trimmed = result.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as {
      outputPath?: string;
      sourcePath?: string;
      ok?: boolean;
    };
    if (typeof parsed.outputPath === "string" && parsed.outputPath.trim()) {
      return parsed.outputPath.trim();
    }
    if (typeof parsed.sourcePath === "string" && parsed.sourcePath.trim()) {
      return parsed.sourcePath.trim();
    }
  } catch {
    // ignore
  }
  return null;
}

function collectWorkspacePaths(content: unknown[]): string[] {
  const paths: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const record = part as Record<string, unknown>;
    if (record.type === "tool-call") {
      const path = workspacePathFromToolResultText(record.result);
      if (path) paths.push(path);
      const args = record.args;
      if (typeof args === "object" && args !== null) {
        const filePath = (args as { file_path?: unknown; path?: unknown }).file_path
          ?? (args as { path?: unknown }).path;
        if (typeof filePath === "string" && filePath.trim()) {
          paths.push(filePath.trim());
        }
      }
    }
    if (record.type === "file" && typeof record.data === "string") {
      const ref = parseWorkspaceFileDataRef(record.data);
      if (ref) paths.push(ref);
    }
  }
  return paths;
}

function resolvePathForFilePart(
  filename: string | undefined,
  workspacePaths: string[],
): string | null {
  if (workspacePaths.length === 1) return workspacePaths[0] ?? null;
  if (!filename) return workspacePaths[workspacePaths.length - 1] ?? null;

  const target = basenamePath(filename);
  const match = workspacePaths.find((path) => basenamePath(path) === target);
  return match ?? workspacePaths[workspacePaths.length - 1] ?? null;
}

function sanitizePart(part: unknown, workspacePaths: string[]): unknown {
  if (typeof part !== "object" || part === null) return part;
  const record = part as Record<string, unknown>;

  if (record.type === "file" && typeof record.data === "string") {
    const data = record.data;
    if (parseWorkspaceFileDataRef(data)) {
      return {
        ...record,
        filename:
          typeof record.filename === "string"
            ? basenamePath(record.filename)
            : record.filename,
      };
    }

    const filename =
      typeof record.filename === "string" ? record.filename : undefined;
    const path = resolvePathForFilePart(filename, workspacePaths);

    // Always prefer workspace refs for cloud sync (even modest inline payloads).
    if (path && (data.length > MAX_INLINE_FILE_CHARS || data.length > 256)) {
      return {
        ...record,
        filename: basenamePath(path),
        data: toWorkspaceFileDataRef(path),
      };
    }

    if (data.length > MAX_INLINE_FILE_CHARS) {
      return {
        ...record,
        filename: filename ? basenamePath(filename) : filename,
        data: "",
      };
    }

    return part;
  }

  if (record.type === "tool-call") {
    const next = { ...record };
    if (typeof next.result === "string" && next.result.length > MAX_TOOL_RESULT_CHARS) {
      next.result = truncateString(next.result, MAX_TOOL_RESULT_CHARS);
    }
    if (
      typeof next.argsText === "string" &&
      next.argsText.length > MAX_TOOL_RESULT_CHARS
    ) {
      next.argsText = truncateString(next.argsText, MAX_TOOL_RESULT_CHARS);
    }
    // Drop large write_file text from args — file is on disk / referenced by path.
    if (typeof next.args === "object" && next.args !== null) {
      const args = { ...(next.args as Record<string, unknown>) };
      for (const key of ["text", "content", "data"] as const) {
        if (typeof args[key] === "string" && (args[key] as string).length > 4_096) {
          args[key] = truncateString(args[key] as string, 4_096);
        }
      }
      next.args = args;
    }
    return next;
  }

  if (record.type === "text" && typeof record.text === "string") {
    if (record.text.length <= MAX_TOOL_RESULT_CHARS) return part;
    return { ...record, text: truncateString(record.text, MAX_TOOL_RESULT_CHARS) };
  }

  if (record.type === "image" && typeof record.image === "string") {
    if (record.image.length > MAX_INLINE_FILE_CHARS) {
      return { ...record, image: "" };
    }
  }

  return part;
}

function sanitizeHistoryEntry(entry: unknown): unknown {
  if (typeof entry !== "object" || entry === null) return entry;
  const item = entry as {
    message?: { content?: unknown[]; [key: string]: unknown };
    parentId?: string | null;
  };
  if (!item.message || !Array.isArray(item.message.content)) return entry;

  const workspacePaths = collectWorkspacePaths(item.message.content);

  return {
    ...item,
    message: {
      ...item.message,
      content: item.message.content.map((part) =>
        sanitizePart(part, workspacePaths),
      ),
    },
  };
}

/**
 * Prepare assistant-ui history for cloud PUT / cross-client sync:
 * - file parts → `workspace:<path>` refs (no base64 blobs)
 * - truncate oversized tool/text payloads
 */
export function sanitizeHistoryForCloud(
  repo: PlanThreadHistoryRepo,
): PlanThreadHistoryRepo {
  return {
    messages: (repo.messages ?? []).map(sanitizeHistoryEntry),
    ...(repo.headId != null ? { headId: repo.headId } : {}),
  };
}
