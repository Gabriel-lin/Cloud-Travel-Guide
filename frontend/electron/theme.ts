import {
  BrowserWindow,
  ipcMain,
  nativeTheme,
  systemPreferences,
} from "electron";

import { setApplicationMenu } from "./menu";
import { applyNativeChrome } from "./native-chrome";
import { patchAppSettings, readAppSettings } from "./settings-io";
import { createThemeState } from "../src/lib/resolve-theme-state";
import {
  isThemePreference,
  THEME_IPC,
  type ResolvedTheme,
  type ThemePreference,
  type ThemeState,
} from "../src/lib/theme";

let cachedSystemTheme: ResolvedTheme = "dark";
let lastSyncedResolved: ResolvedTheme | undefined;
let lastPublishedState: ThemeState | undefined;

function isSameThemeState(a: ThemeState, b: ThemeState): boolean {
  return (
    a.preference === b.preference &&
    a.resolved === b.resolved &&
    a.system === b.system
  );
}

function readThemePreference(): ThemePreference {
  return readAppSettings().theme;
}

function writeThemePreference(preference: ThemePreference): void {
  patchAppSettings({ theme: preference });
}

function refreshCachedSystemTheme(): void {
  if (process.platform === "darwin") {
    cachedSystemTheme =
      systemPreferences.getEffectiveAppearance() === "dark" ? "dark" : "light";
    return;
  }

  if (nativeTheme.themeSource === "system") {
    cachedSystemTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  }
}

function probeSystemThemeAtStartup(): void {
  if (process.platform === "darwin") {
    refreshCachedSystemTheme();
    return;
  }

  const previous = nativeTheme.themeSource;
  nativeTheme.themeSource = "system";
  cachedSystemTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  nativeTheme.themeSource = previous;
}

function applyNativeThemeSource(preference: ThemePreference): void {
  if (nativeTheme.themeSource !== preference) {
    nativeTheme.themeSource = preference;
  }
}

function buildThemeState(preference: ThemePreference): ThemeState {
  return createThemeState(preference, cachedSystemTheme);
}

function handleMenuThemePreference(preference: ThemePreference): void {
  setThemePreference(preference);
}

function syncNativeShell(state: ThemeState): void {
  if (lastSyncedResolved !== state.resolved) {
    applyNativeChrome(state.resolved);
    lastSyncedResolved = state.resolved;
  }

  // 不能在菜单点击回调内同步重建菜单：Windows 原生 radio 勾选
  // 在回调返回后才处理，会覆盖刚设置的菜单状态；延迟一拍整体重建。
  setImmediate(() => {
    setApplicationMenu({
      themeState: state,
      onThemePreference: handleMenuThemePreference,
    });
  });
}

function notifyRenderers(state: ThemeState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(THEME_IPC.stateChanged, state);
    }
  }
}

function publishThemeState(state: ThemeState): void {
  lastPublishedState = state;
  syncNativeShell(state);
  notifyRenderers(state);
}

export function getThemeState(): ThemeState {
  return buildThemeState(readThemePreference());
}

export function pushThemeStateToWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  window.webContents.send(THEME_IPC.stateChanged, getThemeState());
}

export function bootstrapThemeFromSettings(): ThemeState {
  probeSystemThemeAtStartup();

  const preference = readThemePreference();
  applyNativeThemeSource(preference);
  refreshCachedSystemTheme();

  const state = buildThemeState(preference);
  lastSyncedResolved = undefined;
  lastPublishedState = undefined;
  syncNativeShell(state);
  lastPublishedState = state;

  return state;
}

export function setThemePreference(preference: ThemePreference): ThemeState {
  writeThemePreference(preference);
  applyNativeThemeSource(preference);
  refreshCachedSystemTheme();

  const state = buildThemeState(preference);
  publishThemeState(state);
  return state;
}

export function initThemeBridge(): void {
  bootstrapThemeFromSettings();

  nativeTheme.on("updated", () => {
    refreshCachedSystemTheme();
    const state = buildThemeState(readThemePreference());
    if (!lastPublishedState || !isSameThemeState(lastPublishedState, state)) {
      publishThemeState(state);
    }
  });

  ipcMain.removeHandler(THEME_IPC.getState);
  ipcMain.removeHandler(THEME_IPC.setPreference);
  ipcMain.removeAllListeners(THEME_IPC.getStateSync);

  ipcMain.on(THEME_IPC.getStateSync, (event) => {
    event.returnValue = getThemeState();
  });

  ipcMain.handle(THEME_IPC.getState, () => getThemeState());

  ipcMain.handle(THEME_IPC.setPreference, (_event, preference: unknown) => {
    if (typeof preference !== "string" || !isThemePreference(preference)) {
      throw new Error(`Invalid theme preference: ${String(preference)}`);
    }
    return setThemePreference(preference);
  });
}
