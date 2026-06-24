import { ENV_DEFAULTS } from "./defaults";
import { readEnv } from "./env";

/** Next.js dev server URL (Electron dev only; not exposed to browser bundle) */
export const ELECTRON_DEV_SERVER_URL = readEnv(
  "ELECTRON_DEV_SERVER_URL",
  ENV_DEFAULTS.ELECTRON_DEV_SERVER_URL,
);
