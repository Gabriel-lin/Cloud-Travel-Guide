import {
  API_BASE_URL,
  API_V1_PREFIX,
  clearAccessToken,
  get,
  persistAccessToken,
  post,
} from "@/service/base";
import type {
  AuthUser,
  LoginPayload,
  MessageResponse,
  OAuthProvider,
  RegisterPayload,
  TokenResponse,
} from "./types";
import { toAuthSession } from "./types";
import type { ServiceRequestConfig } from "@/service/base";
import {
  fetchPasswordKey,
  sealPassword,
  type PasswordEnvelope,
  type PasswordKeyResponse,
} from "@/lib/auth/password-cipher";

const AUTH_PREFIX = `${API_V1_PREFIX}/auth`;

async function getPasswordTransportKey(): Promise<PasswordKeyResponse> {
  return fetchPasswordKey(() =>
    get<PasswordKeyResponse>(`${AUTH_PREFIX}/password-key`, {
      skipAuth: true,
    }),
  );
}

async function sealCredential(password: string): Promise<PasswordEnvelope> {
  const key = await getPasswordTransportKey();
  return sealPassword(key, password);
}

/** 认证相关接口 */
export const authService = {
  /** GET /api/v1/auth/password-key — 获取密码传输公钥 */
  getPasswordKey() {
    return getPasswordTransportKey();
  },

  /** POST /api/v1/auth/login — 加密凭证登录 */
  async login(payload: LoginPayload) {
    const result = await post<TokenResponse>(
      `${AUTH_PREFIX}/login`,
      {
        username: payload.username,
        password_envelope: await sealCredential(payload.password),
      },
      {
        skipAuth: true,
        skipErrorLog: true,
      },
    );

    await persistAccessToken(result.access_token);
    return toAuthSession(result);
  },

  /** POST /api/v1/auth/register — 加密凭证注册 */
  async register(payload: RegisterPayload) {
    return post<MessageResponse>(
      `${AUTH_PREFIX}/register`,
      {
        username: payload.username,
        password_envelope: await sealCredential(payload.password),
      },
      {
        skipAuth: true,
        skipErrorLog: true,
      },
    );
  },

  /** POST /api/v1/auth/logout — 退出登录 */
  async logout() {
    try {
      await post<MessageResponse>(`${AUTH_PREFIX}/logout`);
    } finally {
      clearAccessToken();
    }
  },

  /** GET /api/v1/auth/me — 当前登录用户 */
  getCurrentUser(config?: ServiceRequestConfig) {
    return get<AuthUser>(`${AUTH_PREFIX}/me`, config);
  },

  /** 构造 OAuth 授权跳转地址 */
  getOAuthAuthorizeUrl(
    provider: OAuthProvider,
    redirectUri: string,
    clientType: "web" | "desktop" = "web",
  ) {
    const url = new URL(`${API_BASE_URL}${AUTH_PREFIX}/oauth/${provider}`);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("client_type", clientType);
    return url.toString();
  },

  /** POST /api/v1/auth/oauth/desktop/exchange — one-time login code → token (web + desktop) */
  async exchangeDesktopOAuthCode(code: string) {
    const result = await post<TokenResponse>(
      `${AUTH_PREFIX}/oauth/desktop/exchange`,
      { code },
      { skipAuth: true },
    );

    await persistAccessToken(result.access_token);
    return toAuthSession(result);
  },

  /** POST /api/v1/auth/oauth/exchange — 用授权码换取 token（回调页使用） */
  async exchangeOAuthCode(payload: {
    provider: OAuthProvider;
    code: string;
    redirectUri: string;
  }) {
    const result = await post<TokenResponse>(
      `${AUTH_PREFIX}/oauth/exchange`,
      payload,
      { skipAuth: true },
    );

    await persistAccessToken(result.access_token);
    return toAuthSession(result);
  },

  clearSession() {
    clearAccessToken();
  },
};

