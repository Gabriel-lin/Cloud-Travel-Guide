"use client";

import type {
  ChatModelAdapter,
  RemoteThreadListAdapter,
  ThreadAssistantMessagePart,
  ThreadMessage,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  generateId,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { createLocalStorageAdapter } from "@assistant-ui/core/react";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { PlanCloudThreadSync } from "@/components/plan/PlanCloudThreadSync";
import { StreamingDots } from "@/components/plan/streaming-dots";

import {
  basename,
  isMarkdownPath,
  isPdfPath,
  mimeForPath,
  normalizeToolArgs,
  parseFileToolArgs,
} from "@/components/plan/artifact-utils";
import { filePartFromToolResult } from "@/components/plan/tool-file-parts";
import { createPlanRemoteThreadAdapter } from "@/components/plan/plan-remote-thread-adapter";
import { toWorkspaceFileDataRef } from "@/lib/plan/sanitize-history-for-cloud";
import { planService } from "@/service/plan";
import type { PlanChatMessage } from "@/service/plan";
import { useAuthStore } from "@/store/auth-store";
import { usePlanUiStore } from "@/store/plan-ui-store";

import { PLAN_THREAD_STORAGE_PREFIX } from "@/lib/plan/thread-storage";

type StoredThread = Awaited<
  ReturnType<RemoteThreadListAdapter["list"]>
>["threads"][number];

function sortThreadsByPinned(threads: StoredThread[]): StoredThread[] {
  return [...threads].sort((a, b) => {
    const aPinned = Boolean(a.custom?.pinned);
    const bPinned = Boolean(b.custom?.pinned);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    if (!aPinned) return 0;
    const aAt = typeof a.custom?.pinnedAt === "number" ? a.custom.pinnedAt : 0;
    const bAt = typeof b.custom?.pinnedAt === "number" ? b.custom.pinnedAt : 0;
    return bAt - aAt;
  });
}

/** Keep pinned threads at the top across reloads. */
function withPinnedThreadOrder(
  adapter: RemoteThreadListAdapter,
): RemoteThreadListAdapter {
  return {
    ...adapter,
    async list() {
      const result = await adapter.list();
      return {
        ...result,
        threads: sortThreadsByPinned(result.threads ?? []),
      };
    },
  };
}

async function generateThreadTitle(
  messages: readonly ThreadMessage[],
): Promise<string> {
  const firstUserMessage = messages.find((m) => m.role === "user");
  if (!firstUserMessage) return "";

  const textPart = firstUserMessage.content.find((p) => p.type === "text");
  if (!textPart || textPart.type !== "text") return "";

  const text = textPart.text.trim();
  if (!text) return "";
  return text.length > 50 ? `${text.slice(0, 47)}...` : text;
}

function threadMessagesToApi(messages: readonly ThreadMessage[]): PlanChatMessage[] {
  const out: PlanChatMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text) continue;
    out.push({ role: message.role, content: text });
  }
  return out;
}

function findToolPartIndex(
  parts: ThreadAssistantMessagePart[],
  toolCallId: string | undefined,
  name: string,
): number {
  if (toolCallId) {
    const byId = parts.findIndex(
      (p) => p.type === "tool-call" && p.toolCallId === toolCallId,
    );
    if (byId >= 0) return byId;
  }
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (
      part?.type === "tool-call" &&
      part.toolName === name &&
      part.result === undefined
    ) {
      return i;
    }
  }
  return -1;
}

function maybeFilePartFromWrite(
  toolName: string,
  args: Record<string, unknown>,
): ThreadAssistantMessagePart | null {
  if (toolName !== "write_file") return null;
  const { filePath, text } = parseFileToolArgs(args);
  if (!filePath || text == null || text === "") return null;
  if (!isMarkdownPath(filePath) && !isPdfPath(filePath)) return null;

  // Prefer workspace refs so history stays small and syncs across clients.
  return {
    type: "file",
    filename: basename(filePath),
    mimeType: mimeForPath(filePath),
    data: toWorkspaceFileDataRef(filePath),
  };
}

