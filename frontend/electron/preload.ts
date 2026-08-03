import { contextBridge, ipcRenderer } from "electron";

import { AUTH_IPC, type SessionEstablishedPayload } from "./auth-ipc";
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

export type DesktopOAuthProvider = "github" | "google";

export type ElectronThemeAPI = {
  /**
   * Current state, read synchronously. Valid from document-start (pre-hydration
   * inline script) and kept current by the main process broadcast, so a listener
   * registered late can never miss an update.
   */
  readState: () => ThemeState;
  setPreference: (preference: ThemePreference) => Promise<ThemeState>;
  onStateChanged: (listener: (state: ThemeState) => void) => () => void;
};

export type ElectronLocaleAPI = {
  readState: () => LocaleState;
  setLocale: (locale: AppLocale) => Promise<LocaleState>;
  onStateChanged: (listener: (state: LocaleState) => void) => () => void;
};

export type { SessionEstablishedPayload };

export type ElectronAuthAPI = {
  /** Main process builds URL + opens system browser (production desktop OAuth). */
  startOAuth: (provider: DesktopOAuthProvider) => Promise<void>;
  openOAuthUrl: (url: string) => Promise<void>;
  /** In-memory token — no IPC; safe for hot paths (axios interceptors). */
  readCachedAccessToken: () => string | null;
  /** Re-read encrypted token from disk via main process. */
  getAccessToken: () => Promise<string | null>;
  setAccessToken: (token: string) => Promise<void>;
  clearAccessToken: () => Promise<void>;
  consumePendingOAuthCallback: () => Promise<string | null>;
  consumeSessionEstablished: () => Promise<SessionEstablishedPayload | null>;
  notifyAuthReady: () => Promise<void>;
  onOAuthCallback: (listener: (url: string) => void) => () => void;
  /** Main process finished OAuth exchange and persisted the token. */
  onSessionEstablished: (
    listener: (payload: SessionEstablishedPayload) => void,
  ) => () => void;
};

export type ElectronAPI = {
  platform: NodeJS.Platform;
  isElectron: true;
  clientKind: "desktop";
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
  theme: ElectronThemeAPI;
  locale: ElectronLocaleAPI;
  auth: ElectronAuthAPI;
};

const themeListeners = new Set<(state: ThemeState) => void>();
const localeListeners = new Set<(state: LocaleState) => void>();
const oauthCallbackListeners = new Set<(url: string) => void>();
const sessionEstablishedListeners = new Set<
  (payload: SessionEstablishedPayload) => void
>();

let themeState: ThemeState = readStateSync(
  THEME_IPC.getStateSync,
  fallbackThemeState(),
);
let localeState: LocaleState = readStateSync(
  LOCALE_IPC.getStateSync,
  fallbackLocaleState(),
);
let cachedAccessToken: string | null = null;

ipcRenderer.on(THEME_IPC.stateChanged, (_event, state: ThemeState) => {
  themeState = state;
  for (const listener of themeListeners) {
    listener(state);
  }
});

ipcRenderer.on(LOCALE_IPC.stateChanged, (_event, state: LocaleState) => {
  localeState = state;
  for (const listener of localeListeners) {
    listener(state);
  }
});

ipcRenderer.on(AUTH_IPC.oauthCallback, (_event, url: string) => {
  for (const listener of oauthCallbackListeners) {
    listener(url);
  }
});

ipcRenderer.on(
  AUTH_IPC.sessionEstablished,
  (_event, payload: SessionEstablishedPayload) => {
    cachedAccessToken = payload.accessToken;
    for (const listener of sessionEstablishedListeners) {
      listener(payload);
    }
  },
);

function fallbackThemeState(): ThemeState {
  return {
    preference: DEFAULT_THEME_PREFERENCE,
    resolved: "dark",
    system: "dark",
  };
}

function fallbackLocaleState(): LocaleState {
  return { locale: DEFAULT_APP_LOCALE };
}

/**
 * Blocking read at document-start. The pre-hydration inline script paints the
 * theme before React runs, so an async round-trip would resolve too late and
 * flash the default theme.
 */
function readStateSync<T>(channel: string, fallback: T): T {
  try {
    return (ipcRenderer.sendSync(channel) as T | undefined) ?? fallback;
  } catch {
    return fallback;
  }
}

async function invokeAccessToken(): Promise<string | null> {
  try {
    return (await ipcRenderer.invoke(AUTH_IPC.getAccessToken)) as string | null;
  } catch {
    return null;
  }
}

const electronThemeAPI: ElectronThemeAPI = {
  readState: () => themeState,
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
  readState: () => localeState,
  setLocale: (locale) => ipcRenderer.invoke(LOCALE_IPC.setLocale, locale),
  onStateChanged: (listener) => {
    localeListeners.add(listener);
    return () => {
      localeListeners.delete(listener);
    };
  },
};

const electronAuthAPI: ElectronAuthAPI = {
  startOAuth: (provider) => ipcRenderer.invoke(AUTH_IPC.startOAuth, provider),
  openOAuthUrl: (url) => ipcRenderer.invoke(AUTH_IPC.openOAuthUrl, url),
  readCachedAccessToken: () => cachedAccessToken,
  getAccessToken: async () => {
    cachedAccessToken = await invokeAccessToken();
    return cachedAccessToken;
  },
  setAccessToken: async (token) => {
    cachedAccessToken = token;
    await ipcRenderer.invoke(AUTH_IPC.setAccessToken, token);
  },
  clearAccessToken: async () => {
    cachedAccessToken = null;
    await ipcRenderer.invoke(AUTH_IPC.clearAccessToken);
  },
  consumePendingOAuthCallback: () =>
    ipcRenderer.invoke(AUTH_IPC.consumePendingOAuthCallback) as Promise<
      string | null
    >,
  consumeSessionEstablished: () =>
    ipcRenderer.invoke(AUTH_IPC.consumeSessionEstablished) as Promise<
      SessionEstablishedPayload | null
    >,
  notifyAuthReady: () => ipcRenderer.invoke(AUTH_IPC.notifyAuthReady),
  onOAuthCallback: (listener) => {
    oauthCallbackListeners.add(listener);
    return () => {
      oauthCallbackListeners.delete(listener);
    };
  },
  onSessionEstablished: (listener) => {
    sessionEstablishedListeners.add(listener);
    return () => {
      sessionEstablishedListeners.delete(listener);
    };
  },
};

const electronAPI: ElectronAPI = {
  platform: process.platform,
  isElectron: true,
  clientKind: "desktop",
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  theme: electronThemeAPI,
  locale: electronLocaleAPI,
  auth: electronAuthAPI,
};

// Expose synchronously — never block on top-level await, which would land the
// bridge after the page's own scripts have already run.
contextBridge.exposeInMainWorld("electronAPI", electronAPI);

// Token lives behind safeStorage; unlike theme/locale it is not needed for the
// first paint, so it stays async.
void invokeAccessToken().then((accessToken) => {
  cachedAccessToken = accessToken;
});
