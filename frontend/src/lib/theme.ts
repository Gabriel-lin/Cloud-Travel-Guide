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
  /**
   * 同步通道：preload 必须在 document-start 就拿到真实主题，异步 invoke 解析得太晚，
   * 首屏内联脚本只能读到占位值并按暗色渲染。
   */
  getStateSync: "theme:getState-sync",
  setPreference: "theme:setPreference",
  stateChanged: "theme:state-changed",
} as const;

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "dark";

/** 与 globals.css `--ctg-surface-950` / `body.bg-surface-950` 对齐 */
export const NATIVE_CHROME_COLORS: Record<ResolvedTheme, string> = {
  light: "#dfece5",
  dark: "#030a06",
};
