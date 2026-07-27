"use client";

import {
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/** Collapsed → expand. Expanded → collapse. */
export function CollapseExpandIcon({
  expanded,
  className,
  variant = "grok",
}: {
  expanded: boolean;
  className?: string;
  /** `simple`: chevron-right / chevron-up. `grok`: dual chevrons. */
  variant?: "simple" | "grok";
}) {
  const Icon =
    variant === "simple"
      ? expanded
        ? ChevronUpIcon
        : ChevronRightIcon
      : expanded
        ? ChevronsDownUpIcon
        : ChevronsUpDownIcon;

  return (
    <Icon
      className={cn(
        "size-3.5 shrink-0",
        variant === "simple" ? "stroke-[2]" : "stroke-[1.75]",
        className,
      )}
      aria-hidden
    />
  );
}
