import { applyResolvedThemeToDocument } from "@/lib/apply-dom-theme";
import { getElectronThemeAPI, isElectronRuntime } from "@/lib/electron";
import { createThemeState } from "@/lib/resolve-theme-state";
import {
  BROWSER_SETTINGS_KEY,
  DEFAULT_SETTINGS,
  mergeAppSettings,
  parseAppSettings,
  type AppSettings,
} from "@/lib/settings";
import type { ResolvedTheme, ThemePreference, ThemeState } from "@/lib/theme";

let snapshot: ThemeState | null = null;
let ready = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function applyState(state: ThemeState): void {
  snapshot = {
    preference: state.preference,
    resolved: state.resolved,
    system: state.system,
  };
  applyResolvedThemeToDocument(state.resolved);
  emit();
}

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

function writeBrowserSettings(settings: AppSettings): void {
  localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(settings, null, 2));
}

function patchBrowserSettings(patch: Partial<AppSettings>): AppSettings {
  const next = mergeAppSettings(readBrowserSettings(), patch);
  writeBrowserSettings(next);
  return next;
}

function getBrowserThemeState(): ThemeState {
  const settings = readBrowserSettings();
  const system = readBrowserSystemTheme();
  return createThemeState(settings.theme, system);
}

function setBrowserThemePreference(preference: ThemePreference): ThemeState {
  patchBrowserSettings({ theme: preference });
  const state = getBrowserThemeState();
  applyState(state);
  return state;
}

function seedFromPreload(): void {
  if (snapshot || !isElectronRuntime()) return;
  const initial = window.electronAPI?.theme?.initialState;
  if (initial) {
    applyState(initial);
  }
}

function initBrowserTheme(): void {
  if (ready || isElectronRuntime() || typeof window === "undefined") return;
  ready = true;

  applyState(getBrowserThemeState());

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if (readBrowserSettings().theme === "system") {
      applyState(getBrowserThemeState());
    }
  };
  media.addEventListener("change", onSystemChange);
}

function initElectronTheme(): void {
  if (ready || !isElectronRuntime()) return;

  const api = getElectronThemeAPI();
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
    initElectronTheme();
  } else {
    initBrowserTheme();
  }
}

if (typeof window !== "undefined") {
  ensureReady();
}

export function subscribeTheme(listener: () => void): () => void {
  ensureReady();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getThemeSnapshot(): ThemeState | null {
  ensureReady();
  return snapshot;
}

export function getThemeServerSnapshot(): ThemeState | null {
  return null;
}

export async function setThemePreference(
  preference: ThemePreference,
): Promise<ThemeState> {
  ensureReady();

  if (isElectronRuntime()) {
    const api = getElectronThemeAPI();
    if (!api) {
      throw new Error("Electron theme API unavailable");
    }
    const state = await api.setPreference(preference);
    applyState(state);
    return state;
  }

  return setBrowserThemePreference(preference);
}

export function readInitialThemeState(): ThemeState | null {
  if (typeof window === "undefined") return null;

  if (isElectronRuntime()) {
    return window.electronAPI?.theme?.initialState ?? null;
  }

  return getBrowserThemeState();
}
