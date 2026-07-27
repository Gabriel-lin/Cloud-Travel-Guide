"use client";

import { LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { ArtifactPreview } from "@/components/plan/artifact-preview";
import {
  basename,
  isMarkdownPath,
  isPdfPath,
  mimeForPath,
} from "@/components/plan/artifact-utils";
import { StandaloneMarkdown } from "@/components/plan/markdown-text";
import { planService } from "@/service/plan";
import type { WorkspaceFilePayload } from "@/service/plan/types";
import { useAppLocale } from "@/hooks/use-app-locale";

type WorkspaceFilePreviewProps = {
  path: string;
  title?: string;
  defaultOpen?: boolean;
};

export function WorkspaceFilePreview(props: WorkspaceFilePreviewProps) {
  return <WorkspaceFilePreviewInner key={props.path} {...props} />;
}

function WorkspaceFilePreviewInner({
  path,
  title,
  defaultOpen = true,
}: WorkspaceFilePreviewProps) {
  const { t } = useAppLocale();
  const [file, setFile] = useState<WorkspaceFilePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void planService
      .fetchWorkspaceFile(path)
      .then((payload) => {
        if (!cancelled) setFile(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load file");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (error) {
    return (
      <p className="my-2 text-xs text-red-300">
        {t("plan.fileLoadFailed")}: {error}
      </p>
    );
  }

  if (!file) {
    return (
      <div className="my-2 flex items-center gap-2 text-xs text-ink-400">
        <LoaderIcon className="size-3.5 animate-spin" />
        {t("plan.fileLoading")}
      </div>
    );
  }

  const displayName = basename(path);
  const header = title ?? displayName;
  const mime = file.mimeType || mimeForPath(path);

  if (isPdfPath(path) || mime === "application/pdf") {
    return (
      <ArtifactPreview
        title={header}
        downloadName={displayName}
        kind="pdf"
        content={file.data}
        encoding="base64"
        mimeType="application/pdf"
        defaultOpen={defaultOpen}
      />
    );
  }

  if (isMarkdownPath(path) || mime.includes("markdown")) {
    let md = "";
    try {
      md = atob(file.data);
    } catch {
      md = "";
    }
    return (
      <ArtifactPreview
        title={header}
        downloadName={displayName}
        kind="markdown"
        content={file.data}
        encoding="base64"
        mimeType={mime}
        defaultOpen={defaultOpen}
      >
        <StandaloneMarkdown content={md} />
      </ArtifactPreview>
    );
  }

  return (
    <ArtifactPreview
      title={header}
      downloadName={displayName}
      kind="binary"
      content={file.data}
      encoding="base64"
      mimeType={mime}
      defaultOpen={defaultOpen}
    />
  );
}
