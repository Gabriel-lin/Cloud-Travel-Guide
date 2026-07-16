"use client";

import type { ChatModelAdapter, RemoteThreadListAdapter, ThreadMessage } from "@assistant-ui/react";
import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { createLocalStorageAdapter } from "@assistant-ui/core/react";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { planService } from "@/service/plan";
import type { PlanChatMessage } from "@/service/plan";
import { usePlanUiStore } from "@/store/plan-ui-store";

const PLAN_THREAD_STORAGE_PREFIX = "ctg-plan:";

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
      return { ...result, threads: sortThreadsByPinned(result.threads) };
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

function createPlanChatModelAdapter(getAgentId: () => string | null): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const agentId = getAgentId() ?? "travel-planner";
      let text = "";

      try {
        for await (const event of planService.streamChat(
          {
            agentId,
            messages: threadMessagesToApi(messages),
          },
          abortSignal,
        )) {
          if (event.type === "delta") {
            text += event.text;
            yield {
              content: [{ type: "text", text }],
            };
          } else if (event.type === "error") {
            yield {
              content: [{ type: "text", text: text || event.message }],
              status: { type: "incomplete", reason: "error", error: event.message },
            };
            return;
          }
        }

        yield {
          content: [{ type: "text", text }],
          status: { type: "complete", reason: "stop" },
        };
      } catch (error) {
        if (abortSignal.aborted) {
          yield {
            content: [{ type: "text", text }],
            status: { type: "incomplete", reason: "cancelled" },
          };
          return;
        }
        const message =
          error instanceof Error ? error.message : "Chat request failed";
        yield {
          content: [{ type: "text", text: text || message }],
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
      createPlanChatModelAdapter(() => usePlanUiStore.getState().agentId),
    [],
  );

  return useLocalRuntime(chatModel, {
    adapters: {
      attachments: attachmentAdapter,
    },
  });
}

export function PlanRuntimeProvider({ children }: { children: ReactNode }) {
  const threadListAdapter = useMemo(
    () =>
      withPinnedThreadOrder(
        createLocalStorageAdapter({
          storage: browserAsyncStorage,
          prefix: PLAN_THREAD_STORAGE_PREFIX,
          titleGenerator: { generateTitle: generateThreadTitle },
        }),
      ),
    [],
  );

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: usePlanLocalRuntime,
    adapter: threadListAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
