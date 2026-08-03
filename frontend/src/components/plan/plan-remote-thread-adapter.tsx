"use client";

import type {
  RemoteThreadListAdapter,
  ThreadMessage,
} from "@assistant-ui/react";
import {
  RuntimeAdapterProvider,
  type RuntimeAdapters,
  type TitleGenerationAdapter,
} from "@assistant-ui/core/react";
import { useAui } from "@assistant-ui/store";
import { createAssistantStream } from "assistant-stream";
import type { PropsWithChildren } from "react";
import { useMemo } from "react";

import { mergeHistoryRepos } from "@/lib/plan/merge-history-repos";
import { sanitizeHistoryForCloud } from "@/lib/plan/sanitize-history-for-cloud";
import {
  PLAN_THREAD_STORAGE_PREFIX,
  readLocalPlanThreadHistory,
} from "@/lib/plan/thread-storage";
import { planService } from "@/service/plan";
import type { PlanThreadHistoryRepo } from "@/service/plan";

type HistoryItem = {
  message: ThreadMessage;
  parentId: string | null;
};

type MessageRepository = {
  messages: HistoryItem[];
  headId?: string | null;
};

function writeLocalHistoryBackup(
  remoteId: string,
  repo: PlanThreadHistoryRepo,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${PLAN_THREAD_STORAGE_PREFIX}messages:${remoteId}`,
      JSON.stringify(sanitizeHistoryForCloud(repo)),
    );
  } catch {
    // Quota / private mode — cloud write is still attempted.
  }
}

class RemotePlanThreadHistoryAdapter {
  constructor(
    private readonly aui: ReturnType<typeof useAui>,
  ) {}

  async load(): Promise<MessageRepository> {
    const remoteId = this.aui.threadListItem().getState().remoteId;
    if (!remoteId) return { messages: [] };
    try {
      const server = await planService.getPlanThreadHistory(remoteId);
      // Sanitize local before merge so oversized base64 does not win over cloud refs.
      const local = sanitizeHistoryForCloud(
        readLocalPlanThreadHistory(remoteId),
      );
      const repo = mergeHistoryRepos(local, server);
      return {
        messages: (repo.messages ?? []) as HistoryItem[],
        headId: repo.headId ?? undefined,
      };
    } catch {
      const local = sanitizeHistoryForCloud(
        readLocalPlanThreadHistory(remoteId),
      );
      return {
        messages: (local.messages ?? []) as HistoryItem[],
        headId: local.headId ?? undefined,
      };
    }
  }

  async append(item: HistoryItem): Promise<void> {
    const { remoteId } = await this.aui.threadListItem().initialize();
    let repo: MessageRepository = { messages: [] };
    try {
      const server = await planService.getPlanThreadHistory(remoteId);
      const local = sanitizeHistoryForCloud(
        readLocalPlanThreadHistory(remoteId),
      );
      repo = mergeHistoryRepos(local, server) as MessageRepository;
    } catch {
      repo = mergeHistoryRepos(
        sanitizeHistoryForCloud(readLocalPlanThreadHistory(remoteId)),
        { messages: [] },
      ) as MessageRepository;
    }

    const messages = [...repo.messages];
    const idx = messages.findIndex(
      (entry) => entry.message?.id === item.message.id,
    );
    if (idx >= 0) messages[idx] = item;
    else messages.push(item);

    let putPayload: PlanThreadHistoryRepo = sanitizeHistoryForCloud({
      messages,
      headId: item.message.id,
    });

    writeLocalHistoryBackup(remoteId, putPayload);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await planService.putPlanThreadHistory(remoteId, putPayload);
        writeLocalHistoryBackup(remoteId, putPayload);
        return;
      } catch (error) {
        if (attempt === 2) {
          console.error(
            "[plan] Failed to persist thread history after sanitize/retry:",
            error,
          );
          // Do not throw — keep chat usable; local backup already written.
          return;
        }
        try {
          const server = await planService.getPlanThreadHistory(remoteId);
          const merged = mergeHistoryRepos(putPayload, server);
          const next = [...(merged.messages ?? [])] as HistoryItem[];
          const retryIdx = next.findIndex(
            (entry) => entry.message?.id === item.message.id,
          );
          if (retryIdx >= 0) next[retryIdx] = item;
          else next.push(item);
          putPayload = sanitizeHistoryForCloud({
            messages: next,
            headId: item.message.id,
          });
          writeLocalHistoryBackup(remoteId, putPayload);
        } catch (mergeError) {
          console.error("[plan] history merge retry failed:", mergeError);
        }
      }
    }
  }
}

function createHistoryProvider(): RemoteThreadListAdapter["unstable_Provider"] {
  const Provider = ({ children }: PropsWithChildren) => {
    const aui = useAui();
    const history = useMemo(
      () =>
        new RemotePlanThreadHistoryAdapter(aui) as NonNullable<
          RuntimeAdapters["history"]
        >,
      [aui],
    );
    return (
      <RuntimeAdapterProvider adapters={{ history }}>{children}</RuntimeAdapterProvider>
    );
  };
  return Provider;
}

export type PlanRemoteThreadAdapterOptions = {
  titleGenerator?: TitleGenerationAdapter;
};

/** Cloud-backed {@link RemoteThreadListAdapter} for logged-in users. */
export function createPlanRemoteThreadAdapter(
  options: PlanRemoteThreadAdapterOptions = {},
): RemoteThreadListAdapter {
  const { titleGenerator } = options;

  return {
    unstable_Provider: createHistoryProvider(),

    async list() {
      const data = await planService.listPlanThreads();
      return {
        threads: (data.threads ?? []).map((t) => ({
          remoteId: t.remoteId,
          externalId: t.externalId ?? undefined,
          status: t.status,
          title: t.title ?? undefined,
          custom: t.custom ?? undefined,
          lastMessageAt: t.lastMessageAt
            ? new Date(t.lastMessageAt)
            : undefined,
        })),
      };
    },

    async initialize(threadId) {
      const data = await planService.initializePlanThread(threadId);
      return {
        remoteId: data.remoteId,
        externalId: data.externalId ?? undefined,
      };
    },

    async rename(remoteId, newTitle) {
      await planService.updatePlanThread(remoteId, { title: newTitle });
    },

    async updateCustom(remoteId, custom) {
      await planService.updatePlanThread(remoteId, { custom });
    },

    async archive(remoteId) {
      await planService.updatePlanThread(remoteId, { status: "archived" });
    },

    async unarchive(remoteId) {
      await planService.updatePlanThread(remoteId, { status: "regular" });
    },

    async delete(remoteId) {
      await planService.deletePlanThread(remoteId);
    },

    async fetch(threadId) {
      const t = await planService.getPlanThread(threadId);
      return {
        remoteId: t.remoteId,
        externalId: t.externalId ?? undefined,
        status: t.status,
        title: t.title ?? undefined,
        custom: t.custom ?? undefined,
        lastMessageAt: t.lastMessageAt ? new Date(t.lastMessageAt) : undefined,
      };
    },

    async generateTitle(remoteId, messages: readonly ThreadMessage[]) {
      if (titleGenerator) {
        const title = await titleGenerator.generateTitle(messages);
        await planService.updatePlanThread(remoteId, { title });
        return createAssistantStream((controller) => {
          controller.appendText(title);
        });
      }
      return createAssistantStream(() => {});
    },
  };
}
