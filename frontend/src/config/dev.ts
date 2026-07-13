import { ENV_DEFAULTS } from "./defaults";

/**
 * Next.js dev server URL (Electron dev only; not exposed to browser bundle).
 * Must use static `process.env.KEY` so Vite can inline the value from .env at build time.
 * Dynamic `process.env[name]` is not replaced and is empty inside Electron at runtime.
 */
export const ELECTRON_DEV_SERVER_URL =
  process.env.ELECTRON_DEV_SERVER_URL?.trim() ||
  ENV_DEFAULTS.ELECTRON_DEV_SERVER_URL;
