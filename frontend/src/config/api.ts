import { ENV_DEFAULTS } from "./defaults";

/** Browser-side access token storage key */
export const ACCESS_TOKEN_KEY = "ctg-access-token";

/**
 * API origin (sync with backend CORS & OAuth redirect origins).
 * Static `process.env.KEY` access so Vite/Next can inline values into Electron main.
 */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
  ENV_DEFAULTS.NEXT_PUBLIC_API_BASE_URL;

/** Default request timeout (ms) */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** REST API version prefix */
export const API_V1_PREFIX = "/api/v1";
