"use client";

import { DESKTOP_OAUTH_REDIRECT_URI } from "@/config/app";
import { authService, type OAuthProvider } from "@/service/auth";
import { Button } from "@/components/ui/button";
import { useAppLocale } from "@/hooks/use-app-locale";
import { getElectronAPI, isElectronRuntime } from "@/lib/electron";
import { GitHubIcon, GoogleIcon } from "./oauth-icons";

const OAUTH_CALLBACK_PATH = "/auth/callback";

function getOAuthRedirectUri() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${OAUTH_CALLBACK_PATH}`;
}

function startOAuth(provider: OAuthProvider) {
  if (isElectronRuntime()) {
    const url = authService.getOAuthAuthorizeUrl(
      provider,
      DESKTOP_OAUTH_REDIRECT_URI,
      "desktop",
    );
    void getElectronAPI()?.auth.openOAuthUrl(url);
    return;
  }

  window.location.assign(authService.getOAuthAuthorizeUrl(provider, getOAuthRedirectUri()));
}

export function OAuthButtons() {
  const { t } = useAppLocale();

  return (
    <div className="grid gap-3">
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full cursor-pointer border-surface-600/80 bg-surface-900/50 text-ink-100 hover:bg-surface-800"
        onClick={() => startOAuth("github")}
      >
        <GitHubIcon className="size-4" />
        {t("auth.github")}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full cursor-pointer border-surface-600/80 bg-surface-900/50 text-ink-100 hover:bg-surface-800"
        onClick={() => startOAuth("google")}
      >
        <GoogleIcon className="size-4" />
        {t("auth.google")}
      </Button>
    </div>
  );
}
