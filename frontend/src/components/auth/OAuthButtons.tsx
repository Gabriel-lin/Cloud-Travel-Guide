"use client";

import { authService, type OAuthProvider } from "@/service/auth";
import { Button } from "@/components/ui/button";
import { useAppLocale } from "@/hooks/use-app-locale";
import { GitHubIcon, GoogleIcon } from "./oauth-icons";

const OAUTH_CALLBACK_PATH = "/auth/callback";

function getOAuthRedirectUri() {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${OAUTH_CALLBACK_PATH}`;
}

function startOAuth(provider: OAuthProvider) {
  const redirectUri = getOAuthRedirectUri();
  window.location.assign(
    authService.getOAuthAuthorizeUrl(provider, redirectUri),
  );
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
