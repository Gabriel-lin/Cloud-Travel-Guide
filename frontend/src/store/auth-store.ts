import { create } from "zustand";

import {
  resetPlanThreadMergeSession,
  schedulePlanThreadCloudMerge,
} from "@/lib/plan/schedule-thread-cloud-merge";
import { isElectronRuntime } from "@/lib/electron";
import { ApiError, getAccessToken, persistAccessToken, refreshAccessTokenFromBridge, clearAccessToken } from "@/service/base";
import { authService } from "@/service/auth";
import type { AuthSession, AuthUser, LoginPayload, RegisterPayload } from "@/service/auth";

export type AuthStatus = "idle" | "loading" | "authenticated" | "anonymous";

export type AuthStore = {
  ready: boolean;
  status: AuthStatus;
  user: AuthUser | null;
  session: AuthSession | null;
  error: string | null;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  clearError: () => void;
};

function isSessionExpired(session: AuthSession | null) {
  if (!session?.expiresAt) return false;
  return Date.now() >= session.expiresAt;
}

async function completeAuthenticatedUser(
  user: AuthUser,
  session: AuthSession | null,
  options?: { mergeForce?: boolean },
) {
  useAuthStore.setState({
    ready: true,
    status: "authenticated",
    user,
    session,
    error: null,
  });

  void schedulePlanThreadCloudMerge(user.id, {
    force: options?.mergeForce ?? true,
  });
}

export const useAuthStore = create<AuthStore>()((set, get) => ({
  ready: false,
  status: "idle",
  user: null,
  session: null,
  error: null,

  clearError: () => set({ error: null }),

  login: async (payload) => {
    set({ status: "loading", error: null });

    try {
      const session = await authService.login(payload);
      const user = await authService.getCurrentUser();
      await completeAuthenticatedUser(user, session, { mergeForce: true });
    } catch (error) {
      authService.clearSession();
      set({
        ready: true,
        status: "anonymous",
        user: null,
        session: null,
        error: null,
      });
      throw error;
    }
  },

  register: async (payload) => {
    set({ status: "loading", error: null });

    try {
      await authService.register(payload);
      const session = await authService.login(payload);
      const user = await authService.getCurrentUser();
      await completeAuthenticatedUser(user, session, { mergeForce: true });
    } catch (error) {
      authService.clearSession();
      set({
        ready: true,
        status: "anonymous",
        user: null,
        session: null,
        error: null,
      });
      throw error;
    }
  },

  logout: async () => {
    const userId = get().user?.id;
    set({ status: "loading", error: null });

    try {
      await authService.logout();
    } catch (error) {
      authService.clearSession();
      resetPlanThreadMergeSession(userId);
      const message =
        error instanceof ApiError ? error.message : "Logout failed";
      set({
        ready: true,
        status: "anonymous",
        user: null,
        session: null,
        error: message,
      });
      throw error;
    }

    resetPlanThreadMergeSession(userId);
    set({
      ready: true,
      status: "anonymous",
      user: null,
      session: null,
      error: null,
    });
  },

  hydrate: async () => {
    if (get().status === "loading") return;

    // OAuth / resume may complete while bootstrap hydrate is in flight — never downgrade.
    if (get().status === "authenticated" && get().user !== null) {
      set({ ready: true, error: null });
      return;
    }

    let token = getAccessToken();
    if (!token && isElectronRuntime()) {
      token = await refreshAccessTokenFromBridge();
    }

    if (!token) {
      // Desktop uses bearer tokens in secure storage — not HttpOnly cookies.
      if (isElectronRuntime()) {
        set({
          ready: true,
          status: "anonymous",
          user: null,
          session: null,
          error: null,
        });
        return;
      }

      set({ status: "loading", error: null });
      try {
        const user = await authService.getCurrentUser({ skipErrorLog: true });
        await completeAuthenticatedUser(user, null, { mergeForce: false });
      } catch {
        set({
          ready: true,
          status: "anonymous",
          user: null,
          session: null,
          error: null,
        });
      }
      return;
    }

    const { session } = get();
    if (isSessionExpired(session)) {
      authService.clearSession();
      set({
        ready: true,
        status: "anonymous",
        user: null,
        session: null,
        error: null,
      });
      return;
    }

    set({ status: "loading", error: null });

    try {
      const user = await authService.getCurrentUser();
      const nextSession =
        session ??
        ({
          accessToken: token,
          tokenType: "bearer",
        } satisfies AuthSession);
      await completeAuthenticatedUser(user, nextSession, { mergeForce: false });
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) {
        authService.clearSession();
      }

      set({
        ready: true,
        status: "anonymous",
        user: null,
        session: null,
        error: null,
      });
    }
  },
}));

