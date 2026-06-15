import { getElectronLocaleAPI, isElectronRuntime } from "@/lib/electron";
import {
  LOCALE_HTML_LANG,
  type AppLocale,
  type LocaleState,
} from "@/lib/locale";
import {
  BROWSER_SETTINGS_KEY,
  DEFAULT_SETTINGS,
  mergeAppSettings,
  parseAppSettings,
  type AppSettings,
} from "@/lib/settings";

let snapshot: LocaleState | null = null;
let ready = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function applyLocaleToDocument(locale: AppLocale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = LOCALE_HTML_LANG[locale];
}

function applyState(state: LocaleState): void {
  snapshot = { locale: state.locale };
  // 注意：不要在这里调用 i18n.changeLanguage。该函数会在模块加载时同步执行，
  // 若提前切换语言会导致首次客户端渲染（水合）与服务端默认语言文本不一致。
  // i18n 语言切换交由 LocaleProvider 在挂载后通过 effect 处理。
  applyLocaleToDocument(state.locale);
  emit();
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

function writeBrowserSettings(settings: AppSettings): void {
  localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(settings, null, 2));
}

function patchBrowserSettings(patch: Partial<AppSettings>): AppSettings {
  const next = mergeAppSettings(readBrowserSettings(), patch);
  writeBrowserSettings(next);
  return next;
}

function getBrowserLocaleState(): LocaleState {
  return { locale: readBrowserSettings().locale };
}

function setBrowserLocale(locale: AppLocale): LocaleState {
  patchBrowserSettings({ locale });
  const state = getBrowserLocaleState();
  applyState(state);
  return state;
}

function seedFromPreload(): void {
  if (snapshot || !isElectronRuntime()) return;
  const initial = window.electronAPI?.locale?.initialState;
  if (initial) {
    applyState(initial);
  }
}

function initBrowserLocale(): void {
  if (ready || isElectronRuntime() || typeof window === "undefined") return;
  ready = true;
  applyState(getBrowserLocaleState());
}

function initElectronLocale(): void {
  if (ready || !isElectronRuntime()) return;

  const api = getElectronLocaleAPI();
  if (!api) return;

  ready = true;
  seedFromPreload();
  api.onStateChanged(applyState);

  if (!snapshot) {
    void api.getState().then(applyState);
  }
}

function ensureReady(): void {
  if (isElectronRuntime()) {
    initElectronLocale();
  } else {
    initBrowserLocale();
  }
}

if (typeof window !== "undefined") {
  ensureReady();
}

export function subscribeLocale(listener: () => void): () => void {
  ensureReady();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLocaleSnapshot(): LocaleState | null {
  ensureReady();
  return snapshot;
}

export function getLocaleServerSnapshot(): LocaleState | null {
  return null;
}

export async function setAppLocale(locale: AppLocale): Promise<LocaleState> {
  ensureReady();

  if (isElectronRuntime()) {
    const api = getElectronLocaleAPI();
    if (!api) {
      throw new Error("Electron locale API unavailable");
    }
    const state = await api.setLocale(locale);
    applyState(state);
    return state;
  }

  return setBrowserLocale(locale);
}

export function readInitialLocaleState(): LocaleState | null {
  if (typeof window === "undefined") return null;

  if (isElectronRuntime()) {
    return window.electronAPI?.locale?.initialState ?? null;
  }

  return getBrowserLocaleState();
}
