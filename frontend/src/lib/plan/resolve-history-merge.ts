import type { PlanThreadHistoryRepo } from "@/service/plan";

import type { PlanThreadSyncRecord } from "./thread-storage";
import {
  historyReposEqual,
  localHasMessagesNotOnServer,
} from "./merge-history-repos";

export type HistoryMergeDecision = "push-local" | "keep-server" | "push-merged";

/**
 * Decide how to reconcile local vs server history during P3 merge.
 */
export function resolveHistoryMergeDecision(
  local: PlanThreadHistoryRepo,
  server: PlanThreadHistoryRepo,
  serverUpdatedAt: string | null | undefined,
  priorSync: PlanThreadSyncRecord | undefined,
): HistoryMergeDecision {
  const localLen = local.messages?.length ?? 0;
  const serverLen = server.messages?.length ?? 0;

  if (localLen === 0) return "keep-server";
  if (serverLen === 0) return "push-local";

  if (localHasMessagesNotOnServer(local, server)) {
    return "push-merged";
  }

  if (localLen > serverLen) return "push-local";

  if (
    priorSync &&
    serverUpdatedAt &&
    priorSync.serverUpdatedAt === serverUpdatedAt &&
    priorSync.localMessageCount === localLen &&
    historyReposEqual(local, server)
  ) {
    return "keep-server";
  }

  if (!historyReposEqual(local, server)) {
    return "push-merged";
  }

  return "keep-server";
}
