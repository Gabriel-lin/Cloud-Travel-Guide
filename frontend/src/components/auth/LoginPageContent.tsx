"use client";

import { Compass } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useAppLocale } from "@/hooks/use-app-locale";
import { cn } from "@/lib/utils";

const LOGIN_BG = "/images/login-scenery.jpg";

export function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useAppLocale();
  const { login, isAuthenticated, isLoading, ready, error, clearError } =
    useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const returnTo = searchParams.get("returnTo") ?? "/profile";

  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    router.replace(returnTo);
  }, [ready, isAuthenticated, returnTo, router]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || isLoading) return;

    setSubmitting(true);
    try {
      await login({ username: username.trim(), password });
      toast.success(t("auth.submit"));
      router.replace(returnTo);
    } catch {
      toast.error(t("auth.loginFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4 sm:p-8">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${LOGIN_BG})` }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-surface-950/55 backdrop-blur-[2px]"
        aria-hidden
      />

      <div className="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-2xl border border-surface-700/70 bg-surface-900/70 shadow-2xl ring-1 ring-brand-500/10 backdrop-blur-xl lg:grid-cols-[1.05fr_1fr]">
        <section className="relative hidden flex-col justify-between border-r border-surface-700/60 bg-surface-950/35 p-10 lg:flex">
          <div className="flex items-center gap-3 text-brand-400">
            <Compass className="size-8" strokeWidth={1.75} />
            <span className="text-lg font-semibold tracking-tight">
              {t("auth.brandTitle")}
            </span>
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-ink-50">
              {t("auth.brandSubtitle")}
            </h1>
            <p className="max-w-sm text-sm leading-relaxed text-ink-300">
              {t("auth.pageDescription")}
            </p>
          </div>
          <p className="text-xs text-ink-500">Jiuzhaigou · Cloud Travel Guide</p>
        </section>

        <section className="flex flex-col justify-center p-6 sm:p-10">
          <div className="mb-8 space-y-2 lg:hidden">
            <div className="flex items-center gap-2 text-brand-400">
              <Compass className="size-6" strokeWidth={1.75} />
              <span className="font-semibold">{t("auth.brandTitle")}</span>
            </div>
            <h2 className="text-2xl font-semibold text-ink-50">
              {t("auth.pageTitle")}
            </h2>
            <p className="text-sm text-ink-400">{t("auth.pageDescription")}</p>
          </div>

          <div className="mb-6 hidden space-y-1 lg:block">
            <h2 className="text-2xl font-semibold text-ink-50">
              {t("auth.pageTitle")}
            </h2>
            <p className="text-sm text-ink-400">{t("auth.pageDescription")}</p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username" className="text-ink-200">
                {t("auth.usernameLabel")}
              </Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                placeholder={t("auth.usernamePlaceholder")}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                className="h-10 border-surface-600/80 bg-surface-950/50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-ink-200">
                {t("auth.passwordLabel")}
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder={t("auth.passwordPlaceholder")}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                className="h-10 border-surface-600/80 bg-surface-950/50"
              />
            </div>

            <Button
              type="submit"
              className={cn(
                "h-10 w-full cursor-pointer bg-brand-600 text-white hover:bg-brand-500",
              )}
              disabled={submitting || isLoading}
            >
              {submitting || isLoading ? t("auth.submitting") : t("auth.submit")}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1 bg-surface-700/80" />
            <span className="text-xs text-ink-500">{t("auth.orContinueWith")}</span>
            <Separator className="flex-1 bg-surface-700/80" />
          </div>

          <OAuthButtons />

          <p className="mt-8 text-center text-sm text-ink-400">
            {t("auth.noAccount")}{" "}
            <Link
              href="/login"
              className="font-medium text-brand-400 hover:text-brand-300"
            >
              {t("auth.register")}
            </Link>
          </p>

          <p className="mt-4 text-center">
            <Link
              href="/"
              className="text-sm text-ink-500 transition-colors hover:text-ink-300"
            >
              {t("auth.backToApp")}
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
