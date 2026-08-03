import { create } from "zustand";

import i18n from "@/i18n";
import { applyResolvedThemeToDocument } from "@/lib/apply-dom-theme";
import {
  getElectronLocaleAPI,
  getElectronThemeAPI,
  isElectronRuntime,
} from "@/lib/electron";
import {
  LOCALE_HTML_LANG,
  type AppLocale,
  type LocaleState,
} from "@/lib/locale";
import { resolveThemePreference } from "@/lib/resolve-theme-state";
import {
  BROWSER_SETTINGS_KEY,
  DEFAULT_SETTINGS,
  mergeAppSettings,
  parseAppSettings,
  type AppSettings,
} from "@/lib/settings";
import type { ResolvedTheme, ThemePreference, ThemeState } from "@/lib/theme";

/**
 * 统一应用设置 store（zustand）。
 *
 * - `settings` 是唯一可持久化的来源，后续新增配置（如快捷键绑定）只需扩展
 *   `AppSettings` 与下方 action，无需新增 store。
 * - `ready` 在挂载后由 {@link initSettingsStore} 置真。SSR 与首次客户端渲染读取的是
 *   zustand 的 *初始 state*（getInitialState，ready=false / 默认值），从而与服务端
 *   渲染一致、避免水合不匹配；挂载后再填充真实值。
 */
export type SettingsStore = {
  ready: boolean;
  settings: AppSettings;
  systemTheme: ResolvedTheme;
  setThemePreference: (preference: ThemePreference) => Promise<void>;
  setAppLocale: (locale: AppLocale) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
};

// ---------------------------------------------------------------------------
// 浏览器运行时持久化：localStorage + matchMedia
// ---------------------------------------------------------------------------

function readBrowserSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readBrowserSettings(): AppSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(BROWSER_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return parseAppSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeBrowserSettings(next: AppSettings): void {
  localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(next, null, 2));
}

function patchBrowserSettings(patch: Partial<AppSettings>): AppSettings {
  const next = mergeAppSettings(readBrowserSettings(), patch);
  writeBrowserSettings(next);
  return next;
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  systemTheme: "dark",

  setThemePreference: async (preference) => {
    if (isElectronRuntime()) {
      const api = getElectronThemeAPI();
      if (!api) throw new Error("Electron theme API unavailable");
      const state = await api.setPreference(preference);
      set({
        settings: { ...get().settings, theme: state.preference },
        systemTheme: state.system,
      });
      return;
    }
    set({ settings: patchBrowserSettings({ theme: preference }) });
  },

  setAppLocale: async (locale) => {
    if (isElectronRuntime()) {
      const api = getElectronLocaleAPI();
      if (!api) throw new Error("Electron locale API unavailable");
      const state = await api.setLocale(locale);
      set({ settings: { ...get().settings, locale: state.locale } });
      return;
    }
    set({ settings: patchBrowserSettings({ locale }) });
  },

  /**
   * 通用设置更新：未来新增的配置项（快捷键绑定等）可直接经此入口写入。
   * Electron 运行时下，theme / locale 走各自的原生桥；其余键暂仅在浏览器端持久化，
   * 待新增对应 IPC 通道后再在此路由。
   */
  updateSettings: async (patch) => {
    if (isElectronRuntime()) {
      if (patch.theme !== undefined) await get().setThemePreference(patch.theme);
      if (patch.locale !== undefined) await get().setAppLocale(patch.locale);
      return;
    }
    set({ settings: patchBrowserSettings(patch) });
  },
}));

/** 派生：当前实际生效主题 */
export function selectResolvedTheme(state: SettingsStore): ResolvedTheme {
  return resolveThemePreference(state.settings.theme, state.systemTheme);
}

// ---------------------------------------------------------------------------
// 副作用：state 变化 → 同步 DOM（主题 class / html lang）与 i18n 语言
// 在 React 渲染之外执行；仅在挂载后（initSettingsStore 之后）才会触发。
// ---------------------------------------------------------------------------

function syncDocumentToSettings(state: SettingsStore): void {
  if (typeof document === "undefined") return;

  applyResolvedThemeToDocument(selectResolvedTheme(state));

  const { locale } = state.settings;
  document.documentElement.lang = LOCALE_HTML_LANG[locale];
  if (i18n.language !== locale) {
    void i18n.changeLanguage(locale);
  }
}

useSettingsStore.subscribe((state, prev) => {
  const themeChanged = selectResolvedTheme(state) !== selectResolvedTheme(prev);
  const localeChanged = state.settings.locale !== prev.settings.locale;

  if (themeChanged || localeChanged) {
    syncDocumentToSettings(state);
  }
});

// ---------------------------------------------------------------------------
// 初始化：挂载后调用一次（见 useInitSettings）。SSR 期间不执行。
// ---------------------------------------------------------------------------

let initialized = false;

function initBrowser(): void {
  useSettingsStore.setState({
    settings: readBrowserSettings(),
    systemTheme: readBrowserSystemTheme(),
    ready: true,
  });

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", () => {
    useSettingsStore.setState({ systemTheme: readBrowserSystemTheme() });
  });
}

function applyElectronTheme(state: ThemeState): void {
  useSettingsStore.setState((s) => ({
    settings: { ...s.settings, theme: state.preference },
    systemTheme: state.system,
    ready: true,
  }));
}

function applyElectronLocale(state: LocaleState): void {
  useSettingsStore.setState((s) => ({
    settings: { ...s.settings, locale: state.locale },
    ready: true,
  }));
}

function initElectron(): void {
  const themeApi = getElectronThemeAPI();
  const localeApi = getElectronLocaleAPI();
  if (!themeApi || !localeApi) return;

  // 先订阅再读取：主进程状态是同步可读的，两步之间不会漏掉广播。
  themeApi.onStateChanged(applyElectronTheme);
  localeApi.onStateChanged(applyElectronLocale);

  const themeState = themeApi.readState();
  useSettingsStore.setState({
    settings: {
      theme: themeState.preference,
      locale: localeApi.readState().locale,
    },
    systemTheme: themeState.system,
    ready: true,
  });
}

/** 挂载后调用一次：从运行时（浏览器 / Electron）填充真实设置并接入更新。 */
export function initSettingsStore(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  if (isElectronRuntime()) {
    initElectron();
  } else {
    initBrowser();
  }

  // 首屏内联脚本与 store 各自读取运行时，这里收敛一次，杜绝两者判断不一致时
  // DOM 停在错误主题上（订阅只在“变化”时触发，补不了这种初始偏差）。
  syncDocumentToSettings(useSettingsStore.getState());
}
