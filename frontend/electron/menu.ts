import { Menu, app, type MenuItemConstructorOptions } from "electron";

import type { ThemePreference, ThemeState } from "../src/lib/theme";

const THEME_MENU_LABELS = {
  light: "Light",
  dark: "Dark",
  system: "System",
} as const;

type MenuOptions = {
  themeState: ThemeState;
  onThemePreference: (preference: ThemePreference) => void;
};

function buildAppearanceSubmenu({
  themeState,
  onThemePreference,
}: MenuOptions): MenuItemConstructorOptions[] {
  const { preference } = themeState;

  return [
    {
      label: THEME_MENU_LABELS.light,
      type: "radio",
      checked: preference === "light",
      click: () => onThemePreference("light"),
    },
    {
      label: THEME_MENU_LABELS.dark,
      type: "radio",
      checked: preference === "dark",
      click: () => onThemePreference("dark"),
    },
    {
      label: THEME_MENU_LABELS.system,
      type: "radio",
      checked: preference === "system",
      click: () => onThemePreference("system"),
    },
  ];
}

function buildFileMenu(options: MenuOptions): MenuItemConstructorOptions {
  const isMac = process.platform === "darwin";

  return {
    label: "File",
    submenu: [
      {
        label: "Appearance",
        submenu: buildAppearanceSubmenu(options),
      },
      { type: "separator" },
      ...(isMac
        ? [{ label: "Close Window", role: "close" as const }]
        : [{ label: "Exit", role: "quit" as const }]),
    ],
  };
}

function buildViewMenu(): MenuItemConstructorOptions {
  const showDevTools =
    !app.isPackaged && process.env.NODE_ENV !== "production";

  return {
    label: "View",
    submenu: [
      { label: "Reload", role: "reload" },
      { label: "Force Reload", role: "forceReload" },
      ...(showDevTools
        ? [{ label: "Toggle Developer Tools", role: "toggleDevTools" as const }]
        : []),
      { type: "separator" },
      { label: "Actual Size", role: "resetZoom" },
      { label: "Zoom In", role: "zoomIn" },
      { label: "Zoom Out", role: "zoomOut" },
      { type: "separator" },
      { label: "Toggle Full Screen", role: "togglefullscreen" },
    ],
  };
}

function buildEditMenu(): MenuItemConstructorOptions {
  const isMac = process.platform === "darwin";

  return {
    label: "Edit",
    submenu: [
      { label: "Undo", role: "undo" },
      { label: "Redo", role: "redo" },
      { type: "separator" },
      { label: "Cut", role: "cut" },
      { label: "Copy", role: "copy" },
      { label: "Paste", role: "paste" },
      ...(isMac
        ? [
            { label: "Paste and Match Style", role: "pasteAndMatchStyle" as const },
            { label: "Delete", role: "delete" as const },
            { label: "Select All", role: "selectAll" as const },
          ]
        : [
            { label: "Delete", role: "delete" as const },
            { type: "separator" as const },
            { label: "Select All", role: "selectAll" as const },
          ]),
    ],
  };
}

function buildWindowMenu(): MenuItemConstructorOptions {
  const isMac = process.platform === "darwin";

  return {
    label: "Window",
    submenu: isMac
      ? [
          { label: "Minimize", role: "minimize" },
          { label: "Zoom", role: "zoom" },
          { type: "separator" },
          { label: "Bring All to Front", role: "front" },
        ]
      : [{ label: "Close", role: "close" }],
  };
}

export function getApplicationMenuTemplate(
  options: MenuOptions,
): MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";

  return [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    buildFileMenu(options),
    buildEditMenu(),
    buildViewMenu(),
    buildWindowMenu(),
  ];
}

export function setApplicationMenu(options: MenuOptions): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(getApplicationMenuTemplate(options)),
  );
}
