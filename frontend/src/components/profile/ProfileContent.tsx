"use client";

import Link from "next/link";
import { toast } from "sonner";

import { ModulePage } from "@/components/layout/ModulePage";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useAppLocale } from "@/hooks/use-app-locale";

const PROFILE_BG = "/images/profile-scenery.jpg";

function userInitials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ProfileContent() {
  const { t, locale, localeLabel } = useAppLocale();
  const { user, isAuthenticated, isLoading, logout } = useAuth();

  async function handleLogout() {
    try {
      await logout();
      toast.success(t("auth.logout"));
    } catch {
      toast.error(t("auth.callbackFailed"));
    }
  }

  const displayName = user?.displayName ?? user?.username ?? t("profile.displayName");

  return (
    <ModulePage
      title={t("nav.profile.pageTitle")}
      description={t("nav.profile.pageDescription")}
      showBreadcrumb={false}
      backgroundImage={PROFILE_BG}
      contentClassName="overflow-hidden"
    >
      <div className="w-full space-y-6 rounded-lg border border-surface-700/80 bg-surface-900/75 p-5 shadow-lg ring-1 ring-brand-500/10 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-14 ring-2 ring-brand-500/20">
              {user?.avatarUrl ? (
                <AvatarImage src={user.avatarUrl} alt={displayName} />
              ) : null}
              <AvatarFallback className="bg-surface-800 text-brand-400">
                {isAuthenticated ? userInitials(displayName) : "CT"}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-base font-semibold text-ink-100">{displayName}</p>
              <p className="text-sm text-ink-400">
                {isAuthenticated
                  ? user?.email ?? user?.username
                  : t("profile.notSignedIn")}
              </p>
            </div>
          </div>

          {isAuthenticated ? (
            <Button
              type="button"
              variant="outline"
              className="cursor-pointer border-surface-600/80"
              disabled={isLoading}
              onClick={() => void handleLogout()}
            >
              {isLoading ? t("auth.loggingOut") : t("auth.logout")}
            </Button>
          ) : (
            <Button
              nativeButton={false}
              render={<Link href="/login?returnTo=/profile" />}
              className="cursor-pointer bg-brand-600 text-white hover:bg-brand-500"
            >
              {t("auth.submit")}
            </Button>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-ink-200">{t("profile.preferencesLabel")}</Label>
          <p className="text-sm text-ink-400">{t("profile.preferencesValue")}</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-ink-200">{t("profile.languageLabel")}</Label>
          <p className="text-sm text-ink-400">{localeLabel(locale)}</p>
        </div>
      </div>
    </ModulePage>
  );
}
