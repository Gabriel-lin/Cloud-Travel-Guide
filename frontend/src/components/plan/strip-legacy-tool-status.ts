/**
 * Strip legacy plan-chat status lines inlined into assistant text
 * before structured tool-call parts existed.
 */

const KNOWN_TOOL_NAMES = [
  "web_search",
  "write_file",
  "read_file",
  "slugify",
  "file_search",
  "list_directory",
  "tavily_search",
  "duckduckgo_search",
] as const;

const TOOL_NAME_TOKEN = KNOWN_TOOL_NAMES.join("|");

/** Recover tool names embedded in legacy assistant text (before structured parts). */
export function extractLegacyToolsFromText(text: string): string[] {
  if (!text?.trim()) return [];

  const order: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const name = raw.replace(/^_+|_+$/g, "");
    if (!name || seen.has(name)) return;
    seen.add(name);
    order.push(name);
  };

  for (const match of text.matchAll(/工具调用[：:]\s*([a-zA-Z0-9_]+)/g)) {
    push(match[1] ?? "");
  }
  for (const match of text.matchAll(/工具完成[：:]\s*([a-zA-Z0-9_]+)/g)) {
    push(match[1] ?? "");
  }

  for (const name of KNOWN_TOOL_NAMES) {
    if (new RegExp(`_?${name}_?`, "i").test(text)) push(name);
  }

  return order;
}

const TOOL_DUMP_RE = new RegExp(
  `(?:_?${TOOL_NAME_TOKEN}_?\\s*){2,}`,
  "gi",
);

const TOOL_ONLY_LINE_RE = new RegExp(
  `^(?:_?${TOOL_NAME_TOKEN}_?\\s*)+$`,
  "i",
);

export function stripLegacyToolStatus(text: string): string {
  if (!text) return text;

  let cleaned = text.replace(
    /_?工具(?:调用|完成|失败)[：:][^\n]*?(?:_)?/g,
    "",
  );
  cleaned = cleaned.replace(TOOL_DUMP_RE, "");

  const lines = cleaned.split("\n");
  const kept = lines.filter((line) => {
    const trimmed = line.trim().replace(/^_|_$/g, "");
    if (!trimmed) return true;
    if (/^工具(?:调用|完成|失败)[：:]/.test(trimmed)) return false;
    if (/^任务\s+\S+…/.test(trimmed)) return false;
    if (/^行程已更新[：:]/.test(trimmed)) return false;
    if (TOOL_ONLY_LINE_RE.test(trimmed.replace(/\s+/g, ""))) return false;
    if (
      /^(?:(?:web_)?search_|file_|write_|read_|list_|slugify_)(?:\s+(?:(?:web_)?search_|file_|write_|read_|list_|slugify_))*\s*$/i.test(
        trimmed,
      )
    ) {
      return false;
    }
    return true;
  });

  return kept
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
}
