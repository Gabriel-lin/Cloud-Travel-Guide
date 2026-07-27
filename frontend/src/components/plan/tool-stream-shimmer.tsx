"use client";

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Left-to-right shimmer while a tool row / label is in progress (Cursor-style). */
export function ToolStreamShimmer({
  active,
  className,
  children,
}: {
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex max-w-full overflow-hidden",
        active && "tool-stream-shimmer",
        className,
      )}
    >
      {children}
    </span>
  );
}
