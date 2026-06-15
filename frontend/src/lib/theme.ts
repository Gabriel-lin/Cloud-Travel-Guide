export type ThemePreference = "light" | "dark" | "system";

export type ResolvedTheme = "light" | "dark";

export type ThemeState = {
  /** 用户选择：亮色 / 暗夜 / 跟随系统 */
  preference: ThemePreference;
  /** 当前实际生效的主题 */
  resolved: ResolvedTheme;
  /** 操作系统当前外观（不受应用强制覆盖时读取） */
  system: ResolvedTheme;
};

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "light",
  "dark",
  "system",
];

export function isThemePreference(value: string): value is ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value);
}

export const THEME_IPC = {
  getState: "theme:getState",
  getStateSync: "theme:getStateSync",
  setPreference: "theme:setPreference",
  stateChanged: "theme:state-changed",
} as const;

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

/** 与 globals.css `--ctg-surface-950` / `body.bg-surface-950` 对齐 */
export const NATIVE_CHROME_COLORS: Record<ResolvedTheme, string> = {
  light: "#f0f7f3",
  dark: "#030a06",
};
