"use client";

import { cn } from "@/lib/utils";

/** Bouncing dots — visible streaming / waiting indicator (no label text). */
export function StreamingDots({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 py-0.5", className)}
      role="status"
      aria-label="Loading"
    >
      <span className="streaming-dot" />
      <span className="streaming-dot streaming-dot-delay-1" />
      <span className="streaming-dot streaming-dot-delay-2" />
    </span>
  );
}
