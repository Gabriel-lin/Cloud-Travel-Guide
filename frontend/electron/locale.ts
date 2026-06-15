import { BrowserWindow, ipcMain } from "electron";

import { patchAppSettings, readAppSettings } from "./settings-io";
import {
  isAppLocale,
  LOCALE_IPC,
  type AppLocale,
  type LocaleState,
} from "../src/lib/locale";

let lastPublishedState: LocaleState | undefined;

function buildLocaleState(): LocaleState {
  return { locale: readAppSettings().locale };
}

function notifyRenderers(state: LocaleState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(LOCALE_IPC.stateChanged, state);
    }
  }
}

function publishLocaleState(state: LocaleState): void {
  lastPublishedState = state;
  notifyRenderers(state);
}

export function getLocaleState(): LocaleState {
  return buildLocaleState();
}

export function pushLocaleStateToWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  window.webContents.send(LOCALE_IPC.stateChanged, getLocaleState());
}

export function bootstrapLocaleFromSettings(): LocaleState {
  const state = buildLocaleState();
  lastPublishedState = state;
  return state;
}

export function setAppLocale(locale: AppLocale): LocaleState {
  patchAppSettings({ locale });
  const state = buildLocaleState();
  publishLocaleState(state);
  return state;
}

export function initLocaleBridge(): void {
  bootstrapLocaleFromSettings();

  ipcMain.removeHandler(LOCALE_IPC.getState);
  ipcMain.removeHandler(LOCALE_IPC.setLocale);
  ipcMain.removeAllListeners(LOCALE_IPC.getStateSync);

  ipcMain.on(LOCALE_IPC.getStateSync, (event) => {
    event.returnValue = getLocaleState();
  });

  ipcMain.handle(LOCALE_IPC.getState, () => getLocaleState());

  ipcMain.handle(LOCALE_IPC.setLocale, (_event, locale: unknown) => {
    if (typeof locale !== "string" || !isAppLocale(locale)) {
      throw new Error(`Invalid locale: ${String(locale)}`);
    }
    return setAppLocale(locale);
  });
}

export function readLocalePreference(): AppLocale {
  return readAppSettings().locale;
}
