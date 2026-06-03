import { Menu, type MenuItemConstructorOptions } from "electron";

export function getApplicationMenuTemplate(): MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";
  return [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
}

export function setDefaultApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(getApplicationMenuTemplate()));
}
