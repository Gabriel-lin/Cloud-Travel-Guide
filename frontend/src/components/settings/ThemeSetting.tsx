"use client";

import { Monitor, Moon, Sun } from "lucide-react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAppTheme } from "@/hooks/use-app-theme";
import { useAppLocale } from "@/hooks/use-app-locale";
import type { ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function ThemeSetting() {
  const { mounted, isDesktop, preference, systemTheme, setPreference } =
    useAppTheme();
  const { t } = useAppLocale();

  const THEME_OPTIONS = [
    { value: "light" as const, label: t("settings.theme.light"), icon: Sun },
    { value: "dark" as const, label: t("settings.theme.dark"), icon: Moon },
    {
      value: "system" as const,
      label: t("settings.theme.system"),
      icon: Monitor,
    },
  ];

  const systemHint =
    mounted && preference === "system" && systemTheme
      ? t("settings.theme.systemHint", {
          mode:
            systemTheme === "dark"
              ? t("settings.theme.modeDark")
              : t("settings.theme.modeLight"),
        })
      : mounted && isDesktop && systemTheme
        ? t("settings.theme.systemHint", {
            mode:
              systemTheme === "dark"
                ? t("settings.theme.modeDark")
                : t("settings.theme.modeLight"),
          })
        : null;

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <Label className="text-ink-200">{t("settings.theme.label")}</Label>
        <p className="text-xs text-ink-400">
          {isDesktop
            ? t("settings.theme.descriptionDesktop")
            : t("settings.theme.descriptionBrowser")}
        </p>
        {systemHint ? (
          <p className="text-xs text-brand-400">{systemHint}</p>
        ) : null}
      </div>
      {mounted ? (
        <RadioGroup
          key={preference}
          value={preference}
          onValueChange={(value) => {
            void setPreference(value as ThemePreference);
          }}
          className="grid gap-2 sm:grid-cols-3"
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <label
              key={value}
              htmlFor={`theme-${value}`}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border border-surface-700/80 bg-surface-800/40 px-3 py-2.5 transition-colors",
                "hover:bg-surface-800/70 has-data-checked:border-brand-500/40 has-data-checked:bg-brand-600/10",
              )}
            >
              <RadioGroupItem id={`theme-${value}`} value={value} />
              <Icon className="size-4 shrink-0 text-brand-500" strokeWidth={1.75} />
              <span className="text-sm font-medium text-ink-200">{label}</span>
            </label>
          ))}
        </RadioGroup>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          {THEME_OPTIONS.map(({ value, label }) => (
            <div
              key={value}
              className="h-[42px] rounded-lg border border-surface-700/50 bg-surface-800/30"
              aria-hidden
            >
              <span className="sr-only">{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
