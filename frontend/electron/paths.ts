import * as path from "node:path";
import { app } from "electron";

import { ELECTRON_DEV_SERVER_URL } from "@/config/dev";

/** Next.js dev server (development only) */
export const DEV_SERVER_URL = ELECTRON_DEV_SERVER_URL;

/** Preload script next to compiled main.js */
export function getPreloadPath(): string {
  return path.join(__dirname, "preload.js");
}

/** Next.js static export root (`out/`) after `ELECTRON_BUILD=true next build` */
export function getStaticExportDir(): string {
  return path.join(app.getAppPath(), "out");
}
