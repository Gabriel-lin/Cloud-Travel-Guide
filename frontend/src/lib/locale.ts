export type AppLocale = "zh-CN" | "en";

export type LocaleState = {
  locale: AppLocale;
};

export const APP_LOCALES: readonly AppLocale[] = ["zh-CN", "en"];

export function isAppLocale(value: string): value is AppLocale {
  return (APP_LOCALES as readonly string[]).includes(value);
}

export const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";

export const LOCALE_IPC = {
  getState: "locale:getState",
  getStateSync: "locale:getStateSync",
  setLocale: "locale:setLocale",
  stateChanged: "locale:state-changed",
} as const;

export const LOCALE_LABELS: Record<AppLocale, string> = {
  "zh-CN": "简体中文",
  en: "English",
};

export const LOCALE_HTML_LANG: Record<AppLocale, string> = {
  "zh-CN": "zh-CN",
  en: "en",
};
