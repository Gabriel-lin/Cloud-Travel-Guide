/** 浏览器端 access token 存储键 */
export const ACCESS_TOKEN_KEY = "ctg-access-token";

/** 默认 API 根路径（可通过 NEXT_PUBLIC_API_BASE_URL 覆盖） */
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

/** 默认请求超时（毫秒） */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** REST API 版本前缀 */
export const API_V1_PREFIX = "/api/v1";
