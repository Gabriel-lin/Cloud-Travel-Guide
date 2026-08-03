import { describe, expect, it } from "vitest";

import {
  MAX_INLINE_FILE_CHARS,
  parseWorkspaceFileDataRef,
  sanitizeHistoryForCloud,
  toWorkspaceFileDataRef,
} from "./sanitize-history-for-cloud";

describe("toWorkspaceFileDataRef / parseWorkspaceFileDataRef", () => {
  it("round-trips workspace paths", () => {
    const ref = toWorkspaceFileDataRef("exports/plan.pdf");
    expect(ref).toBe("workspace:exports/plan.pdf");
    expect(parseWorkspaceFileDataRef(ref)).toBe("exports/plan.pdf");
  });

  it("rejects non-refs", () => {
    expect(parseWorkspaceFileDataRef("not-a-ref")).toBeNull();
    expect(parseWorkspaceFileDataRef("")).toBeNull();
  });
});

describe("sanitizeHistoryForCloud", () => {
  it("rewrites large inline file data to a workspace ref from tool result", () => {
    const big = "A".repeat(MAX_INLINE_FILE_CHARS + 100);
    const repo = sanitizeHistoryForCloud({
      messages: [
        {
          message: {
            id: "m1",
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolName: "convert_markdown_to_pdf",
                result: JSON.stringify({
                  ok: true,
                  outputPath: "exports/trip.pdf",
                }),
              },
              {
                type: "file",
                filename: "trip.pdf",
                mimeType: "application/pdf",
                data: big,
              },
            ],
          },
          parentId: null,
        },
      ],
      headId: "m1",
    });

    const filePart = (
      repo.messages[0] as {
        message: { content: Array<{ type: string; data?: string }> };
      }
    ).message.content.find((p) => p.type === "file");

    expect(filePart?.data).toBe("workspace:exports/trip.pdf");
  });

  it("keeps existing workspace refs", () => {
    const repo = sanitizeHistoryForCloud({
      messages: [
        {
          message: {
            id: "m1",
            content: [
              {
                type: "file",
                filename: "a.md",
                data: toWorkspaceFileDataRef("notes/a.md"),
              },
            ],
          },
          parentId: null,
        },
      ],
    });

    const filePart = (
      repo.messages[0] as {
        message: { content: Array<{ type: string; data?: string }> };
      }
    ).message.content[0];

    expect(filePart?.data).toBe("workspace:notes/a.md");
  });

  it("clears oversized file data when no workspace path is available", () => {
    const big = "B".repeat(MAX_INLINE_FILE_CHARS + 50);
    const repo = sanitizeHistoryForCloud({
      messages: [
        {
          message: {
            id: "m1",
            content: [
              {
                type: "file",
                filename: "orphan.pdf",
                data: big,
              },
            ],
          },
          parentId: null,
        },
      ],
    });

    const filePart = (
      repo.messages[0] as {
        message: { content: Array<{ type: string; data?: string }> };
      }
    ).message.content[0];

    expect(filePart?.data).toBe("");
  });

  it("truncates oversized tool results and write_file args", () => {
    const huge = "C".repeat(50_000);
    const repo = sanitizeHistoryForCloud({
      messages: [
        {
          message: {
            id: "m1",
            content: [
              {
                type: "tool-call",
                toolName: "write_file",
                result: huge,
                args: { file_path: "x.md", text: huge },
                argsText: huge,
              },
            ],
          },
          parentId: null,
        },
      ],
    });

    const tool = (
      repo.messages[0] as {
        message: {
          content: Array<{
            type: string;
            result?: string;
            argsText?: string;
            args?: { text?: string };
          }>;
        };
      }
    ).message.content[0];

    expect(tool.result?.length).toBeLessThan(huge.length);
    expect(tool.argsText?.length).toBeLessThan(huge.length);
    expect(tool.args?.text?.length).toBeLessThan(huge.length);
    expect(tool.result).toContain("[truncated");
  });
});
