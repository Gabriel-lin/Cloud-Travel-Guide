"use client";

import { DownloadIcon, FileTextIcon, LoaderIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  decodeUtf8Base64,
  downloadBase64,
  downloadText,
  mimeForPath,
  type DownloadOptions,
} from "@/components/plan/artifact-utils";
import { ChevronToggle } from "@/components/plan/chevron-toggle";
import { HeaderActionButton } from "@/components/plan/header-action-button";
import { useAppLocale } from "@/hooks/use-app-locale";
import { cn } from "@/lib/utils";

const PdfDocument = dynamic(
  () => import("@/components/plan/pdf-viewer"),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-ink-400">
        <LoaderIcon className="size-3.5 animate-spin" />
        Loading PDF…
      </div>
    ),
  },
);

export type ArtifactPreviewProps = {
  /** Header label (e.g. 文件速览). */
  title: string;
  /** Filename used when downloading; defaults to `title`. */
  downloadName?: string;
  kind: "markdown" | "pdf" | "text" | "binary";
  content: string;
  encoding?: "utf8" | "base64";
  mimeType?: string;
  defaultOpen?: boolean;
  className?: string;
  children?: ReactNode;
};

export function ArtifactPreview({
  title,
  downloadName,
  kind,
  content,
  encoding = kind === "pdf" || kind === "binary" ? "base64" : "utf8",
  mimeType,
  defaultOpen = true,
  className,
  children,
}: ArtifactPreviewProps) {
  const { t } = useAppLocale();
  const [open, setOpen] = useState(defaultOpen);

  const textContent = useMemo(() => {
    if (kind === "pdf" || kind === "binary") return "";
    if (encoding === "base64") {
      try {
        return decodeUtf8Base64(content);
      } catch {
        return content;
      }
    }
    return content;
  }, [content, encoding, kind]);

  const notifyDownloadSuccess = useCallback(
    (name: string) => {
      toast.success(t("plan.downloadSuccess", { name }));
    },
    [t],
  );

  const onDownload = () => {
    const raw = downloadName ?? title;
    const mime = mimeType ?? mimeForPath(raw);
    const options: DownloadOptions = {
      kind,
      mimeType: mime,
      contentHint: kind === "markdown" ? textContent : undefined,
      onSuccess: notifyDownloadSuccess,
    };
    if (kind === "pdf" || kind === "binary" || encoding === "base64") {
      const b64 =
        encoding === "base64"
          ? content
          : btoa(unescape(encodeURIComponent(content)));
      downloadBase64(raw, b64, mime, options);
      return;
    }
    downloadText(raw, textContent, `${mime};charset=utf-8`, options);
  };

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-lg bg-surface-900/75 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <FileTextIcon className="size-3.5 shrink-0 text-ink-500" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-200">
          {title}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <ChevronToggle
            open={open}
            label={open ? t("plan.collapse") : t("plan.expand")}
            onClick={() => setOpen((v) => !v)}
          />
          <HeaderActionButton
            label={t("plan.download")}
            showLabel
            onClick={onDownload}
          >
            <DownloadIcon className="size-3.5" />
          </HeaderActionButton>
        </div>
      </div>

      {open ? (
        <div className="max-h-112 overflow-auto border-t border-surface-700/40 px-3 py-3">
          {children ??
            (kind === "pdf" ? (
              <PdfDocument
                data={
                  encoding === "base64"
                    ? content
                    : btoa(unescape(encodeURIComponent(content)))
                }
              />
            ) : kind === "text" ? (
              <pre className="wrap-break-word font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-300">
                {textContent}
              </pre>
            ) : kind === "binary" ? (
              <p className="text-xs text-ink-400">{t("plan.binaryPreviewHint")}</p>
            ) : (
              <pre className="wrap-break-word font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-300">
                {textContent}
              </pre>
            ))}
        </div>
      ) : null}
    </div>
  );
}
