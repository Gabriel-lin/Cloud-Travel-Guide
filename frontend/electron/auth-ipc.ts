export const AUTH_IPC = {
  startOAuth: "auth:start-oauth",
  openOAuthUrl: "auth:open-oauth-url",
  oauthCallback: "auth:oauth-callback",
  sessionEstablished: "auth:session-established",
  consumeSessionEstablished: "auth:consume-session-established",
  consumePendingOAuthCallback: "auth:consume-pending-oauth-callback",
  notifyAuthReady: "auth:notify-auth-ready",
  getAccessToken: "auth:get-access-token",
  setAccessToken: "auth:set-access-token",
  clearAccessToken: "auth:clear-access-token",
} as const;

export type SessionEstablishedPayload = {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
};
