import { useSyncExternalStore } from "react";

export type ElectronAPI = {
  platform: NodeJS.Platform;
  isElectron: true;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
};

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function isElectronRuntime(): boolean {
  return typeof window !== "undefined" && window.electronAPI?.isElectron === true;
}

export function getElectronAPI(): ElectronAPI | null {
  if (!isElectronRuntime() || !window.electronAPI) {
    return null;
  }
  return window.electronAPI;
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
    inDesktop: isElectronRuntime(),
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

export { SSR_SNAPSHOT };
