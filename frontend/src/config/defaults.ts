/** Default values when env vars are unset (local dev & CI fallback). */
export const ENV_DEFAULTS = {
  NEXT_PUBLIC_APP_NAME: "Cloud Travel Guide",
  NEXT_PUBLIC_APP_DESCRIPTION: "智能旅行规划与导览桌面应用",
  NEXT_PUBLIC_APP_ID: "com.cloudtravelguide.app",
  NEXT_PUBLIC_APP_PROTOCOL: "cloud-travel-guide",
  NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8000",
  ELECTRON_DEV_SERVER_URL: "http://127.0.0.1:3000",
} as const;

export function defaultDesktopOAuthRedirectUri(protocol: string): string {
  return `${protocol}://auth/callback`;
}
