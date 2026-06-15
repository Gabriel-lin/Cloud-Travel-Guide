import * as fs from "node:fs";
import * as path from "node:path";

import { app } from "electron";

import {
  DEFAULT_SETTINGS,
  mergeAppSettings,
  parseAppSettings,
  type AppSettings,
} from "../src/lib/settings";

export function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function readAppSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(getSettingsPath(), "utf8"));
    return parseAppSettings(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeAppSettings(settings: AppSettings): void {
  const filePath = getSettingsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function patchAppSettings(patch: Partial<AppSettings>): AppSettings {
  const next = mergeAppSettings(readAppSettings(), patch);
  writeAppSettings(next);
  return next;
}
