import { ACCESS_TOKEN_KEY } from "./constants";
import { getElectronAPI, isElectronRuntime } from "@/lib/electron";

function canUseStorage() {
  return typeof window !== "undefined";
}

export function getAccessToken(): string | null {
  if (!canUseStorage()) return null;
  if (isElectronRuntime()) {
    return getElectronAPI()?.auth.getAccessTokenSync() ?? null;
  }
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function setAccessToken(token: string) {
  if (!canUseStorage()) return;
  if (isElectronRuntime()) {
    void getElectronAPI()?.auth.setAccessToken(token);
    return;
  }
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearAccessToken() {
  if (!canUseStorage()) return;
  if (isElectronRuntime()) {
    void getElectronAPI()?.auth.clearAccessToken();
    return;
  }
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}