let initialized = false;

async function bootstrapAuthStore(): Promise<void> {
  if (isElectronRuntime()) {
    await refreshAccessTokenFromBridge();
  }
  await useAuthStore.getState().hydrate();
}

/** 挂载后恢复登录态（幂等） */
export function initAuthStore(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  void bootstrapAuthStore();
}

/** 登录成功后写入 store（OAuth 回调等场景） */
export async function establishSession(session: AuthSession): Promise<void> {
  if (session.accessToken) {
    await persistAccessToken(session.accessToken);
    if (isElectronRuntime()) {
      await refreshAccessTokenFromBridge();
    }
  }
  useAuthStore.setState({ status: "loading", error: null, session });

  try {
    const user = await authService.getCurrentUser();
    await completeAuthenticatedUser(user, session, { mergeForce: true });
  } catch (error) {
    authService.clearSession();
    useAuthStore.setState({
      ready: true,
      status: "anonymous",
      user: null,
      session: null,
      error: error instanceof ApiError ? error.message : "Session invalid",
    });
    throw error;
  }
}

/** OAuth callback 已由后端通过 HttpOnly Cookie 建立会话（仅 Web）。 */
export async function establishCookieSession(): Promise<void> {
  if (isElectronRuntime()) {
    throw new Error("Cookie sessions are not used on the desktop client");
  }
  useAuthStore.setState({ status: "loading", error: null, session: null });

  try {
    const user = await authService.getCurrentUser();
    await completeAuthenticatedUser(user, null, { mergeForce: true });
  } catch (error) {
    authService.clearSession();
    useAuthStore.setState({
      ready: true,
      status: "anonymous",
      user: null,
      session: null,
      error: error instanceof ApiError ? error.message : "Session invalid",
    });
    throw error;
  }
}

/** 主进程已完成 OAuth 换票并写入安全存储 — 渲染进程恢复会话。 */
export async function resumeDesktopOAuthSession(payload: {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
}): Promise<void> {
  const session: AuthSession = {
    accessToken: payload.accessToken,
    tokenType: payload.tokenType,
    expiresAt:
      payload.expiresIn !== undefined
        ? Date.now() + payload.expiresIn * 1000
        : undefined,
  };

  await persistAccessToken(payload.accessToken);
  if (isElectronRuntime()) {
    await refreshAccessTokenFromBridge();
  }

  useAuthStore.setState({ status: "loading", error: null, session });

  try {
    const user = await authService.getCurrentUser();
    await completeAuthenticatedUser(user, session, { mergeForce: true });
  } catch (error) {
    authService.clearSession();
    useAuthStore.setState({
      ready: true,
      status: "anonymous",
      user: null,
      session: null,
      error: error instanceof ApiError ? error.message : "Session invalid",
    });
    throw error;
  }
}

/** 从主进程安全存储恢复桌面会话（OAuth 回应用 / 窗口聚焦时）。 */
export async function syncDesktopSessionFromDisk(): Promise<boolean> {
  if (!isElectronRuntime()) return false;

  const token = await refreshAccessTokenFromBridge();
  if (!token) return false;

  const state = useAuthStore.getState();
  if (state.status === "authenticated" && state.user) return true;

  const session: AuthSession = {
    accessToken: token,
    tokenType: "bearer",
  };

  useAuthStore.setState({ status: "loading", error: null, session });

  try {
    const user = await authService.getCurrentUser();
    await completeAuthenticatedUser(user, session, { mergeForce: false });
    return true;
  } catch {
    return false;
  }
}

export function selectIsAuthenticated(state: AuthStore) {
  return state.status === "authenticated" && state.user !== null;
}
