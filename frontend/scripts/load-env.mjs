import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal .env loader for Node scripts (dev launcher, ensure-env). */
export function loadDotenv(rootDir = root) {
  for (const file of [".env", ".env.local"]) {
    const filePath = path.join(rootDir, file);
    if (!fs.existsSync(filePath)) continue;

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
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

export function getDevServerWaitTarget(rootDir = root) {
  loadDotenv(rootDir);
  const url = process.env.ELECTRON_DEV_SERVER_URL ?? "http://127.0.0.1:3000";
  const { hostname, port } = new URL(url);
  const host = hostname === "localhost" ? "127.0.0.1" : hostname;
  return `tcp:${host}:${port || "80"}`;
}
