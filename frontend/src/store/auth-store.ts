import { create } from "zustand";

import { ApiError, setAccessToken } from "@/service/base";
import { authService } from "@/service/auth";
import type { AuthSession, AuthUser, LoginPayload } from "@/service/auth";
import { getAccessToken } from "@/service/base";

export type AuthStatus = "idle" | "loading" | "authenticated" | "anonymous";

export type AuthStore = {
  ready: boolean;
  status: AuthStatus;
  user: AuthUser | null;
  session: AuthSession | null;
  error: string | null;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
  clearError: () => void;
};

function isSessionExpired(session: AuthSession | null) {
  if (!session?.expiresAt) return false;
  return Date.now() >= session.expiresAt;
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

      set({
        ready: true,
        status: "authenticated",
        user,
        session,
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Login failed";

      authService.clearSession();
      set({
        ready: true,
        status: "anonymous",
        user: null,
        session: null,
        error: message,
      });
      throw error;
    }
  },

  logout: async () => {
    set({ status: "loading", error: null });

    try {
      await authService.logout();
    } catch (error) {
      authService.clearSession();
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

    const token = getAccessToken();
    if (!token) {
      set({ status: "loading", error: null });
      try {
        const user = await authService.getCurrentUser({ skipErrorLog: true });
        set({
          ready: true,
          status: "authenticated",
          user,
          session: null,
          error: null,
        });
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
      set({
        ready: true,
        status: "authenticated",
        user,
        session: session ?? {
          accessToken: token,
          tokenType: "bearer",
        },
        error: null,
      });
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

/** 挂载后恢复登录态（幂等） */
export function initAuthStore(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  void useAuthStore.getState().hydrate();
}

/** 登录成功后写入 store（OAuth 回调等场景） */
export async function establishSession(session: AuthSession): Promise<void> {
  if (session.accessToken) {
    setAccessToken(session.accessToken);
  }
  useAuthStore.setState({ status: "loading", error: null, session });

  try {
    const user = await authService.getCurrentUser();
    useAuthStore.setState({
      ready: true,
      status: "authenticated",
      user,
      session,
      error: null,
    });
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

/** OAuth callback 已由后端通过 HttpOnly Cookie 建立会话。 */
export async function establishCookieSession(): Promise<void> {
  useAuthStore.setState({ status: "loading", error: null, session: null });

  try {
    const user = await authService.getCurrentUser();
    useAuthStore.setState({
      ready: true,
      status: "authenticated",
      user,
      session: null,
      error: null,
    });
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

export function selectIsAuthenticated(state: AuthStore) {
  return state.status === "authenticated" && state.user !== null;
}
