"use client";

import {
  MessagePrimitive,
  useMessagePartImage,
  useMessagePartReasoning,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import "@assistant-ui/react-markdown/styles/dot.css";

export function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      className="aui-md prose prose-invert max-w-none text-sm leading-relaxed text-ink-200 prose-p:my-2 prose-pre:bg-surface-950/80 prose-code:text-brand-400"
      smooth
    />
  );
}

export function ReasoningPart() {
  const { text } = useMessagePartReasoning();
  const [open, setOpen] = useState(false);

  if (!text?.trim()) return null;

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-surface-700/70 bg-surface-900/60">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium text-ink-400 hover:text-ink-200"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform", open && "rotate-180")}
        />
        Reasoning
      </button>
      {open ? (
        <div className="border-t border-surface-700/60 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap text-ink-400">
          {text}
        </div>
      ) : null}
    </div>
  );
}

export function ImagePart() {
  const { image, filename } = useMessagePartImage();
  if (!image) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image}
      alt={filename ?? "attachment"}
      className="mt-2 max-h-72 max-w-full rounded-lg border border-surface-700/70 object-contain"
    />
  );
}

export function MessageParts() {
  return (
    <MessagePrimitive.Parts
      components={{
        Text: MarkdownText,
        Reasoning: ReasoningPart,
        Image: ImagePart,
      }}
    />
  );
}
