"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { useElectronRuntime } from "@/lib/electron";
import { DEFAULT_THEME_PREFERENCE } from "@/lib/theme";
import type { ResolvedTheme, ThemePreference } from "@/lib/theme";
import {
  getThemeServerSnapshot,
  getThemeSnapshot,
  setThemePreference,
  subscribeTheme,
} from "@/store";

export type ThemeContextValue = {
  mounted: boolean;
  isDesktop: boolean;
  preference: ThemePreference;
  resolved: ResolvedTheme;
  systemTheme: ResolvedTheme | null;
  setPreference: (preference: ThemePreference) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );
  // 水合安全：首次渲染与 SSR 一致（false），挂载后才反映真实运行环境
  const { inDesktop } = useElectronRuntime();

  const setPreference = useCallback(async (preference: ThemePreference) => {
    await setThemePreference(preference);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mounted: state !== null,
      isDesktop: inDesktop,
      preference: state?.preference ?? DEFAULT_THEME_PREFERENCE,
      resolved: state?.resolved ?? "dark",
      systemTheme: state?.system ?? null,
      setPreference,
    }),
    [inDesktop, setPreference, state],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

/** @deprecated 使用 useTheme */
export const useAppTheme = useTheme;
