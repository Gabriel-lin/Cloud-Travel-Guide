import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { app, BrowserWindow, ipcMain, safeStorage } from "electron";

import { APP_NAME, APP_PROTOCOL } from "@/config/app";
import { AUTH_IPC, type SessionEstablishedPayload } from "./auth-ipc";
import {
  launchDesktopOAuth,
  openValidatedOAuthUrl,
  parseOAuthProviderArg,
} from "./desktop-oauth";
import {
  exchangeDesktopLoginCode,
  injectDesktopSession,
  navigateRendererToProfile,
  normalizeOAuthCallbackUrl,
  parseOAuthCallbackUrl,
} from "./oauth-callback-handler";

type TokenFile = {
  encoding: "encrypted" | "plain";
  value: string;
};

function getAuthTokenPath(): string {
  return path.join(app.getPath("userData"), "auth-token.json");
}

function encryptToken(token: string): TokenFile {
  if (!safeStorage.isEncryptionAvailable()) {
    return { encoding: "plain", value: token };
  }
  return {
    encoding: "encrypted",
    value: safeStorage.encryptString(token).toString("base64"),
  };
}

function decryptToken(file: TokenFile): string | null {
  if (file.encoding === "plain") return file.value;
  if (!safeStorage.isEncryptionAvailable()) return null;
  return safeStorage.decryptString(Buffer.from(file.value, "base64"));
}

function readAccessToken(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(getAuthTokenPath(), "utf8")) as TokenFile;
    return decryptToken(raw);
  } catch {
    return null;
  }
}

