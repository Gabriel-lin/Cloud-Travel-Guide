"use client";

import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Borderless header action — matches Cursor / reference chrome. */
export function HeaderActionButton({
  label,
  showLabel = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  showLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm px-0.5 text-[11px] text-ink-400 transition-colors",
        "hover:text-ink-100",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/50",
        className,
      )}
      {...props}
    >
      {children}
      {showLabel ? <span>{label}</span> : null}
    </button>
  );
}
