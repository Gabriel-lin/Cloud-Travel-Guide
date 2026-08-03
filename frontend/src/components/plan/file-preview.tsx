"use client";

import { useMessagePartFile } from "@assistant-ui/react";

import { ArtifactPreview } from "@/components/plan/artifact-preview";
import {
  basename,
  decodeUtf8Base64,
  isMarkdownPath,
  isPdfPath,
  mimeForPath,
} from "@/components/plan/artifact-utils";
import { StandaloneMarkdown } from "@/components/plan/markdown-text";
import { WorkspaceFilePreview } from "@/components/plan/workspace-file-preview";
import { parseWorkspaceFileDataRef } from "@/lib/plan/sanitize-history-for-cloud";
import { useAppLocale } from "@/hooks/use-app-locale";

export { ArtifactPreview } from "@/components/plan/artifact-preview";
export type { ArtifactPreviewProps } from "@/components/plan/artifact-preview";

export function FilePart() {
  const part = useMessagePartFile();
  const { t } = useAppLocale();
  const filename = basename(part.filename ?? "file");
  const mime = part.mimeType || mimeForPath(filename);
  const headerTitle = t("plan.fileQuickView");

  const workspacePath = parseWorkspaceFileDataRef(part.data);
  if (workspacePath) {
    return (
      <WorkspaceFilePreview
        path={workspacePath}
        title={headerTitle}
        defaultOpen
      />
    );
  }

  if (!part.data) {
    return (
      <p className="my-2 text-xs text-ink-500">
        {t("plan.fileUnavailable")}: {filename}
      </p>
    );
  }

  if (isMarkdownPath(filename) || mime.includes("markdown")) {
    let md = part.data;
    try {
      md = decodeUtf8Base64(part.data);
    } catch {
      // keep raw
    }
    return (
      <ArtifactPreview
        title={headerTitle}
        downloadName={filename}
        kind="markdown"
        content={part.data}
        encoding="base64"
        mimeType={mime}
      >
        <StandaloneMarkdown content={md} />
      </ArtifactPreview>
    );
  }

  if (isPdfPath(filename) || mime === "application/pdf") {
    return (
      <ArtifactPreview
        title={headerTitle}
        downloadName={filename}
        kind="pdf"
        content={part.data}
        encoding="base64"
        mimeType="application/pdf"
      />
    );
  }

  if (mime.startsWith("text/") || mime === "application/json") {
    return (
      <ArtifactPreview
        title={headerTitle}
        downloadName={filename}
        kind="text"
        content={part.data}
        encoding="base64"
        mimeType={mime}
      />
    );
  }

  return (
    <ArtifactPreview
      title={headerTitle}
      downloadName={filename}
      kind="binary"
      content={part.data}
      encoding="base64"
      mimeType={mime}
      defaultOpen={false}
    />
  );
}

/** Preview for write_file / read_file tool args or results. */
export function FileToolArtifact({
  filePath,
  text,
}: {
  filePath: string;
  text?: string;
}) {
  const resolvedText = text ?? "";

  if (!filePath) return null;

  if (isMarkdownPath(filePath) && resolvedText) {
    return (
      <ArtifactPreview
        title={basename(filePath)}
        downloadName={filePath}
        kind="markdown"
        content={resolvedText}
        encoding="utf8"
      >
        <StandaloneMarkdown content={resolvedText} />
      </ArtifactPreview>
    );
  }

  if (isPdfPath(filePath) && resolvedText) {
    const looksBase64 = /^[A-Za-z0-9+/=\s]+$/.test(resolvedText.slice(0, 200));
    return (
      <ArtifactPreview
        title={basename(filePath)}
        downloadName={filePath}
        kind="pdf"
        content={resolvedText.trim()}
        encoding={looksBase64 ? "base64" : "utf8"}
        mimeType="application/pdf"
      />
    );
  }

  if (resolvedText) {
    return (
      <ArtifactPreview
        title={basename(filePath)}
        downloadName={filePath}
        kind="text"
        content={resolvedText}
        encoding="utf8"
      />
    );
  }

  return (
    <WorkspaceFilePreview path={filePath} title={basename(filePath)} />
  );
}
