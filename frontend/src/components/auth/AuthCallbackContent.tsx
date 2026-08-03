"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { authService, type OAuthProvider } from "@/service/auth";
import { toAuthSession } from "@/service/auth";
import { establishCookieSession, establishSession } from "@/store";
import { useAppLocale } from "@/hooks/use-app-locale";

function parseProvider(value: string | null): OAuthProvider | null {
  if (value === "github" || value === "google") return value;
  return null;
}

/**
 * Web OAuth lands here in the same tab after provider → backend redirect.
 * Prefer one-time login code (cross-origin safe); keep cookie / token fallbacks.
 */
export function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useAppLocale();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const run = async () => {
      const error = searchParams.get("error");
      if (error) {
        toast.error(t("auth.callbackFailed"));
        router.replace("/login");
        return;
      }

      const returnTo = searchParams.get("returnTo") ?? "/profile";
      const code = searchParams.get("code");
      const provider = parseProvider(searchParams.get("provider"));
      const oauthSuccess = searchParams.get("oauth") === "success";
      const accessToken = searchParams.get("access_token");
      const tokenType = searchParams.get("token_type") ?? "bearer";
      const expiresIn = searchParams.get("expires_in");

      // Backend one-time login code (web client_type) — same-tab completion.
      if (code && !provider) {
        try {
          const session = await authService.exchangeDesktopOAuthCode(code);
          await establishSession(session);
          router.replace(returnTo);
          return;
        } catch {
          toast.error(t("auth.callbackFailed"));
          router.replace("/login");
          return;
        }
      }

      // Legacy same-origin cookie session.
      if (oauthSuccess) {
        try {
          await establishCookieSession();
          router.replace(returnTo);
          return;
        } catch {
          toast.error(t("auth.callbackFailed"));
          router.replace("/login");
          return;
        }
      }

      if (accessToken) {
        try {
          await establishSession(
            toAuthSession({
              access_token: accessToken,
              token_type: tokenType,
              expires_in: expiresIn ? Number(expiresIn) : undefined,
            }),
          );
          router.replace(returnTo);
          return;
        } catch {
          toast.error(t("auth.callbackFailed"));
          router.replace("/login");
          return;
        }
      }

      // Legacy: SPA exchanges provider code directly.
      if (code && provider) {
        const redirectUri = `${window.location.origin}/auth/callback`;

        try {
          const session = await authService.exchangeOAuthCode({
            provider,
            code,
            redirectUri,
          });
          await establishSession(session);
          router.replace(returnTo);
          return;
        } catch {
          toast.error(t("auth.callbackFailed"));
          router.replace("/login");
          return;
        }
      }

      toast.error(t("auth.callbackFailed"));
      router.replace("/login");
    };

    void run();
  }, [router, searchParams, t]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-950 text-ink-300">
      <p className="text-sm">{t("auth.callbackLoading")}</p>
    </div>
  );
}
