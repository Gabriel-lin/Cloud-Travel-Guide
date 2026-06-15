"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { useElectronRuntime } from "@/lib/electron";
import { DEFAULT_APP_LOCALE, LOCALE_LABELS, type AppLocale } from "@/lib/locale";
import {
  getLocaleServerSnapshot,
  getLocaleSnapshot,
  setAppLocale,
  subscribeLocale,
} from "@/store";

export type TranslateValues = Record<string, string | number>;

export type LocaleContextValue = {
  mounted: boolean;
  isDesktop: boolean;
  locale: AppLocale;
  setLocale: (locale: AppLocale) => Promise<void>;
  t: (key: string, values?: TranslateValues) => string;
  localeLabel: (locale: AppLocale) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function LocaleContextBridge({
  children,
  value,
}: {
  children: ReactNode;
  value: Omit<LocaleContextValue, "t">;
}) {
  const { t } = useTranslation();

  const contextValue = useMemo<LocaleContextValue>(
    () => ({
      ...value,
      t: (key, values) => t(key, values),
    }),
    [t, value],
  );

  return (
    <LocaleContext.Provider value={contextValue}>{children}</LocaleContext.Provider>
  );
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    subscribeLocale,
    getLocaleSnapshot,
    getLocaleServerSnapshot,
  );
  const { inDesktop } = useElectronRuntime();

  const locale = state?.locale ?? DEFAULT_APP_LOCALE;

  // 仅在挂载后切换语言：首次客户端渲染须与服务端（默认语言）一致以避免水合不匹配，
  // 不匹配会触发 React 重新生成整棵树，进而抹掉引导脚本写入的 html.dark 等运行时类。
  useEffect(() => {
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
  }, [locale]);

  const setLocale = useCallback(async (next: AppLocale) => {
    await setAppLocale(next);
  }, []);

  const bridgeValue = useMemo(
    () => ({
      mounted: state !== null,
      isDesktop: inDesktop,
      locale,
      setLocale,
      localeLabel: (value: AppLocale) => LOCALE_LABELS[value],
    }),
    [inDesktop, locale, setLocale, state],
  );

  return (
    <I18nextProvider i18n={i18n}>
      <LocaleContextBridge value={bridgeValue}>{children}</LocaleContextBridge>
    </I18nextProvider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}

/** @deprecated 使用 useLocale */
export const useAppLocale = useLocale;
