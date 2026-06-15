import { contextBridge, ipcRenderer } from "electron";

import {
  DEFAULT_APP_LOCALE,
  LOCALE_IPC,
  type AppLocale,
  type LocaleState,
} from "../src/lib/locale";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_IPC,
  type ThemePreference,
  type ThemeState,
} from "../src/lib/theme";

export type ElectronThemeAPI = {
  /** 启动时从 settings.json 同步读取的初始主题 */
  initialState: ThemeState;
  getState: () => Promise<ThemeState>;
  setPreference: (preference: ThemePreference) => Promise<ThemeState>;
  onStateChanged: (listener: (state: ThemeState) => void) => () => void;
};

export type ElectronLocaleAPI = {
  initialState: LocaleState;
  getState: () => Promise<LocaleState>;
  setLocale: (locale: AppLocale) => Promise<LocaleState>;
  onStateChanged: (listener: (state: LocaleState) => void) => () => void;
};

export type ElectronAPI = {
  platform: NodeJS.Platform;
  isElectron: true;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  theme: ElectronThemeAPI;
  locale: ElectronLocaleAPI;
};

const themeListeners = new Set<(state: ThemeState) => void>();
const localeListeners = new Set<(state: LocaleState) => void>();

ipcRenderer.on(THEME_IPC.stateChanged, (_event, state: ThemeState) => {
  for (const listener of themeListeners) {
    listener(state);
  }
});

ipcRenderer.on(LOCALE_IPC.stateChanged, (_event, state: LocaleState) => {
  for (const listener of localeListeners) {
    listener(state);
  }
});

function readInitialThemeState(): ThemeState {
  try {
    return ipcRenderer.sendSync(THEME_IPC.getStateSync) as ThemeState;
  } catch {
    return {
      preference: DEFAULT_THEME_PREFERENCE,
      resolved: "dark",
      system: "dark",
    };
  }
}

function readInitialLocaleState(): LocaleState {
  try {
    return ipcRenderer.sendSync(LOCALE_IPC.getStateSync) as LocaleState;
  } catch {
    return { locale: DEFAULT_APP_LOCALE };
  }
}

const initialThemeState = readInitialThemeState();
const initialLocaleState = readInitialLocaleState();

const electronThemeAPI: ElectronThemeAPI = {
  initialState: initialThemeState,
  getState: () => ipcRenderer.invoke(THEME_IPC.getState),
  setPreference: (preference) =>
    ipcRenderer.invoke(THEME_IPC.setPreference, preference),
  onStateChanged: (listener) => {
    themeListeners.add(listener);
    return () => {
      themeListeners.delete(listener);
    };
  },
};

const electronLocaleAPI: ElectronLocaleAPI = {
  initialState: initialLocaleState,
  getState: () => ipcRenderer.invoke(LOCALE_IPC.getState),
  setLocale: (locale) => ipcRenderer.invoke(LOCALE_IPC.setLocale, locale),
  onStateChanged: (listener) => {
    localeListeners.add(listener);
    return () => {
      localeListeners.delete(listener);
    };
  },
};

const electronAPI: ElectronAPI = {
  platform: process.platform,
  isElectron: true,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  theme: electronThemeAPI,
  locale: electronLocaleAPI,
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
