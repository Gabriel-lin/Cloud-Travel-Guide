import { mergeLocalPlanThreadsToCloud } from "./merge-local-threads-to-cloud";
import {
  clearSessionMergeDone,
  isSessionMergeDone,
  markSessionMergeDone,
  readLocalPlanThreadHistory,
  readLocalPlanThreads,
  readPlanThreadSyncState,
} from "./thread-storage";

let mergeInFlight: Promise<void> | null = null;

function localThreadsNeedCloudMerge(userId: string): boolean {
  const locals = readLocalPlanThreads();
  if (locals.length === 0) return false;

  const syncState = readPlanThreadSyncState(userId);

  return locals.some((thread) => {
    const localHistory = readLocalPlanThreadHistory(thread.remoteId);
    const localLen = localHistory.messages?.length ?? 0;
    if (localLen === 0) return false;

    const prior = syncState.threads[thread.remoteId];
    if (!prior) return true;
    if (prior.localMessageCount !== localLen) return true;
    return false;
  });
}

/**
 * Runs local → cloud thread merge once per browser session (unless `force`).
 * Call after auth token is available and before switching plan UI to remote adapter.
 */
export async function schedulePlanThreadCloudMerge(
  userId: string,
  options?: { force?: boolean },
): Promise<void> {
  if (typeof window === "undefined") return;

  const force = options?.force ?? false;
  const needsMerge = localThreadsNeedCloudMerge(userId);

  if (!force && isSessionMergeDone(userId) && !needsMerge) return;

  if (mergeInFlight) {
    await mergeInFlight;
    if (!force && isSessionMergeDone(userId) && !localThreadsNeedCloudMerge(userId)) {
      return;
    }
  }

  mergeInFlight = (async () => {
    try {
      const result = await mergeLocalPlanThreadsToCloud(userId);
      // Retry on next entry if any thread failed to upload.
      if (result.errors === 0) {
        markSessionMergeDone(userId);
      }
    } finally {
      mergeInFlight = null;
    }
  })();

  await mergeInFlight;
}

export function resetPlanThreadMergeSession(userId: string | null | undefined) {
  if (!userId) return;
  clearSessionMergeDone(userId);
}
