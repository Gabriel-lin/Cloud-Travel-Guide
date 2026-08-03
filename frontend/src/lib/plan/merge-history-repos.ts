import type { PlanThreadHistoryRepo } from "@/service/plan";

export function getHistoryEntryMessageId(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) return null;
  const message = (entry as { message?: { id?: string } }).message;
  return typeof message?.id === "string" ? message.id : null;
}

/** Union message entries by `message.id`; local wins on duplicate ids. */
export function mergeHistoryRepos(
  local: PlanThreadHistoryRepo,
  server: PlanThreadHistoryRepo,
): PlanThreadHistoryRepo {
  const localMessages = local.messages ?? [];
  const serverMessages = server.messages ?? [];

  const byId = new Map<string, unknown>();
  for (const entry of serverMessages) {
    const id = getHistoryEntryMessageId(entry);
    if (id) byId.set(id, entry);
  }
  for (const entry of localMessages) {
    const id = getHistoryEntryMessageId(entry);
    if (id) byId.set(id, entry);
  }

  const ordered: unknown[] = [];
  const seen = new Set<string>();

  for (const entry of serverMessages) {
    const id = getHistoryEntryMessageId(entry);
    if (!id || seen.has(id)) continue;
    ordered.push(byId.get(id) ?? entry);
    seen.add(id);
  }
  for (const entry of localMessages) {
    const id = getHistoryEntryMessageId(entry);
    if (!id || seen.has(id)) continue;
    ordered.push(byId.get(id) ?? entry);
    seen.add(id);
  }

  const headId =
    local.headId ??
    server.headId ??
    getHistoryEntryMessageId(ordered[ordered.length - 1]) ??
    null;

  return {
    messages: ordered,
    headId,
  };
}

export function historyRepoMessageIds(repo: PlanThreadHistoryRepo): string[] {
  return (repo.messages ?? [])
    .map(getHistoryEntryMessageId)
    .filter((id): id is string => Boolean(id));
}

export function historyReposEqual(
  a: PlanThreadHistoryRepo,
  b: PlanThreadHistoryRepo,
): boolean {
  const idsA = historyRepoMessageIds(a);
  const idsB = historyRepoMessageIds(b);
  if (idsA.length !== idsB.length) return false;
  return idsA.every((id, i) => id === idsB[i]);
}

export function localHasMessagesNotOnServer(
  local: PlanThreadHistoryRepo,
  server: PlanThreadHistoryRepo,
): boolean {
  const serverIds = new Set(historyRepoMessageIds(server));
  return historyRepoMessageIds(local).some((id) => !serverIds.has(id));
}
