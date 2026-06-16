import { useInitSettings } from "@/hooks/use-init-settings";
import { useElectronRuntime } from "@/lib/electron";
import {
  DEFAULT_THEME_PREFERENCE,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";
import { selectResolvedTheme, useSettingsStore } from "@/store";

export type UseAppThemeResult = {
  mounted: boolean;
  isDesktop: boolean;
  preference: ThemePreference;
  resolved: ResolvedTheme;
  systemTheme: ResolvedTheme | null;
  setPreference: (preference: ThemePreference) => Promise<void>;
};

export function useTheme(): UseAppThemeResult {
  useInitSettings();
  const { inDesktop } = useElectronRuntime();
  const ready = useSettingsStore((s) => s.ready);
  const preference = useSettingsStore((s) => s.settings.theme);
  const resolved = useSettingsStore(selectResolvedTheme);
  const systemTheme = useSettingsStore((s) => s.systemTheme);
  const setPreference = useSettingsStore((s) => s.setThemePreference);

  return {
    mounted: ready,
    isDesktop: inDesktop,
    preference: ready ? preference : DEFAULT_THEME_PREFERENCE,
    resolved: ready ? resolved : "dark",
    systemTheme: ready ? systemTheme : null,
    setPreference,
  };
}

/** @deprecated 使用 useTheme */
export const useAppTheme = useTheme;
