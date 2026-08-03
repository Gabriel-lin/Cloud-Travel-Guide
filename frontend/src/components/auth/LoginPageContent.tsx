"use client";

import { Compass, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { APP_NAME } from "@/config/app";
import { useAuth } from "@/hooks/use-auth";
import { useAppLocale } from "@/hooks/use-app-locale";
import { getLoginErrorMessage } from "@/lib/auth/login-error";
import { getRegisterPasswordErrorMessage } from "@/lib/auth/register-password-error";
import { cn } from "@/lib/utils";

const LOGIN_BG = "/images/login-scenery.jpg";

type AuthPageMode = "login" | "register";

type LoginPageContentProps = {
  mode?: AuthPageMode;
};

export function LoginPageContent({ mode = "login" }: LoginPageContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useAppLocale();
  const { login, register, isAuthenticated, isLoading, ready } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const returnTo = searchParams.get("returnTo") ?? "/profile";
  const isRegister = mode === "register";

  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    router.replace(returnTo);
  }, [ready, isAuthenticated, returnTo, router]);

  async function submitLogin() {
    if (submitting || isLoading) return;

    const payload = { username: username.trim(), password };

    setSubmitting(true);
    try {
      await login(payload);
      toast.success(t("auth.submit"));
      router.replace(returnTo);
    } catch (error) {
      toast.error(getLoginErrorMessage(error, t));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRegister() {
    if (submitting || isLoading) return;

    const payload = { username: username.trim(), password };
    const passwordError = getRegisterPasswordErrorMessage(password, t);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    setSubmitting(true);
    try {
      await register(payload);
      toast.success(t("auth.registerSuccess"));
      router.replace(returnTo);
    } catch {
      toast.error(t("auth.registerFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitLogin();
  }

  function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitRegister();
  }

  const pageTitle = isRegister ? t("auth.registerPageTitle") : t("auth.pageTitle");
  const pageDescription = isRegister
    ? t("auth.registerPageDescription")
    : t("auth.pageDescription");
  const brandSubtitle = isRegister
    ? t("auth.registerBrandSubtitle")
    : t("auth.brandSubtitle");
  const passwordAutoComplete = isRegister ? "new-password" : "current-password";
  const passwordPlaceholder = isRegister
    ? t("auth.registerPasswordPlaceholder")
    : t("auth.passwordPlaceholder");
  const passwordPattern = isRegister ? "[A-Za-z0-9]+" : undefined;
  const busy = submitting || isLoading;

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
              {APP_NAME}
            </span>
          </div>
          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight text-ink-50">
              {brandSubtitle}
            </h1>
            <p className="max-w-sm text-sm leading-relaxed text-ink-300">
              {pageDescription}
            </p>
          </div>
          <p className="text-xs text-ink-500">Jiuzhaigou · {APP_NAME}</p>
        </section>

        <section className="flex flex-col justify-center p-6 sm:p-10">
          <div className="mb-8 space-y-2 lg:hidden">
            <div className="flex items-center gap-2 text-brand-400">
              <Compass className="size-6" strokeWidth={1.75} />
              <span className="font-semibold">{APP_NAME}</span>
            </div>
            <h2 className="text-2xl font-semibold text-ink-50">{pageTitle}</h2>
            <p className="text-sm text-ink-400">{pageDescription}</p>
          </div>

          <div className="mb-6 hidden space-y-1 lg:block">
            <h2 className="text-2xl font-semibold text-ink-50">{pageTitle}</h2>
            <p className="text-sm text-ink-400">{pageDescription}</p>
          </div>

          <form
            className="space-y-5"
            onSubmit={isRegister ? handleRegister : handleLogin}
          >
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
                minLength={3}
                required
                className="h-10 border-surface-600/80 bg-surface-950/50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-ink-200">
                {t("auth.passwordLabel")}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={passwordAutoComplete}
                  placeholder={passwordPlaceholder}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={6}
                  pattern={passwordPattern}
                  title={isRegister ? t("auth.registerPasswordHint") : undefined}
                  required
                  className="h-10 border-surface-600/80 bg-surface-950/50 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className={cn(
                    "absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-surface-800/60 hover:text-ink-200",
                  )}
                  aria-label={
                    showPassword ? t("auth.hidePassword") : t("auth.showPassword")
                  }
                  aria-pressed={showPassword}
                  aria-controls="password"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className={cn(
                "h-10 w-full cursor-pointer bg-brand-600 text-ink-50 hover:bg-brand-500",
              )}
              disabled={busy}
            >
              {busy
                ? isRegister
                  ? t("auth.registering")
                  : t("auth.submitting")
                : isRegister
                  ? t("auth.register")
                  : t("auth.submit")}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <Separator className="flex-1 bg-surface-700/80" />
            <span className="text-xs text-ink-500">{t("auth.orContinueWith")}</span>
            <Separator className="flex-1 bg-surface-700/80" />
          </div>

          <OAuthButtons />

          <p className="mt-8 text-center text-sm text-ink-400">
            {isRegister ? t("auth.hasAccount") : t("auth.noAccount")}{" "}
            <Link
              href={isRegister ? "/login" : "/register"}
              className="font-medium text-brand-400 hover:text-brand-300"
            >
              {isRegister ? t("auth.submit") : t("auth.register")}
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
