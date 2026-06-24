import fs from "node:fs";
import path from "node:path";

function parseDotenv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};

  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** Mirrors Next.js / Vite .env load order; later files override earlier ones. */
export function loadEnvFiles(root: string, mode: string): Record<string, string> {
  const ordered = [".env", ".env.local", `.env.${mode}`, `.env.${mode}.local`];
  const merged: Record<string, string> = {};

  for (const file of ordered) {
    Object.assign(merged, parseDotenv(path.join(root, file)));
  }

  return merged;
}
