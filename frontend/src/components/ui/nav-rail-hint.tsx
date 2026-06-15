"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type NavRailHintProps = {
  label: string;
  children: ReactNode;
  className?: string;
  side?: "right" | "left";
};

/**
 * Icon-rail hover label — CSS flyout without tooltip arrow/popover chrome.
 * Used for collapsed sidebar / narrow navigation rails.
 */
export function NavRailHint({
  label,
  children,
  className,
  side = "right",
}: NavRailHintProps) {
  const isRight = side === "right";

  return (
    <div
      className={cn(
        "group/nav-hint relative flex w-full items-center justify-center",
        className,
      )}
    >
      {children}
      <div
        role="tooltip"
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 z-50 -translate-y-1/2",
          "opacity-0 transition-[opacity,transform] duration-150 ease-out",
          "group-hover/nav-hint:opacity-100 group-focus-within/nav-hint:opacity-100",
          isRight
            ? "left-full ml-2 translate-x-[-6px] group-hover/nav-hint:translate-x-0 group-focus-within/nav-hint:translate-x-0"
            : "right-full mr-2 translate-x-[6px] group-hover/nav-hint:translate-x-0 group-focus-within/nav-hint:translate-x-0",
        )}
      >
        <div
          className={cn(
            "whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium tracking-wide text-ink-100",
            "bg-surface-900/95 shadow-[0_4px_24px_rgba(0,0,0,0.45)] ring-1 ring-brand-500/20 backdrop-blur-md",
          )}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
