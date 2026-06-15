import type { ResolvedTheme, ThemePreference, ThemeState } from "./theme";

export function resolveThemePreference(
  preference: ThemePreference,
  system: ResolvedTheme,
): ResolvedTheme {
  if (preference === "system") {
    return system;
  }
  return preference;
}

export function createThemeState(
  preference: ThemePreference,
  system: ResolvedTheme,
): ThemeState {
  return {
    preference,
    system,
    resolved: resolveThemePreference(preference, system),
  };
}
