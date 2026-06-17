export type OAuthProvider = "github" | "google";

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
};

export type LoginPayload = {
  username: string;
  password: string;
};

export type RegisterPayload = {
  username: string;
  password: string;
};

export type MessageResponse = {
  message: string;
};

export type AuthUser = {
  id: string;
  username: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  provider?: "local" | OAuthProvider;
};

export type AuthSession = {
  accessToken: string;
  tokenType: string;
  expiresAt?: number;
};

export function toAuthSession(response: TokenResponse): AuthSession {
  const expiresAt =
    response.expires_in !== undefined
      ? Date.now() + response.expires_in * 1000
      : undefined;

  return {
    accessToken: response.access_token,
    tokenType: response.token_type,
    expiresAt,
  };
}
