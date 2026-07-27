"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { useToolCallElapsed } from "@assistant-ui/react";
import { ChevronDownIcon, LoaderIcon } from "lucide-react";
import { memo, useState } from "react";

import {
  basename,
  formatJsonish,
  parseFileToolArgs,
} from "@/components/plan/artifact-utils";
import { FileToolArtifact } from "@/components/plan/file-preview";
import { useAppLocale } from "@/hooks/use-app-locale";
import { cn } from "@/lib/utils";

function formatDuration(ms: number): string {
  if (ms < 1000) return "<1s";
  const seconds = ms / 1000;
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`;
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
}

function summarizeTool(
  toolName: string,
  args: unknown,
  t: (key: string, values?: Record<string, string | number>) => string,
): { verb: string; detail?: string } {
  const file = parseFileToolArgs(args).filePath;
  const fileName = file ? basename(file) : undefined;

  switch (toolName) {
    case "web_search":
    case "tavily_search":
    case "duckduckgo_search":
      return { verb: t("plan.toolVerbSearch") };
    case "write_file":
      return {
        verb: t("plan.toolVerbWrite"),
        detail: fileName,
      };
    case "read_file":
      return {
        verb: t("plan.toolVerbRead"),
        detail: fileName,
      };
    case "list_directory":
      return { verb: t("plan.toolVerbList"), detail: fileName };
    case "file_search":
      return { verb: t("plan.toolVerbFind") };
    case "slugify":
      return { verb: t("plan.toolVerbSlugify") };
    default:
      return { verb: toolName };
  }
}

const ToolCallPartImpl: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  args,
  result,
  status,
  isError,
}) => {
  const { t } = useAppLocale();
  const statusType =
    status?.type ?? (result !== undefined ? "complete" : "running");
  const isRunning = statusType === "running";
  const isIncomplete = statusType === "incomplete" || Boolean(isError);
  const isRequiresAction = statusType === "requires-action";
  const [open, setOpen] = useState(isRequiresAction || isIncomplete);
  const elapsedMs = useToolCallElapsed();

  const fileArgs = parseFileToolArgs(args);
  const showFileArtifact =
    toolName === "read_file" &&
    Boolean(fileArgs.filePath) &&
    typeof result === "string" &&
    result.length > 0;

  const resultText = formatJsonish(result);
  const argsDisplay = argsText?.trim() || formatJsonish(args);
  const { verb, detail } = summarizeTool(toolName, args, t);

  const durationLabel =
    elapsedMs !== undefined
      ? formatDuration(elapsedMs)
      : isRunning
        ? "…"
        : null;

  return (
    <div className="my-1.5 text-xs">
      <button
        type="button"
        className="group inline-flex max-w-full cursor-pointer items-center gap-1.5 text-left text-ink-300 hover:text-ink-100"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {isRunning ? (
          <LoaderIcon className="size-3 shrink-0 animate-spin text-ink-500" />
        ) : null}
        <span className="text-ink-500">{verb}</span>
        {detail ? (
          <span className="min-w-0 truncate font-medium text-ink-100">
            {detail}
          </span>
        ) : (
          <span className="min-w-0 truncate font-mono text-ink-200">
            {toolName}
          </span>
        )}
        {durationLabel ? (
          <span className="shrink-0 tabular-nums text-ink-500">
            {durationLabel}
          </span>
        ) : null}
        <ChevronDownIcon
          className={cn(
            "size-3 shrink-0 text-ink-500 transition-transform group-hover:text-ink-300",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="mt-1.5 space-y-2 border-l border-surface-700/50 pl-3 ml-0.5">
          {argsDisplay ? (
            <div>
              <p className="mb-0.5 text-[11px] text-ink-500">
                {t("plan.toolArgs")}
              </p>
              <pre className="max-h-40 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word text-ink-400">
                {argsDisplay}
              </pre>
            </div>
          ) : null}

          {resultText ? (
            <div>
              <p className="mb-0.5 text-[11px] text-ink-500">
                {isIncomplete ? t("plan.toolError") : t("plan.toolResult")}
              </p>
              <pre
                className={cn(
                  "max-h-52 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap wrap-break-word",
                  isIncomplete ? "text-red-300" : "text-ink-300",
                )}
              >
                {resultText}
              </pre>
            </div>
          ) : isRunning ? (
            <p className="text-[11px] text-ink-500">{t("plan.toolWaiting")}</p>
          ) : null}

          {showFileArtifact ? (
            <FileToolArtifact
              filePath={fileArgs.filePath!}
              text={typeof result === "string" ? result : undefined}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const ToolCallPart = memo(
  ToolCallPartImpl,
) as unknown as ToolCallMessagePartComponent;

ToolCallPart.displayName = "ToolCallPart";
