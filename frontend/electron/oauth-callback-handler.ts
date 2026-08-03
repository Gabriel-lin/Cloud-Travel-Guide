import { BrowserWindow, net } from "electron";

import { API_BASE_URL, API_V1_PREFIX } from "@/config/api";
import { DESKTOP_OAUTH_REDIRECT_URI } from "@/config/app";
import type { SessionEstablishedPayload } from "./auth-ipc";

export type DesktopTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
};

export type ParsedOAuthCallback = {
  code: string | null;
  error: string | null;
  accessToken: string | null;
  tokenType: string | null;
  expiresIn: number | null;
};

/** Match cloud-travel-guide://auth/callback deep links (incl. trailing slash). */
export function normalizeOAuthCallbackUrl(url: string): string | null {
  const trimmed = url.trim().replace(/^"+|"+$/g, "");
  try {
    const parsed = new URL(trimmed);
    const expected = new URL(DESKTOP_OAUTH_REDIRECT_URI);
    if (parsed.protocol !== expected.protocol) return null;

    const actualPath = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "");
    const expectedPath = `${expected.hostname}${expected.pathname}`.replace(
      /\/$/,
      "",
    );
    if (actualPath !== expectedPath) return null;

    return parsed.toString();
  } catch {
    return trimmed.startsWith(DESKTOP_OAUTH_REDIRECT_URI) ? trimmed : null;
  }
}

export function parseOAuthCallbackUrl(url: string): ParsedOAuthCallback {
  const parsed = new URL(url);
  const expiresRaw = parsed.searchParams.get("expires_in");
  const expiresIn =
    expiresRaw && Number.isFinite(Number(expiresRaw))
      ? Number(expiresRaw)
      : null;
  return {
    code: parsed.searchParams.get("code"),
    error: parsed.searchParams.get("error"),
    accessToken: parsed.searchParams.get("access_token"),
    tokenType: parsed.searchParams.get("token_type"),
    expiresIn,
  };
}

export async function exchangeDesktopLoginCode(
  code: string,
): Promise<DesktopTokenResponse> {
  const endpoint = `${API_BASE_URL}${API_V1_PREFIX}/auth/oauth/desktop/exchange`;
  console.log("[auth] exchanging desktop OAuth code via", endpoint);

  const response = await net.fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Desktop OAuth exchange failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  return (await response.json()) as DesktopTokenResponse;
}

/**
 * Push the session into the page context and invoke a global handler if React
 * already registered one. Returns the handler result for main-process logging.
 */
export async function injectDesktopSession(
  payload: SessionEstablishedPayload,
): Promise<void> {
  const json = JSON.stringify(payload);
  const script = `(() => {
    const payload = ${json};
    window.__CTG_DESKTOP_SESSION__ = payload;
    window.dispatchEvent(
      new CustomEvent("ctg-desktop-session", { detail: payload })
    );
    if (typeof window.__CTG_APPLY_DESKTOP_SESSION__ === "function") {
      try {
        const result = window.__CTG_APPLY_DESKTOP_SESSION__(payload);
        return result && typeof result.then === "function"
          ? result.then(() => "handler-ok").catch((e) => "handler-error:" + String(e))
          : "handler-ok";
      } catch (e) {
        return "handler-error:" + String(e);
      }
    }
    return "no-handler";
  })()`;

  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      if (window.webContents.isLoading()) {
        await new Promise<void>((resolve) => {
          window.webContents.once("did-finish-load", () => resolve());
        });
      }
      const result = await window.webContents.executeJavaScript(script, true);
      console.log("[auth] inject desktop session result:", result);
    } catch (error) {
      console.error("[auth] failed to inject desktop session:", error);
    }
  }
}

/** Hard-navigate the app window to profile so auth hydrate picks up the disk token. */
export async function navigateRendererToProfile(): Promise<void> {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try {
      const current = window.webContents.getURL();
      const target = new URL(
        "/profile",
        current || "http://127.0.0.1:3000",
      ).toString();
      console.log("[auth] navigating renderer to", target);
      await window.loadURL(target);
      if (window.isMinimized()) window.restore();
      if (!window.isVisible()) window.show();
      window.focus();
    } catch (error) {
      console.error("[auth] navigate to profile failed:", error);
    }
  }
}
