import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useInitSettings } from "@/hooks/use-init-settings";
import { useElectronRuntime } from "@/lib/electron";
import { DEFAULT_APP_LOCALE, LOCALE_LABELS, type AppLocale } from "@/lib/locale";
import { useSettingsStore } from "@/store";

export type TranslateValues = Record<string, string | number>;

export type UseAppLocaleResult = {
  mounted: boolean;
  isDesktop: boolean;
  locale: AppLocale;
  setLocale: (locale: AppLocale) => Promise<void>;
  t: (key: string, values?: TranslateValues) => string;
  localeLabel: (locale: AppLocale) => string;
};

export function useLocale(): UseAppLocaleResult {
  useInitSettings();
  const { t } = useTranslation();
  const { inDesktop } = useElectronRuntime();
  const ready = useSettingsStore((s) => s.ready);
  const locale = useSettingsStore((s) => s.settings.locale);
  const setLocale = useSettingsStore((s) => s.setAppLocale);

  const translate = useMemo<UseAppLocaleResult["t"]>(
    () => (key, values) => t(key, values) as string,
    [t],
  );

  return {
    mounted: ready,
    isDesktop: inDesktop,
    locale: ready ? locale : DEFAULT_APP_LOCALE,
    setLocale,
    t: translate,
    localeLabel: (value) => LOCALE_LABELS[value],
  };
}

/** @deprecated 使用 useLocale */
export const useAppLocale = useLocale;
