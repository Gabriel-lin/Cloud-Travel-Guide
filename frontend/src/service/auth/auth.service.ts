import {
  API_BASE_URL,
  API_V1_PREFIX,
  clearAccessToken,
  get,
  post,
  setAccessToken,
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

const AUTH_PREFIX = `${API_V1_PREFIX}/auth`;

/** 认证相关接口 */
export const authService = {
  /** POST /api/v1/auth/token — 用户名密码登录 */
  async login(payload: LoginPayload) {
    const body = new URLSearchParams({
      username: payload.username,
      password: payload.password,
    });

    const result = await post<TokenResponse>(`${AUTH_PREFIX}/token`, body, {
      skipAuth: true,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    setAccessToken(result.access_token);
    return toAuthSession(result);
  },

  /** POST /api/v1/auth/register — 用户注册 */
  register(payload: RegisterPayload) {
    return post<MessageResponse>(`${AUTH_PREFIX}/register`, null, {
      skipAuth: true,
      params: {
        username: payload.username,
        password: payload.password,
      },
    });
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
  getOAuthAuthorizeUrl(provider: OAuthProvider, redirectUri: string) {
    const url = new URL(`${API_BASE_URL}${AUTH_PREFIX}/oauth/${provider}`);
    url.searchParams.set("redirect_uri", redirectUri);
    return url.toString();
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

    setAccessToken(result.access_token);
    return toAuthSession(result);
  },

  clearSession() {
    clearAccessToken();
  },
};
