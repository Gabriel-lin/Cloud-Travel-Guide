"use client";

import { CollapseExpandIcon } from "@/components/plan/collapse-expand-icon";
import { cn } from "@/lib/utils";

/** Borderless expand/collapse — Grok-style dual chevrons. */
export function ChevronToggle({
  open,
  label,
  onClick,
  className,
}: {
  open: boolean;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={open}
      onClick={onClick}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-ink-400 transition-colors hover:text-ink-100",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-500/40",
        className,
      )}
    >
      <CollapseExpandIcon expanded={open} />
    </button>
  );
}
