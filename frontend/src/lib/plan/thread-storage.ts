/** Shared with PlanRuntimeProvider / localStorage adapter. */
export const PLAN_THREAD_STORAGE_PREFIX = "ctg-plan:";

export type LocalPlanThreadMeta = {
  remoteId: string;
  externalId?: string;
  status?: "regular" | "archived";
  title?: string;
  custom?: Record<string, unknown>;
};

export type LocalPlanThreadHistoryRepo = {
  messages: unknown[];
  headId?: string;
};

function threadsKey(prefix: string) {
  return `${prefix}threads`;
}

function messagesKey(prefix: string, remoteId: string) {
  return `${prefix}messages:${remoteId}`;
}

export function readLocalPlanThreads(
  prefix: string = PLAN_THREAD_STORAGE_PREFIX,
): LocalPlanThreadMeta[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(threadsKey(prefix));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is LocalPlanThreadMeta =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as LocalPlanThreadMeta).remoteId === "string",
    );
  } catch {
    return [];
  }
}

export function readLocalPlanThreadHistory(
  remoteId: string,
  prefix: string = PLAN_THREAD_STORAGE_PREFIX,
): LocalPlanThreadHistoryRepo {
  if (typeof window === "undefined") return { messages: [] };
  const raw = window.localStorage.getItem(messagesKey(prefix, remoteId));
  if (!raw) return { messages: [] };
  try {
    const parsed = JSON.parse(raw) as LocalPlanThreadHistoryRepo;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      ...(parsed.headId ? { headId: parsed.headId } : {}),
    };
  } catch {
    return { messages: [] };
  }
}

export function localPlanThreadSyncKey(userId: string) {
  return `${PLAN_THREAD_STORAGE_PREFIX}sync:v1:${userId}`;
}

export type PlanThreadSyncRecord = {
  localMessageCount: number;
  serverUpdatedAt: string | null;
};

export type PlanThreadSyncState = {
  threads: Record<string, PlanThreadSyncRecord>;
};

export function readPlanThreadSyncState(userId: string): PlanThreadSyncState {
  if (typeof window === "undefined") return { threads: {} };
  const raw = window.localStorage.getItem(localPlanThreadSyncKey(userId));
  if (!raw) return { threads: {} };
  try {
    const parsed = JSON.parse(raw) as PlanThreadSyncState;
    return parsed?.threads ? parsed : { threads: {} };
  } catch {
    return { threads: {} };
  }
}

export function writePlanThreadSyncState(
  userId: string,
  state: PlanThreadSyncState,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    localPlanThreadSyncKey(userId),
    JSON.stringify(state),
  );
}

export function sessionMergeDoneKey(userId: string) {
  return `${PLAN_THREAD_STORAGE_PREFIX}merged-session:${userId}`;
}

export function markSessionMergeDone(userId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(sessionMergeDoneKey(userId), "1");
}

export function isSessionMergeDone(userId: string): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(sessionMergeDoneKey(userId)) === "1";
}

export function clearSessionMergeDone(userId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(sessionMergeDoneKey(userId));
}
