import path from "node:path";
import { app } from "electron";

/** Next.js dev server URL (development only) */
export const DEV_SERVER_URL = "http://127.0.0.1:3000";

/** Production/preview: static export index.html (packaged under out/) */
export function getProductionRendererIndexPath(): string {
  return path.join(app.getAppPath(), "out", "index.html");
}