function createPlanChatModelAdapter(
  getAgentId: () => string | null,
  getPlanId: () => string | null,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const agentId = getAgentId() ?? "travel-planner";
      const planId = getPlanId() ?? undefined;
      const parts: ThreadAssistantMessagePart[] = [];
      let activeTextIdx: number | null = null;
      let activeReasoningIdx: number | null = null;

      const snapshot = () => ({
        content: parts.map((part) =>
          part.type === "tool-call" ? { ...part } : { ...part },
        ) as ThreadAssistantMessagePart[],
      });

      const cancelledResult = () => ({
        ...snapshot(),
        status: { type: "incomplete" as const, reason: "cancelled" as const },
      });

      const ensureTextPart = (): number => {
        if (
          activeTextIdx === null ||
          parts[activeTextIdx]?.type !== "text"
        ) {
          activeTextIdx = parts.push({ type: "text", text: "" }) - 1;
        }
        activeReasoningIdx = null;
        return activeTextIdx;
      };

      const appendReasoning = (line: string) => {
        activeTextIdx = null;
        if (
          activeReasoningIdx === null ||
          parts[activeReasoningIdx]?.type !== "reasoning"
        ) {
          activeReasoningIdx =
            parts.push({ type: "reasoning", text: line }) - 1;
          return;
        }
        const current = parts[activeReasoningIdx];
        if (current?.type === "reasoning") {
          parts[activeReasoningIdx] = {
            type: "reasoning",
            text: `${current.text}\n${line}`,
          };
        }
      };

      try {
        for await (const event of planService.streamChat(
          {
            agentId,
            planId,
            messages: threadMessagesToApi(messages),
          },
          abortSignal,
        )) {
          if (abortSignal.aborted) {
            yield cancelledResult();
            return;
          }
          if (event.type === "start") {
            yield snapshot();
            continue;
          }
          if (event.type === "delta") {
            const idx = ensureTextPart();
            const current = parts[idx];
            if (current?.type === "text") {
              parts[idx] = {
                type: "text",
                text: `${current.text}${event.text}`,
              };
            }
            yield snapshot();
          } else if (event.type === "tool_start") {
            activeTextIdx = null;
            activeReasoningIdx = null;
            const args = normalizeToolArgs(event.input) as ToolCallMessagePart["args"];
            const toolCallId = event.toolCallId || generateId();
            const toolPart: ToolCallMessagePart = {
              type: "tool-call",
              toolCallId,
              toolName: event.name,
              args,
              argsText: JSON.stringify(args, null, 2),
            };
            parts.push(toolPart);
            const filePart = maybeFilePartFromWrite(
              event.name,
              args as Record<string, unknown>,
            );
            if (filePart) parts.push(filePart);
            yield snapshot();
          } else if (event.type === "tool_result") {
            const idx = findToolPartIndex(
              parts,
              event.toolCallId,
              event.name,
            );
            let toolArgs: unknown;
            if (idx >= 0) {
              const current = parts[idx];
              if (current?.type === "tool-call") {
                toolArgs = current.args;
                parts[idx] = {
                  ...current,
                  result: event.outputPreview ?? "",
                };
              }
            }
            const filePart = await filePartFromToolResult(
              event.name,
              event.outputPreview ?? "",
              toolArgs,
            );
            if (filePart) parts.push(filePart);
            yield snapshot();
          } else if (event.type === "tool_error") {
            const idx = findToolPartIndex(
              parts,
              event.toolCallId,
              event.name,
            );
            if (idx >= 0) {
              const current = parts[idx];
              if (current?.type === "tool-call") {
                parts[idx] = {
                  ...current,
                  result: event.message,
                  isError: true,
                };
              }
            } else {
              parts.push({
                type: "tool-call",
                toolCallId: event.toolCallId || generateId(),
                toolName: event.name,
                args: {},
                argsText: "{}",
                result: event.message,
                isError: true,
              });
            }
            yield snapshot();
          } else if (event.type === "job_progress") {
            const pct =
              typeof event.percent === "number" ? ` ${event.percent}%` : "";
            appendReasoning(
              `任务 ${event.jobId.slice(0, 8)}… ${event.status}${pct}${
                event.message ? ` — ${event.message}` : ""
              }`,
            );
            yield snapshot();
          } else if (event.type === "plan_updated") {
            appendReasoning(
              `行程已更新：${event.summary ?? event.planId}`,
            );
            yield snapshot();
          } else if (event.type === "error") {
            const hasContent = parts.some(
              (p) =>
                (p.type === "text" && p.text.trim()) ||
                p.type === "tool-call" ||
                p.type === "file",
            );
            if (!hasContent) {
              parts.push({ type: "text", text: event.message });
            }
            yield {
              ...snapshot(),
              status: {
                type: "incomplete",
                reason: "error",
                error: event.message,
              },
            };
            return;
          }
        }

        if (abortSignal.aborted) {
          yield cancelledResult();
          return;
        }

        yield {
          ...snapshot(),
          status: { type: "complete", reason: "stop" },
        };
      } catch (error) {
        if (abortSignal.aborted) {
          yield cancelledResult();
          return;
        }
        const message =
          error instanceof Error ? error.message : "Chat request failed";
        const hasContent = parts.some(
          (p) =>
            (p.type === "text" && p.text.trim()) ||
            p.type === "tool-call" ||
            p.type === "file",
        );
        if (!hasContent) {
          parts.push({ type: "text", text: message });
        }
        yield {
          ...snapshot(),
          status: { type: "incomplete", reason: "error", error: message },
        };
      }
    },
  };
}

const attachmentAdapter = new CompositeAttachmentAdapter([
  new SimpleImageAttachmentAdapter(),
  new SimpleTextAttachmentAdapter(),
]);

const browserAsyncStorage = {
  async getItem(key: string) {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  },
  async setItem(key: string, value: string) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  },
  async removeItem(key: string) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  },
};

/** Per-thread LocalRuntime — used as runtimeHook for RemoteThreadList. */
function usePlanLocalRuntime() {
  const chatModel = useMemo(
    () =>
      createPlanChatModelAdapter(
        () => usePlanUiStore.getState().agentId,
        () => usePlanUiStore.getState().planId,
      ),
    [],
  );

  return useLocalRuntime(chatModel, {
    adapters: {
      attachments: attachmentAdapter,
    },
  });
}

export function PlanRuntimeProvider({ children }: { children: ReactNode }) {
  const authReady = useAuthStore((s) => s.ready);
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");

  const titleGenerator = useMemo(
    () => ({ generateTitle: generateThreadTitle }),
    [],
  );

  const threadListAdapter = useMemo(
    () =>
      withPinnedThreadOrder(
        isAuthenticated
          ? createPlanRemoteThreadAdapter({ titleGenerator })
          : createLocalStorageAdapter({
              storage: browserAsyncStorage,
              prefix: PLAN_THREAD_STORAGE_PREFIX,
              titleGenerator,
            }),
      ),
    [isAuthenticated, titleGenerator],
  );

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: usePlanLocalRuntime,
    adapter: threadListAdapter,
  });

  const storageKey = authReady ? (isAuthenticated ? "remote" : "local") : "pending";

  if (!authReady) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <StreamingDots />
      </div>
    );
  }

  return (
    <AssistantRuntimeProvider key={storageKey} runtime={runtime}>
      {isAuthenticated ? <PlanCloudThreadSync /> : null}
      {children}
    </AssistantRuntimeProvider>
  );
}
