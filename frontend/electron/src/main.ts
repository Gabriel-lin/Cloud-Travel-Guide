import { app, BrowserWindow } from "electron";
import { DEV_SERVER_URL, getProductionRendererIndexPath } from "./paths";

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "Cloud Travel Guide",
  });

  const isDev = process.env.NODE_ENV === "development";

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  void mainWindow.loadURL(
    isDev
      ? DEV_SERVER_URL
      : `file://${getProductionRendererIndexPath()}`,
  );

  if (isDev && process.env.ELECTRON_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
