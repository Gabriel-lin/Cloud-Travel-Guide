import type { Session, WebContents } from "electron";
import { session, shell } from "electron";

import {
  buildDesktopOAuthAuthorizeUrl,
  isOAuthAuthorizeLaunchUrl,
  isOAuthProviderNavigation,
  type OAuthProvider,
} from "./desktop-oauth";

let guardRegistered = false;

function providerFromAuthorizeUrl(url: string): OAuthProvider | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(
      /^\/api\/v1\/auth\/oauth\/(github|google)$/,
    );
    if (match?.[1] === "github" || match?.[1] === "google") {
      return match[1];
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Always open the desktop OAuth authorize URL in the system browser.
 * Never forward a web client_type URL — that would log the system browser in
 * instead of returning to the Electron app via deep link.
 */
export function openOAuthInSystemBrowser(url: string): void {
  const provider = providerFromAuthorizeUrl(url);
  if (provider) {
    void shell.openExternal(buildDesktopOAuthAuthorizeUrl(provider));
    return;
  }

  // Mid-flow provider pages (GitHub / Google) — open as-is.
  if (isOAuthAuthorizeLaunchUrl(url)) {
    // Allowlisted but path didn't match provider extract — still avoid web state.
    void shell.openExternal(url);
    return;
  }

  void shell.openExternal(url);
}

/**
 * Session-level guard: any main-frame OAuth navigation is cancelled in the app
 * window and opened in the system browser as desktop OAuth instead.
 */
export function registerOAuthNavigationGuard(targetSession?: Session): void {
  if (guardRegistered) return;
  guardRegistered = true;

  const ses = targetSession ?? session.defaultSession;

  ses.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      if (details.resourceType !== "mainFrame") {
        callback({});
        return;
      }

      if (!isOAuthProviderNavigation(details.url)) {
        callback({});
        return;
      }

      openOAuthInSystemBrowser(details.url);
      callback({ cancel: true });
    },
  );
}

/** Per-window fallback for navigations that bypass webRequest in edge cases. */
export function attachOAuthExternalNavigation(contents: WebContents): void {
  const intercept = (url: string) => {
    if (!isOAuthProviderNavigation(url)) return;
    openOAuthInSystemBrowser(url);
  };

  contents.on("will-navigate", (event, url) => {
    if (!isOAuthProviderNavigation(url)) return;
    event.preventDefault();
    intercept(url);
  });

  contents.on("will-redirect", (event, url) => {
    if (!isOAuthProviderNavigation(url)) return;
    event.preventDefault();
    intercept(url);
  });
}
