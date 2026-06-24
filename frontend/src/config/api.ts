import { ENV_DEFAULTS } from "./defaults";
import { readEnv } from "./env";

/** Browser-side access token storage key */
export const ACCESS_TOKEN_KEY = "ctg-access-token";

/** API origin (sync with backend CORS & OAuth redirect origins) */
export const API_BASE_URL = readEnv(
  "NEXT_PUBLIC_API_BASE_URL",
  ENV_DEFAULTS.NEXT_PUBLIC_API_BASE_URL,
);

/** Default request timeout (ms) */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** REST API version prefix */
export const API_V1_PREFIX = "/api/v1";
