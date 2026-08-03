import { app, BrowserWindow, shell } from "electron";
import { APP_ID, APP_NAME } from "@/config/app";
import {
  findDeepLinkArg,
  focusMainWindow,
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
import { attachOAuthExternalNavigation, registerOAuthNavigationGuard } from "./oauth-navigation";
import { DEV_SERVER_URL, getPreloadPath } from "./paths";
import { getThemeState, initThemeBridge, pushThemeStateToWindow } from "./theme";
import { initLocaleBridge, pushLocaleStateToWindow } from "./locale";

registerAppScheme();

if (process.platform === "win32") {
  app.setAppUserModelId(APP_ID);
}
app.setName(APP_NAME);

/** 开发联调：未打包且非 production 时连接 Next dev server */
const isDev = !app.isPackaged && process.env.NODE_ENV !== "production";
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    console.log("[auth] second-instance argv:", argv);
    const deepLinkUrl = findDeepLinkArg(argv);
    if (deepLinkUrl) {
      handleDeepLinkUrl(deepLinkUrl);
    } else {
      focusMainWindow();
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
    title: APP_NAME,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.on("did-finish-load", () => {
    pushThemeStateToWindow(mainWindow);
    pushLocaleStateToWindow(mainWindow);
  });

  // preload 加载失败会让 window.electronAPI 整体缺失（主题 / 语言 / OAuth 静默降级
  // 成浏览器模式），Electron 默认不会中断启动，必须显式报出来。
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[electron] preload failed: ${preloadPath}`, error);
  });

  attachOAuthExternalNavigation(mainWindow.webContents);

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
    registerOAuthNavigationGuard();
    initAuthBridge();
    initThemeBridge();
    initLocaleBridge();
    if (!isDev) {
      installAppProtocolHandler();
    }
    createWindow();
    const coldStartDeepLink = findDeepLinkArg(process.argv);
    if (coldStartDeepLink) {
      handleDeepLinkUrl(coldStartDeepLink);
    }
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
