import {
  DEFAULT_APP_LOCALE,
  isAppLocale,
  type AppLocale,
} from "./locale";
import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  type ThemePreference,
} from "./theme";

/** 应用设置（与 Electron userData/settings.json 结构一致） */
export type AppSettings = {
  theme: ThemePreference;
  locale: AppLocale;
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: DEFAULT_THEME_PREFERENCE,
  locale: DEFAULT_APP_LOCALE,
};

/** 浏览器端 settings 持久化键名 */
export const BROWSER_SETTINGS_KEY = "ctg-settings";

export function parseAppSettings(raw: unknown): AppSettings {
  const settings = { ...DEFAULT_SETTINGS };

  if (typeof raw !== "object" || raw === null) {
    return settings;
  }

  const record = raw as Record<string, unknown>;

  if (typeof record.theme === "string" && isThemePreference(record.theme)) {
    settings.theme = record.theme;
  }

  if (typeof record.locale === "string" && isAppLocale(record.locale)) {
    settings.locale = record.locale;
  }

  return settings;
}

export function mergeAppSettings(
  current: AppSettings,
  patch: Partial<AppSettings>,
): AppSettings {
  return { ...current, ...patch };
}
