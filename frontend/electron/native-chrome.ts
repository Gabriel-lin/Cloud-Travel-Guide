import { BrowserWindow } from "electron";

import {
  NATIVE_CHROME_COLORS,
  type ResolvedTheme,
} from "../src/lib/theme";

export function applyNativeChrome(resolved: ResolvedTheme): void {
  const backgroundColor = NATIVE_CHROME_COLORS[resolved];

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.setBackgroundColor(backgroundColor);
  }
}

export function getInitialBackgroundColor(resolved: ResolvedTheme): string {
  return NATIVE_CHROME_COLORS[resolved];
}
