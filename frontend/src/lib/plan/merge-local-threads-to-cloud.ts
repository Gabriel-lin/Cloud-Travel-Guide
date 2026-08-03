import { planService } from "@/service/plan";
import type { UpdatePlanThreadPayload } from "@/service/plan";

import { resolveHistoryMergeDecision } from "./resolve-history-merge";
import { mergeHistoryRepos } from "./merge-history-repos";
import { sanitizeHistoryForCloud } from "./sanitize-history-for-cloud";
import {
  type LocalPlanThreadMeta,
  readLocalPlanThreadHistory,
  readLocalPlanThreads,
  readPlanThreadSyncState,
  writePlanThreadSyncState,
} from "./thread-storage";

export type MergeLocalThreadsResult = {
  attempted: number;
  uploaded: number;
  skipped: number;
  errors: number;
};

function buildMetadataPatch(
  local: LocalPlanThreadMeta,
  server: Awaited<ReturnType<typeof planService.getPlanThread>>,
): UpdatePlanThreadPayload | null {
  const patch: UpdatePlanThreadPayload = {};

  if (local.title?.trim() && !server.title?.trim()) {
    patch.title = local.title.trim();
  }
  if (local.status && local.status !== server.status) {
    patch.status = local.status;
  }
  if (local.custom && Object.keys(local.custom).length > 0) {
    patch.custom = { ...(server.custom ?? {}), ...local.custom };
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

async function mergeOneThread(
  local: LocalPlanThreadMeta,
  syncState: ReturnType<typeof readPlanThreadSyncState>,
): Promise<"uploaded" | "skipped" | "error"> {
  const remoteId = local.remoteId;
  try {
    await planService.initializePlanThread(remoteId);

    const serverMeta = await planService.getPlanThread(remoteId);
    const metaPatch = buildMetadataPatch(local, serverMeta);
    if (metaPatch) {
      await planService.updatePlanThread(remoteId, metaPatch);
    }

    const localHistory = sanitizeHistoryForCloud(
      readLocalPlanThreadHistory(remoteId),
    );
    const serverHistory = await planService.getPlanThreadHistory(remoteId);
    const prior = syncState.threads[remoteId];

    const decision = resolveHistoryMergeDecision(
      localHistory,
      serverHistory,
      serverMeta.updatedAt,
      prior,
    );

    const repoToUpload =
      decision === "push-merged"
        ? sanitizeHistoryForCloud(
            mergeHistoryRepos(localHistory, serverHistory),
          )
        : localHistory;

    if (decision === "push-local" || decision === "push-merged") {
      await planService.putPlanThreadHistory(remoteId, {
        messages: repoToUpload.messages,
        headId: repoToUpload.headId ?? null,
      });
      const refreshed = await planService.getPlanThread(remoteId);
      syncState.threads[remoteId] = {
        localMessageCount: repoToUpload.messages.length,
        serverUpdatedAt: refreshed.updatedAt ?? null,
      };
      return "uploaded";
    }

    syncState.threads[remoteId] = {
      localMessageCount: localHistory.messages.length,
      serverUpdatedAt: serverMeta.updatedAt ?? null,
    };
    return "skipped";
  } catch {
    return "error";
  }
}

/** Upload anonymous local plan threads after sign-in (idempotent). */
export async function mergeLocalPlanThreadsToCloud(
  userId: string,
): Promise<MergeLocalThreadsResult> {
  const locals = readLocalPlanThreads();
  const result: MergeLocalThreadsResult = {
    attempted: locals.length,
    uploaded: 0,
    skipped: 0,
    errors: 0,
  };

  if (locals.length === 0) return result;

  const syncState = readPlanThreadSyncState(userId);

  for (const thread of locals) {
    const outcome = await mergeOneThread(thread, syncState);
    if (outcome === "uploaded") result.uploaded += 1;
    else if (outcome === "skipped") result.skipped += 1;
    else result.errors += 1;
  }

  writePlanThreadSyncState(userId, syncState);
  return result;
}
