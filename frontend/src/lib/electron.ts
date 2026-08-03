import { useSyncExternalStore } from "react";

import type {
  DesktopOAuthProvider,
  ElectronAuthAPI,
  ElectronLocaleAPI,
  ElectronThemeAPI,
} from "../../electron/preload";
import type { AppLocale, LocaleState } from "@/lib/locale";
import type { ThemePreference, ThemeState } from "@/lib/theme";

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

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export type { DesktopOAuthProvider };

export function isElectronRuntime(): boolean {
  return typeof window !== "undefined" && window.electronAPI?.isElectron === true;
}

/**
 * True only inside our packaged/dev Electron shell (preload bridge present).
 * Do NOT use navigator.userAgent — Cursor / VS Code also contain "Electron" and
 * would incorrectly force desktop OAuth (system browser + custom protocol).
 */
export function isDesktopClient(): boolean {
  if (typeof window === "undefined") return false;
  if (window.electronAPI?.clientKind === "desktop") return true;
  return window.electronAPI?.isElectron === true;
}

export function getElectronAPI(): ElectronAPI | null {
  if (typeof window === "undefined") return null;
  return window.electronAPI ?? null;
}

export function getElectronThemeAPI(): ElectronThemeAPI | null {
  return getElectronAPI()?.theme ?? null;
}

export function getElectronLocaleAPI(): ElectronLocaleAPI | null {
  return getElectronAPI()?.locale ?? null;
}

export type ElectronRuntimeSnapshot = {
  /** False during SSR and the first client render (matches server HTML). */
  mounted: boolean;
  inDesktop: boolean;
  api: ElectronAPI | null;
};

const SSR_SNAPSHOT: ElectronRuntimeSnapshot = {
  mounted: false,
  inDesktop: false,
  api: null,
};

/** Client-only runtime detection; safe for React hydration. */
export function getElectronRuntimeSnapshot(): ElectronRuntimeSnapshot {
  return {
    mounted: true,
    inDesktop: isDesktopClient(),
    api: getElectronAPI(),
  };
}

let cachedClientSnapshot: ElectronRuntimeSnapshot = SSR_SNAPSHOT;

function getClientSnapshot(): ElectronRuntimeSnapshot {
  if (typeof window === "undefined") {
    return SSR_SNAPSHOT;
  }
  const next = getElectronRuntimeSnapshot();
  if (
    cachedClientSnapshot.mounted === next.mounted &&
    cachedClientSnapshot.inDesktop === next.inDesktop &&
    cachedClientSnapshot.api === next.api
  ) {
    return cachedClientSnapshot;
  }
  cachedClientSnapshot = next;
  return cachedClientSnapshot;
}

function subscribeElectronRuntime(): () => void {
  return () => {};
}

/** Hydration-safe Electron runtime; avoids setState in useEffect. */
export function useElectronRuntime(): ElectronRuntimeSnapshot {
  return useSyncExternalStore(
    subscribeElectronRuntime,
    getClientSnapshot,
    () => SSR_SNAPSHOT,
  );
}

export type { ThemePreference, ThemeState };

export { SSR_SNAPSHOT };
