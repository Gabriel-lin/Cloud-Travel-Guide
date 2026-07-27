import {
  basename,
  normalizeToolArgs,
  parseFileToolArgs,
} from "@/components/plan/artifact-utils";

export type ToolActionDisplay = {
  verb: string;
  target?: string;
  detail?: string;
};

function pickQuery(args: Record<string, unknown>): string | undefined {
  for (const key of ["query", "input", "q", "search_query"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function formatToolAction(
  toolName: string,
  args: unknown,
  t: (key: string) => string,
): ToolActionDisplay {
  const file = parseFileToolArgs(args);
  const fileName = file.filePath ? basename(file.filePath) : undefined;
  const record = normalizeToolArgs(args);

  switch (toolName) {
    case "web_search":
    case "tavily_search":
    case "duckduckgo_search":
      return {
        verb: t("plan.toolVerbSearch"),
        target: pickQuery(record),
      };
    case "write_file":
      return { verb: t("plan.toolVerbWrite"), target: fileName };
    case "read_file":
      return { verb: t("plan.toolVerbRead"), target: fileName };
    case "list_directory":
      return { verb: t("plan.toolVerbList"), target: fileName };
    case "file_search":
      return {
        verb: t("plan.toolVerbFind"),
        target: pickQuery(record),
      };
    case "slugify":
      return {
        verb: t("plan.toolVerbSlugify"),
        target:
          typeof record.text === "string"
            ? record.text
            : typeof record.input === "string"
              ? record.input
              : undefined,
      };
    default:
      return { verb: toolName };
  }
}