function writeAccessToken(token: string): void {
  const filePath = getAuthTokenPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(encryptToken(token), null, 2)}\n`, "utf8");
}

function clearAccessToken(): void {
  try {
    fs.rmSync(getAuthTokenPath(), { force: true });
  } catch {
    // Best effort cleanup.
  }
}

function runReg(args: string[]): void {
  execFileSync("reg", args, { windowsHide: true, stdio: "ignore" });
}

function writeWindowsProtocolMetadata(): void {
  if (process.platform !== "win32") return;

  const protocolKey = `HKCU\\Software\\Classes\\${APP_PROTOCOL}`;
  const exeBasename = path.basename(process.execPath);
  const applicationsKey = `HKCU\\Software\\Classes\\Applications\\${exeBasename}`;
  const muiCacheKey =
    "HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache";
  const muiCacheValue = `${process.execPath}.FriendlyAppName`;

  try {
    runReg(["add", applicationsKey, "/v", "FriendlyAppName", "/d", APP_NAME, "/f"]);
    runReg(["add", protocolKey, "/ve", "/d", `URL:${APP_NAME}`, "/f"]);
    runReg(["add", protocolKey, "/v", "FriendlyTypeName", "/d", APP_NAME, "/f"]);
    runReg(["add", protocolKey, "/v", "ApplicationName", "/d", APP_NAME, "/f"]);
    runReg(["add", `${protocolKey}\\shell\\open`, "/ve", "/d", `Open ${APP_NAME}`, "/f"]);
    try {
      runReg(["delete", muiCacheKey, "/v", muiCacheValue, "/f"]);
    } catch {
      // Windows may not have cached a friendly name yet.
    }
  } catch {
    // Protocol metadata is cosmetic; OAuth still works if this fails.
  }
}

export function registerDeepLinkProtocol(): void {
  app.setName(APP_NAME);

  // Dev (electron .): register electron.exe + absolute app path so Windows
  // second-instance receives the deep link in argv.
  if (process.defaultApp) {
    const appPath = path.resolve(process.argv[1] ?? process.cwd());
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [appPath]);
  } else if (!app.isPackaged) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [
      path.resolve(process.cwd()),
    ]);
  } else {
    app.setAsDefaultProtocolClient(APP_PROTOCOL);
  }
  writeWindowsProtocolMetadata();
}

let pendingOAuthCallbackUrl: string | null = null;
let lastSessionEstablished: SessionEstablishedPayload | null = null;
let exchangeInFlight: Promise<boolean> | null = null;

export function focusMainWindow(): void {
  const windows = BrowserWindow.getAllWindows();
  if (windows.length === 0) return;
  const win = windows[0];
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function broadcastSessionEstablished(payload: SessionEstablishedPayload): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(AUTH_IPC.sessionEstablished, payload);
    }
  }
}

function broadcastOAuthError(url: string): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(AUTH_IPC.oauthCallback, url);
    }
  }
}

export function consumePendingOAuthCallback(): string | null {
  // Main process owns the one-time code exchange — never hand the raw URL
  // back to the renderer (avoids double-exchange races).
  return null;
}

export function consumeSessionEstablished(): SessionEstablishedPayload | null {
  return lastSessionEstablished;
}

async function completeDesktopOAuthInMain(url: string): Promise<boolean> {
  if (exchangeInFlight) {
    return exchangeInFlight;
  }

  exchangeInFlight = (async () => {
    const { code, error, accessToken, tokenType, expiresIn } =
      parseOAuthCallbackUrl(url);

    if (error) {
      console.error("[auth] OAuth provider returned error:", error);
      broadcastOAuthError(url);
      return false;
    }

    try {
      let token: {
        access_token: string;
        token_type: string;
        expires_in?: number;
      };

      if (accessToken) {
        token = {
          access_token: accessToken,
          token_type: tokenType ?? "bearer",
          ...(expiresIn != null ? { expires_in: expiresIn } : {}),
        };
      } else if (code) {
        token = await exchangeDesktopLoginCode(code);
      } else {
        console.error("[auth] OAuth callback missing code/token:", url);
        broadcastOAuthError(url);
        return false;
      }

      writeAccessToken(token.access_token);
      pendingOAuthCallbackUrl = null;

      const payload: SessionEstablishedPayload = {
        accessToken: token.access_token,
        tokenType: token.token_type ?? "bearer",
        expiresIn: token.expires_in,
      };
      lastSessionEstablished = payload;

      console.log("[auth] desktop OAuth exchange succeeded");
      broadcastSessionEstablished(payload);
      await injectDesktopSession(payload);
      await navigateRendererToProfile();
      return true;
    } catch (error) {
      console.error("[auth] main-process OAuth exchange failed:", error);
      // Only surface the error URL if we never established a session.
      if (!lastSessionEstablished) {
        broadcastOAuthError(url);
      }
      return false;
    } finally {
      exchangeInFlight = null;
    }
  })();

  return exchangeInFlight;
}

export function handleDeepLinkUrl(url: string): void {
  const normalized = normalizeOAuthCallbackUrl(url);
  if (!normalized) {
    console.warn("[auth] ignored non-OAuth deep link:", url);
    return;
  }

  console.log("[auth] OAuth deep link received");
  pendingOAuthCallbackUrl = normalized;
  focusMainWindow();
  void completeDesktopOAuthInMain(normalized);
}

export function findDeepLinkArg(argv: string[]): string | null {
  for (const arg of argv) {
    const cleaned = arg.trim().replace(/^"+|"+$/g, "");
    const normalized = normalizeOAuthCallbackUrl(cleaned);
    if (normalized) return normalized;
  }
  return null;
}

export function initAuthBridge(): void {
  ipcMain.handle(AUTH_IPC.startOAuth, async (_event, provider: string) => {
    try {
      await launchDesktopOAuth(parseOAuthProviderArg(provider));
    } catch (error) {
      console.error("[auth] startOAuth failed:", error);
      throw error;
    }
  });

  ipcMain.handle(AUTH_IPC.openOAuthUrl, async (_event, url: string) => {
    try {
      await openValidatedOAuthUrl(url);
    } catch (error) {
      console.error("[auth] openOAuthUrl failed:", url, error);
      throw error;
    }
  });

  ipcMain.handle(AUTH_IPC.consumePendingOAuthCallback, () =>
    consumePendingOAuthCallback(),
  );

  ipcMain.handle(AUTH_IPC.consumeSessionEstablished, () =>
    consumeSessionEstablished(),
  );

  ipcMain.handle(AUTH_IPC.notifyAuthReady, () => {
    if (lastSessionEstablished) {
      broadcastSessionEstablished(lastSessionEstablished);
      void injectDesktopSession(lastSessionEstablished);
      return;
    }
    if (pendingOAuthCallbackUrl) {
      void completeDesktopOAuthInMain(pendingOAuthCallbackUrl);
    }
  });

  ipcMain.handle(AUTH_IPC.getAccessToken, () => readAccessToken());

  ipcMain.handle(AUTH_IPC.setAccessToken, (_event, token: string) => {
    writeAccessToken(token);
  });

  ipcMain.handle(AUTH_IPC.clearAccessToken, () => {
    clearAccessToken();
  });
}
