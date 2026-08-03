import * as path from "node:path";
import { app } from "electron";

import { ELECTRON_DEV_SERVER_URL } from "@/config/dev";

/** Next.js dev server (development only) */
export const DEV_SERVER_URL = ELECTRON_DEV_SERVER_URL;

/** Preload script next to compiled main.js（sandbox 要求 CJS，见 vite.electron.config.ts） */
export function getPreloadPath(): string {
  return path.join(__dirname, "preload.cjs");
}

/** Next.js static export root (`out/`) after `ELECTRON_BUILD=true next build` */
export function getStaticExportDir(): string {
  return path.join(app.getAppPath(), "out");
}
