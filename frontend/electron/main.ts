import { app, BrowserWindow, shell } from "electron";
import {
  findDeepLinkArg,
  handleDeepLinkUrl,
  initAuthBridge,
  registerDeepLinkProtocol,
} from "./auth";
import {
  getProductionLoadUrl,
  installAppProtocolHandler,
  registerAppScheme,
} from "./app-protocol";
import { getInitialBackgroundColor } from "./native-chrome";
import { DEV_SERVER_URL, getPreloadPath } from "./paths";
import { getThemeState, initThemeBridge, pushThemeStateToWindow } from "./theme";
import { initLocaleBridge, pushLocaleStateToWindow } from "./locale";

registerAppScheme();

/** 开发联调：未打包且非 production 时连接 Next dev server */
const isDev = !app.isPackaged && process.env.NODE_ENV !== "production";
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLinkUrl = findDeepLinkArg(argv);
    if (deepLinkUrl) {
      handleDeepLinkUrl(deepLinkUrl);
    }
  });
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLinkUrl(url);
});

function createWindow(): void {
  const { resolved } = getThemeState();

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: getInitialBackgroundColor(resolved),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: "Cloud Travel Guide",
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    pushThemeStateToWindow(mainWindow);
    pushLocaleStateToWindow(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (isDev) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    if (process.env.ELECTRON_DEVTOOLS === "1") {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    void mainWindow.loadURL(getProductionLoadUrl());
  }
}

if (gotSingleInstanceLock) {
  void app.whenReady().then(() => {
    registerDeepLinkProtocol();
    initAuthBridge();
    initThemeBridge();
    initLocaleBridge();
    if (!isDev) {
      installAppProtocolHandler();
    }
    createWindow();
  });
}

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
