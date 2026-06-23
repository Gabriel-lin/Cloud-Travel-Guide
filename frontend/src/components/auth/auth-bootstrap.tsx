"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";

import { authService } from "@/service/auth";
import { getElectronAPI } from "@/lib/electron";
import { establishSession, initAuthStore } from "@/store";
import { useAppLocale } from "@/hooks/use-app-locale";

/** 根布局挂载时初始化认证 store */
export function AuthBootstrap() {
  const router = useRouter();
  const { t } = useAppLocale();

  useEffect(() => {
    initAuthStore();
  }, []);

  useEffect(() => {
    const electronAuth = getElectronAPI()?.auth;
    if (!electronAuth) return;

    return electronAuth.onOAuthCallback((url) => {
      const run = async () => {
        const callback = new URL(url);
        const error = callback.searchParams.get("error");
        if (error) {
          toast.error(t("auth.callbackFailed"));
          router.replace("/login");
          return;
        }

        const code = callback.searchParams.get("code");
        if (!code) {
          toast.error(t("auth.callbackFailed"));
          router.replace("/login");
          return;
        }

        try {
          const session = await authService.exchangeDesktopOAuthCode(code);
          await establishSession(session);
          router.replace("/profile");
        } catch {
          toast.error(t("auth.callbackFailed"));
          router.replace("/login");
        }
      };

      void run();
    });
  }, [router, t]);

  return null;
}
