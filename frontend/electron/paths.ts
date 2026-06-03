import * as path from "node:path";
import { app } from "electron";

/** Next.js dev server (development only) */
export const DEV_SERVER_URL = "http://127.0.0.1:3000";

/** Preload script next to compiled main.js */
export function getPreloadPath(): string {
  return path.join(__dirname, "preload.js");
}

/** Static export entry after `ELECTRON_BUILD=true next build` */
export function getProductionIndexPath(): string {
  return path.join(app.getAppPath(), "out", "index.html");
}
