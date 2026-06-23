export const DESKTOP_OAUTH_REDIRECT_URI = "cloud-travel-guide://auth/callback";
export const AUTH_IPC = {
  openOAuthUrl: "auth:open-oauth-url",
  oauthCallback: "auth:oauth-callback",
  getAccessTokenSync: "auth:get-access-token-sync",
  setAccessToken: "auth:set-access-token",
  clearAccessToken: "auth:clear-access-token",
} as const;
