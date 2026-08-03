"use client";

import { toast } from "sonner";

import { DESKTOP_OAUTH_REDIRECT_URI } from "@/config/app";
import { authService, type OAuthProvider } from "@/service/auth";
import { Button } from "@/components/ui/button";
import { useAppLocale } from "@/hooks/use-app-locale";
import { getElectronAPI } from "@/lib/electron";
import { GitHubIcon, GoogleIcon } from "./oauth-icons";

const OAUTH_CALLBACK_PATH = "/auth/callback";

function getWebOAuthRedirectUri() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${OAUTH_CALLBACK_PATH}`;
}

function buildDesktopOAuthUrl(provider: OAuthProvider) {
  return authService.getOAuthAuthorizeUrl(
    provider,
    DESKTOP_OAUTH_REDIRECT_URI,
    "desktop",
  );
}

/** Same-tab web OAuth (browser only — never used when Electron bridge is present). */
function startWebOAuth(provider: OAuthProvider) {
  window.location.assign(
    authService.getOAuthAuthorizeUrl(provider, getWebOAuthRedirectUri(), "web"),
  );
}

export function OAuthButtons() {
  const { t } = useAppLocale();

  async function startOAuth(provider: OAuthProvider) {
    try {
      const auth = getElectronAPI()?.auth;

      // Desktop shell: always system-browser + desktop client_type / deep link.
      if (auth?.startOAuth) {
        await auth.startOAuth(provider);
        return;
      }
      if (auth?.openOAuthUrl) {
        await auth.openOAuthUrl(buildDesktopOAuthUrl(provider));
        return;
      }

      // Pure browser — same tab.
      startWebOAuth(provider);
    } catch (error) {
      console.error("[oauth] sign-in failed:", error);
      toast.error(t("auth.callbackFailed"));
    }
  }

  return (
    <div className="grid gap-3">
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full cursor-pointer border-surface-600/80 bg-surface-900/50 text-ink-100 hover:bg-surface-800"
        onClick={() => void startOAuth("github")}
      >
        <GitHubIcon className="size-4" />
        {t("auth.github")}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full cursor-pointer border-surface-600/80 bg-surface-900/50 text-ink-100 hover:bg-surface-800"
        onClick={() => void startOAuth("google")}
      >
        <GoogleIcon className="size-4" />
        {t("auth.google")}
      </Button>
    </div>
  );
}
