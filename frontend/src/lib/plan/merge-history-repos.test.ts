import { describe, expect, it } from "vitest";

import {
  mergeHistoryRepos,
  localHasMessagesNotOnServer,
} from "./merge-history-repos";
import { resolveHistoryMergeDecision } from "./resolve-history-merge";

function entry(id: string) {
  return { message: { id, role: "user" as const, content: [] }, parentId: null };
}

describe("mergeHistoryRepos", () => {
  it("prefers local content for the same message id", () => {
    const local = {
      messages: [entry("a"), entry("b")],
      headId: "b",
    };
    const server = {
      messages: [entry("a")],
      headId: "a",
    };
    const merged = mergeHistoryRepos(local, server);
    expect(merged.messages).toHaveLength(2);
  });
});

describe("resolveHistoryMergeDecision", () => {
  it("pushes merged when local has ids missing on server", () => {
    expect(
      resolveHistoryMergeDecision(
        { messages: [entry("a"), entry("b")] },
        { messages: [entry("a")] },
        "2026-01-01T00:00:00Z",
        undefined,
      ),
    ).toBe("push-merged");
  });

  it("pushes merged when same count but different ids", () => {
    expect(
      resolveHistoryMergeDecision(
        { messages: [entry("a"), entry("b")] },
        { messages: [entry("a"), entry("c")] },
        "2026-01-01T00:00:00Z",
        undefined,
      ),
    ).toBe("push-merged");
  });
});

describe("localHasMessagesNotOnServer", () => {
  it("detects extra local messages", () => {
    expect(
      localHasMessagesNotOnServer(
        { messages: [entry("a"), entry("b")] },
        { messages: [entry("a")] },
      ),
    ).toBe(true);
  });
});
