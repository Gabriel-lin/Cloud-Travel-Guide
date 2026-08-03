import type { ThreadAssistantMessagePart } from "@assistant-ui/react";

import {
  basename,
  isMarkdownPath,
  isPdfPath,
  mimeForPath,
  parseFileToolArgs,
} from "@/components/plan/artifact-utils";
import { toWorkspaceFileDataRef } from "@/lib/plan/sanitize-history-for-cloud";

type ToolExportResult = {
  ok?: boolean;
  outputPath?: string;
  sourcePath?: string;
};

function parseToolJson(output: string): ToolExportResult | null {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as ToolExportResult;
  } catch {
    return null;
  }
}

export function workspacePathFromToolResult(
  toolName: string,
  output: string,
  args?: unknown,
): string | null {
  const parsed = parseToolJson(output);
  if (parsed?.ok && parsed.outputPath) return parsed.outputPath;

  if (toolName === "convert_markdown_to_pdf" && parsed?.outputPath) {
    return parsed.outputPath;
  }

  if (toolName === "read_file") {
    const { filePath } = parseFileToolArgs(args);
    if (filePath && (isPdfPath(filePath) || isMarkdownPath(filePath))) {
      return filePath;
    }
  }

  return null;
}

export async function filePartFromToolResult(
  toolName: string,
  output: string,
  args?: unknown,
): Promise<ThreadAssistantMessagePart | null> {
  const path = workspacePathFromToolResult(toolName, output, args);
  if (!path) return null;
  if (!isPdfPath(path) && !isMarkdownPath(path)) return null;

  // Store a workspace ref — all clients resolve bytes via /plan/workspace/file.
  return {
    type: "file",
    filename: basename(path),
    mimeType: mimeForPath(path),
    data: toWorkspaceFileDataRef(path),
  };
}
