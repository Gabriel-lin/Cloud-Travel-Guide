"use client";

import {
  MessagePrimitive,
  useAuiState,
  useMessagePartImage,
  useMessagePartReasoning,
} from "@assistant-ui/react";
import { useState } from "react";

import { FilePart } from "@/components/plan/file-preview";
import { MarkdownText } from "@/components/plan/markdown-text";
import { CollapseExpandIcon } from "@/components/plan/collapse-expand-icon";
import { StreamingDots } from "@/components/plan/streaming-dots";
import { ToolActivityGroup } from "@/components/plan/tool-activity-group";
import { extractLegacyToolsFromText } from "@/components/plan/strip-legacy-tool-status";
import { useAppLocale } from "@/hooks/use-app-locale";

export function ReasoningPart() {
  const { text } = useMessagePartReasoning();
  const { t } = useAppLocale();
  const [open, setOpen] = useState(false);

  if (!text?.trim()) return null;

  return (
    <div className="my-2 text-xs">
      <button
        type="button"
        className="group inline-flex cursor-pointer items-center gap-1.5 text-ink-400 hover:text-ink-200"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{t("plan.thoughtBriefly")}</span>
        <CollapseExpandIcon
          expanded={open}
          className="text-ink-500 group-hover:text-ink-300"
        />
      </button>
      {open ? (
        <div className="mt-2 leading-relaxed whitespace-pre-wrap text-ink-500">
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

function LoadingIndicator() {
  return <StreamingDots className="my-1" />;
}

/** Dots while waiting for the next segment — never duplicate tool shimmer / markdown cursor. */
function MessageRunningFooter() {
  const show = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    const parts = s.message.parts;
    if (parts.length === 0) return false;

    const last = parts[parts.length - 1];
    if (last?.type === "text" || last?.type === "reasoning") {
      return false;
    }
    if (last?.type === "tool-call") {
      return last.result !== undefined || Boolean(last.isError);
    }
    return true;
  });

  if (!show) return null;
  return <StreamingDots className="mt-2" />;
}

/** Show tools parsed from raw text when structured tool-call parts are absent. */
function LegacyToolsFallback() {
  const legacyToolsKey = useAuiState((s) => {
    if (s.message.parts.some((part) => part.type === "tool-call")) return "";
    const rawText = s.message.parts
      .filter((part) => part.type === "text")
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n");
    return extractLegacyToolsFromText(rawText).join("\0");
  });

  if (!legacyToolsKey) return null;
  return <ToolActivityGroup legacyToolNames={legacyToolsKey.split("\0")} />;
}

export function MessageParts() {
  return (
    <>
      <LegacyToolsFallback />
      <MessagePrimitive.Parts
        unstable_showEmptyOnNonTextEnd={false}
        components={{
          Text: MarkdownText,
          Reasoning: ReasoningPart,
          Image: ImagePart,
          File: FilePart,
          ToolGroup: ToolActivityGroup,
          tools: { Fallback: () => null },
          Empty: LoadingIndicator,
        }}
      />
      <MessageRunningFooter />
    </>
  );
}
