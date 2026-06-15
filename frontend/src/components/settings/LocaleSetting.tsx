"use client";

import { Languages } from "lucide-react";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAppLocale } from "@/hooks/use-app-locale";
import { APP_LOCALES, type AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

export function LocaleSetting() {
  const { mounted, isDesktop, locale, setLocale, localeLabel, t } =
    useAppLocale();

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <Label className="text-ink-200">{t("settings.language.label")}</Label>
        <p className="text-xs text-ink-400">
          {isDesktop
            ? t("settings.language.descriptionDesktop")
            : t("settings.language.descriptionBrowser")}
        </p>
      </div>
      {mounted ? (
        <RadioGroup
          key={locale}
          value={locale}
          onValueChange={(value) => {
            void setLocale(value as AppLocale);
          }}
          className="grid gap-2 sm:grid-cols-2"
        >
          {APP_LOCALES.map((value) => (
            <label
              key={value}
              htmlFor={`locale-${value}`}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border border-surface-700/80 bg-surface-800/40 px-3 py-2.5 transition-colors",
                "hover:bg-surface-800/70 has-data-checked:border-brand-500/40 has-data-checked:bg-brand-600/10",
              )}
            >
              <RadioGroupItem id={`locale-${value}`} value={value} />
              <Languages
                className="size-4 shrink-0 text-brand-500"
                strokeWidth={1.75}
              />
              <span className="text-sm font-medium text-ink-200">
                {localeLabel(value)}
              </span>
            </label>
          ))}
        </RadioGroup>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {APP_LOCALES.map((value) => (
            <div
              key={value}
              className="h-[42px] rounded-lg border border-surface-700/50 bg-surface-800/30"
              aria-hidden
            >
              <span className="sr-only">{localeLabel(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
