"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { getElectronAPI, isDesktopClient } from "@/lib/electron";
import {
  initAuthStore,
  resumeDesktopOAuthSession,
  syncDesktopSessionFromDisk,
  useAuthStore,
} from "@/store";
import { useAppLocale } from "@/hooks/use-app-locale";

type DesktopSessionPayload = {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
};

declare global {
  interface Window {
    __CTG_DESKTOP_SESSION__?: DesktopSessionPayload;
    __CTG_APPLY_DESKTOP_SESSION__?: (
      payload: DesktopSessionPayload,
    ) => void | Promise<void>;
  }
}

const DESKTOP_SESSION_EVENT = "ctg-desktop-session";

/** 根布局挂载时初始化认证 store，并接收主进程 OAuth 会话 */
export function AuthBootstrap() {
  const router = useRouter();
  const { t } = useAppLocale();
  const handledSessionTokens = useRef(new Set<string>());
  const resumeInFlight = useRef(false);

  /**
   * t 的引用随语言切换而变；它只在报错提示里用到，一旦进入下面回调的依赖数组，
   * 切换语言就会重建回调 → 重挂监听 → 重跑一次性的会话恢复逻辑。
   */
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    initAuthStore();
  }, []);

  /**
   * 仅用于「刚刚完成的一次交互式登录」：主进程投递的一次性会话。
   * 这里才允许跳转到 /profile —— 恢复既有会话不得跳转，见 tryResumeDesktopSession。
   */
  const applyDesktopSession = useCallback(
    async (payload: DesktopSessionPayload) => {
      if (!payload?.accessToken) return;

      // 同一个 token 可能经 IPC / DOM 事件 / 轮询重复投递；首次已经跳过了，
      // 再跳一次就会在用户已经离开 /profile 之后把他拽回来。
      if (handledSessionTokens.current.has(payload.accessToken)) return;
      handledSessionTokens.current.add(payload.accessToken);

      try {
        console.info("[oauth] applying desktop session");
        await resumeDesktopOAuthSession(payload);
        window.__CTG_DESKTOP_SESSION__ = undefined;
        console.info("[oauth] desktop session applied, navigating to /profile");
        router.replace("/profile");
      } catch (error) {
        console.error("[oauth] apply desktop session failed:", error);
        handledSessionTokens.current.delete(payload.accessToken);
        if (useAuthStore.getState().status !== "authenticated") {
          toast.error(tRef.current("auth.callbackFailed"));
          router.replace("/login");
        }
      }
    },
    [router],
  );

  // Register a global handler the main process can call via executeJavaScript,
  // independent of whether IPC listeners are attached.
  useEffect(() => {
    window.__CTG_APPLY_DESKTOP_SESSION__ = (payload) => {
      void applyDesktopSession(payload);
    };
    return () => {
      if (window.__CTG_APPLY_DESKTOP_SESSION__) {
        delete window.__CTG_APPLY_DESKTOP_SESSION__;
      }
    };
  }, [applyDesktopSession]);

  const tryResumeDesktopSession = useCallback(async () => {
    if (!isDesktopClient() || resumeInFlight.current) return false;

    resumeInFlight.current = true;
    try {
      const pending = window.__CTG_DESKTOP_SESSION__;
      if (pending?.accessToken) {
        window.__CTG_DESKTOP_SESSION__ = undefined;
        await applyDesktopSession(pending);
        return true;
      }

      const electronAuth = getElectronAPI()?.auth;
      if (electronAuth) {
        const established = await electronAuth.consumeSessionEstablished();
        if (established) {
          await applyDesktopSession(established);
          return true;
        }
      }

      // 从磁盘恢复既有会话是「静默」的：刷新、切回窗口、语言切换都会走到这里，
      // 它只负责把登录态补齐，绝不能改变用户当前所在的路由。
      return await syncDesktopSessionFromDisk();
    } catch (error) {
      console.error("[oauth] resume desktop session failed:", error);
      return false;
    } finally {
      resumeInFlight.current = false;
    }
  }, [applyDesktopSession]);

  // Always listen for the DOM custom event (works even if preload IPC is late).
  useEffect(() => {
    if (!isDesktopClient()) return;

    const onDomSession = (event: Event) => {
      const detail = (event as CustomEvent<DesktopSessionPayload>).detail;
      if (detail?.accessToken) {
        window.__CTG_DESKTOP_SESSION__ = undefined;
        void applyDesktopSession(detail);
      }
    };

    window.addEventListener(DESKTOP_SESSION_EVENT, onDomSession);

    // Catch a session injected before this listener was attached.
    void tryResumeDesktopSession();

    const poll = window.setInterval(() => {
      if (window.__CTG_DESKTOP_SESSION__?.accessToken) {
        void tryResumeDesktopSession();
      }
    }, 500);

    const stopPoll = window.setTimeout(() => {
      window.clearInterval(poll);
    }, 60_000);

    const onFocus = () => {
      void tryResumeDesktopSession();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void tryResumeDesktopSession();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener(DESKTOP_SESSION_EVENT, onDomSession);
      window.clearInterval(poll);
      window.clearTimeout(stopPoll);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [applyDesktopSession, tryResumeDesktopSession]);

  useEffect(() => {
    const electronAuth = getElectronAPI()?.auth;
    if (!electronAuth) return;

    const unsubscribeSession = electronAuth.onSessionEstablished((payload) => {
      void applyDesktopSession(payload);
    });

    const unsubscribeOAuth = electronAuth.onOAuthCallback((url) => {
      try {
        const callback = new URL(url);
        if (
          callback.searchParams.get("error") ||
          !callback.searchParams.get("code")
        ) {
          toast.error(tRef.current("auth.callbackFailed"));
          router.replace("/login");
        }
      } catch {
        toast.error(tRef.current("auth.callbackFailed"));
        router.replace("/login");
      }
    });

    void electronAuth.notifyAuthReady().then(() => {
      void tryResumeDesktopSession();
    });

    return () => {
      unsubscribeSession();
      unsubscribeOAuth();
    };
  }, [applyDesktopSession, router, tryResumeDesktopSession]);

  return null;
}
