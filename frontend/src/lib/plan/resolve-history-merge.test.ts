import { describe, expect, it } from "vitest";

import { resolveHistoryMergeDecision } from "./resolve-history-merge";

describe("resolveHistoryMergeDecision", () => {
  it("pushes when server history is empty", () => {
    expect(
      resolveHistoryMergeDecision(
        { messages: [{ id: 1 }] },
        { messages: [] },
        null,
        undefined,
      ),
    ).toBe("push-local");
  });

  it("keeps server when local is empty", () => {
    expect(
      resolveHistoryMergeDecision(
        { messages: [] },
        { messages: [{ id: 1 }] },
        "2026-01-01T00:00:00Z",
        undefined,
      ),
    ).toBe("keep-server");
  });

  it("pushes when local has more messages (offline draft)", () => {
    expect(
      resolveHistoryMergeDecision(
        { messages: [1, 2, 3] },
        { messages: [1] },
        "2026-01-01T00:00:00Z",
        undefined,
      ),
    ).toBe("push-local");
  });
});
