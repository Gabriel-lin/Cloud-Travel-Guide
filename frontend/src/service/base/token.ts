import { ACCESS_TOKEN_KEY } from "./constants";
import { getElectronAPI, isElectronRuntime } from "@/lib/electron";

function canUseStorage() {
  return typeof window !== "undefined";
}

/** Renderer-side cache — never triggers IPC on read. */
let electronTokenCache: string | null | undefined;

function seedElectronTokenFromBridge(): void {
  if (!isElectronRuntime()) return;
  if (electronTokenCache !== undefined) return;
  electronTokenCache = getElectronAPI()?.auth.readCachedAccessToken() ?? null;
}

export function getAccessToken(): string | null {
  if (!canUseStorage()) return null;
  if (isElectronRuntime()) {
    seedElectronTokenFromBridge();
    return electronTokenCache ?? null;
  }
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

/** Persist access token (await on Electron so secure storage is ready before /me). */
export async function persistAccessToken(token: string): Promise<void> {
  if (!canUseStorage()) return;
  if (isElectronRuntime()) {
    electronTokenCache = token;
    const api = getElectronAPI()?.auth;
    if (api) await api.setAccessToken(token);
    return;
  }
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

/** Fire-and-forget wrapper for legacy call sites. */
export function setAccessToken(token: string): void {
  void persistAccessToken(token);
}

export function clearAccessToken() {
  if (!canUseStorage()) return;
  if (isElectronRuntime()) {
    electronTokenCache = null;
    void getElectronAPI()?.auth.clearAccessToken();
    return;
  }
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}

/**
 * Re-read token from encrypted storage. Never overwrites a valid in-memory token
 * with null (disk write may lag behind OAuth callback).
 */
export async function refreshAccessTokenFromBridge(): Promise<string | null> {
  if (!isElectronRuntime()) {
    return getAccessToken();
  }
  const api = getElectronAPI()?.auth;
  if (!api) {
    if (electronTokenCache === undefined) electronTokenCache = null;
    return electronTokenCache ?? null;
  }
  const fromDisk = await api.getAccessToken();
  if (fromDisk !== null) {
    electronTokenCache = fromDisk;
  } else if (electronTokenCache === undefined) {
    electronTokenCache = null;
  }
  return electronTokenCache ?? null;
}
