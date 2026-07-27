"use client";

import { useAuiState } from "@assistant-ui/react";
import { useMemo, useState, type ReactNode } from "react";

import { formatJsonish } from "@/components/plan/artifact-utils";
import { CollapseExpandIcon } from "@/components/plan/collapse-expand-icon";
import { formatToolAction } from "@/components/plan/tool-action-format";
import { ToolStreamShimmer } from "@/components/plan/tool-stream-shimmer";
import { useAppLocale } from "@/hooks/use-app-locale";
import { cn } from "@/lib/utils";

type ToolRow = {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  argsText?: string;
  result?: unknown;
  isError?: boolean;
  partStatus?: string;
};

function isToolRunning(tool: ToolRow): boolean {
  if (tool.isError) return false;
  if (tool.partStatus === "running") return true;
  return tool.result === undefined;
}

function ToolActionRow({
  tool,
  t,
  index,
}: {
  tool: ToolRow;
  t: (key: string, values?: Record<string, string | number>) => string;
  index: number;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  const running = isToolRunning(tool);
  const { verb, target } = formatToolAction(tool.toolName, tool.args, t);
  const argsDisplay = tool.argsText?.trim() || formatJsonish(tool.args);
  const resultText = formatJsonish(tool.result);
  const hasDetail = Boolean(argsDisplay || resultText || running);

  return (
    <div
      className="tool-row-enter text-[11px] leading-relaxed"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <button
        type="button"
        disabled={!hasDetail}
        className={cn(
          "inline-flex max-w-full items-center gap-1 text-left",
          hasDetail
            ? "cursor-pointer text-ink-300 hover:text-ink-100"
            : "cursor-default text-ink-400",
        )}
        onClick={() => hasDetail && setDetailOpen((v) => !v)}
        aria-expanded={detailOpen}
      >
        <ToolStreamShimmer active={running}>
          <span className="text-ink-200">{verb}</span>
          {target ? (
            <span className="min-w-0 truncate text-ink-500">{target}</span>
          ) : (
            <span className="font-mono text-ink-500">{tool.toolName}</span>
          )}
        </ToolStreamShimmer>
      </button>

      {detailOpen && hasDetail ? (
        <div className="mt-1 space-y-1.5 border-l border-surface-700/40 pl-2.5">
          {argsDisplay ? (
            <pre className="max-h-36 overflow-auto font-mono whitespace-pre-wrap wrap-break-word text-ink-500">
              {argsDisplay}
            </pre>
          ) : null}
          {resultText ? (
            <pre
              className={cn(
                "max-h-48 overflow-auto font-mono whitespace-pre-wrap wrap-break-word",
                tool.isError ? "text-red-300" : "text-ink-400",
              )}
            >
              {resultText}
            </pre>
          ) : running ? (
            <p className="text-ink-500">{t("plan.toolWaiting")}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type ToolActivityGroupProps = {
  startIndex?: number;
  endIndex?: number;
  children?: ReactNode;
  legacyToolNames?: readonly string[];
};

export function ToolActivityGroup({
  startIndex,
  endIndex,
  children,
  legacyToolNames,
}: ToolActivityGroupProps) {
  const { t } = useAppLocale();
  const [openWhenIdle, setOpenWhenIdle] = useState(true);

  const parts = useAuiState((s) => s.message.parts);
  const isMessageRunning = useAuiState(
    (s) => s.message.status?.type === "running",
  );

  const tools = useMemo(() => {
    const rows: ToolRow[] = [];
    const from = startIndex ?? 0;
    const to = endIndex ?? parts.length - 1;

    for (let index = from; index <= to && index < parts.length; index += 1) {
      const part = parts[index];
      if (part?.type !== "tool-call") continue;
      rows.push({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.args,
        argsText: part.argsText,
        result: part.result,
        isError: part.isError,
        partStatus: part.status?.type,
      });
    }
    return rows;
  }, [endIndex, parts, startIndex]);

  const legacyTools = useMemo<ToolRow[]>(() => {
    if (tools.length > 0 || !legacyToolNames?.length) return [];
    return legacyToolNames.map((toolName, index) => ({
      toolCallId: `legacy-${toolName}-${index}`,
      toolName,
      result: "",
    }));
  }, [legacyToolNames, tools.length]);

  const displayTools = tools.length > 0 ? tools : legacyTools;

  const anyRunning = displayTools.some((tool) => isToolRunning(tool));
  const forceOpen = isMessageRunning && anyRunning;
  const open = forceOpen || openWhenIdle;

  const summary = useMemo(() => {
    if (anyRunning) return t("plan.toolsSummaryRunning");
    return t("plan.toolsSummary", { count: displayTools.length });
  }, [anyRunning, displayTools.length, t]);

  const previewLog = useMemo(() => {
    const segments: string[] = [];
    for (const tool of displayTools) {
      const running = isToolRunning(tool);
      segments.push(`${t("plan.toolLogStart")}: ${tool.toolName}`);
      if (!running) {
        segments.push(
          tool.isError
            ? `${t("plan.toolLogFail")}: ${tool.toolName}`
            : `${t("plan.toolLogDone")}: ${tool.toolName}`,
        );
      }
    }
    return segments.join(" ");
  }, [displayTools, t]);

  if (displayTools.length === 0) return null;

  return (
    <div className="my-2 text-xs">
      <button
        type="button"
        className="group inline-flex cursor-pointer items-center gap-1.5 text-ink-400 hover:text-ink-200"
        onClick={() => setOpenWhenIdle((v) => !v)}
        aria-expanded={open}
      >
        <ToolStreamShimmer active={anyRunning}>
          <span className="text-ink-300">{summary}</span>
        </ToolStreamShimmer>
        <CollapseExpandIcon
          expanded={open}
          variant="simple"
          className="text-ink-500 group-hover:text-ink-300"
        />
      </button>

      {!open ? (
        <p className="mt-1 line-clamp-2 leading-relaxed text-ink-500 italic">
          {previewLog}
        </p>
      ) : (
        <div className="mt-2 space-y-1">
          {displayTools.map((tool, index) => (
            <ToolActionRow
              key={tool.toolCallId}
              tool={tool}
              t={t}
              index={index}
            />
          ))}
        </div>
      )}

      {children ? <div className="hidden">{children}</div> : null}
    </div>
  );
}
