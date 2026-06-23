import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";

import { AUTH_IPC, DESKTOP_OAUTH_REDIRECT_URI } from "./auth-ipc";

const APP_PROTOCOL = "cloud-travel-guide";
const APP_NAME = "Cloud Travel Guide";

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

function isOAuthCallbackUrl(value: string): boolean {
  return value.startsWith(DESKTOP_OAUTH_REDIRECT_URI);
}

function writeWindowsProtocolMetadata(): void {
  if (process.platform !== "win32") return;

  const protocolKey = `HKCU\\Software\\Classes\\${APP_PROTOCOL}`;
  try {
    execFileSync("reg", ["add", protocolKey, "/ve", "/d", `URL:${APP_NAME}`, "/f"], {
      windowsHide: true,
    });
    execFileSync("reg", ["add", protocolKey, "/v", "FriendlyTypeName", "/d", APP_NAME, "/f"], {
      windowsHide: true,
    });
    execFileSync("reg", ["add", protocolKey, "/v", "ApplicationName", "/d", APP_NAME, "/f"], {
      windowsHide: true,
    });
    execFileSync(
      "reg",
      ["add", `${protocolKey}\\shell\\open`, "/ve", "/d", `Open ${APP_NAME}`, "/f"],
      { windowsHide: true },
    );
  } catch {
    // Protocol metadata is cosmetic; OAuth still works if this fails.
  }
}

export function registerDeepLinkProtocol(): void {
  app.setName(APP_NAME);

  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
    writeWindowsProtocolMetadata();
    return;
  }
  app.setAsDefaultProtocolClient(APP_PROTOCOL);
  writeWindowsProtocolMetadata();
}

export function handleDeepLinkUrl(url: string): void {
  if (!isOAuthCallbackUrl(url)) return;
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(AUTH_IPC.oauthCallback, url);
  }
}

export function findDeepLinkArg(argv: string[]): string | null {
  return argv.find(isOAuthCallbackUrl) ?? null;
}

export function initAuthBridge(): void {
  ipcMain.handle(AUTH_IPC.openOAuthUrl, async (_event, url: string) => {
    await shell.openExternal(url);
  });

  ipcMain.on(AUTH_IPC.getAccessTokenSync, (event) => {
    event.returnValue = readAccessToken();
  });

  ipcMain.handle(AUTH_IPC.setAccessToken, (_event, token: string) => {
    writeAccessToken(token);
  });

  ipcMain.handle(AUTH_IPC.clearAccessToken, () => {
    clearAccessToken();
  });
}
