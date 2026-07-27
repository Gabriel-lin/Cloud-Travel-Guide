"use client";

import { useEffect, useMemo } from "react";

import { cn } from "@/lib/utils";

function base64ToBlob(base64: string): Blob | null {
  try {
    const binary = atob(base64.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: "application/pdf" });
  } catch {
    return null;
  }
}

/** Browser-native PDF preview via blob URL + iframe (Chrome / Edge / Electron). */
export function PdfViewer({
  data,
  className,
}: {
  /** Base64-encoded PDF bytes (without data: URL prefix). */
  data: string;
  className?: string;
}) {
  const blob = useMemo(() => base64ToBlob(data), [data]);
  const url = useMemo(() => {
    if (!blob) return null;
    return URL.createObjectURL(blob);
  }, [blob]);

  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  if (!blob || !url) {
    return (
      <p className="text-xs text-red-400">Failed to decode PDF data.</p>
    );
  }

  return (
    <iframe
      src={url}
      title="PDF preview"
      className={cn(
        "h-[min(70vh,560px)] w-full rounded-md border border-surface-700/60 bg-white",
        className,
      )}
    />
  );
}

export default PdfViewer;
