import { shell } from "electron";

import {
  API_BASE_URL,
  API_V1_PREFIX,
} from "@/config/api";
import { DESKTOP_OAUTH_REDIRECT_URI } from "@/config/app";

export type OAuthProvider = "github" | "google";

const OAUTH_PROVIDERS: ReadonlySet<OAuthProvider> = new Set([
  "github",
  "google",
]);

const AUTH_PREFIX = `${API_V1_PREFIX}/auth`;

const OAUTH_AUTHORIZE_PATH =
  /^\/api\/v1\/auth\/oauth\/(github|google)$/;

const DEV_API_HOSTS = new Set(["localhost", "127.0.0.1"]);

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase() === "localhost" ? "127.0.0.1" : hostname.toLowerCase();
}

function isSameApiHost(hostname: string, apiHostname: string): boolean {
  const a = normalizeHostname(hostname);
  const b = normalizeHostname(apiHostname);
  if (a === b) return true;
  return DEV_API_HOSTS.has(hostname.toLowerCase()) && DEV_API_HOSTS.has(apiHostname.toLowerCase());
}

function parseOAuthProvider(value: string): OAuthProvider | null {
  if (value === "github" || value === "google") return value;
  return null;
}

/** Desktop OAuth authorize URL — built only in the main process. */
export function buildDesktopOAuthAuthorizeUrl(provider: OAuthProvider): string {
  const url = new URL(`${API_BASE_URL}${AUTH_PREFIX}/oauth/${provider}`);
  url.searchParams.set("redirect_uri", DESKTOP_OAUTH_REDIRECT_URI);
  url.searchParams.set("client_type", "desktop");
  return url.toString();
}

/** Allowlist: only our backend authorize endpoints may be opened for OAuth. */
export function isOAuthAuthorizeLaunchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const apiOrigin = new URL(API_BASE_URL);
    if (!isSameApiHost(parsed.hostname, apiOrigin.hostname)) return false;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return OAUTH_AUTHORIZE_PATH.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function isOAuthProviderNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    const { hostname, pathname } = parsed;

    if (isOAuthAuthorizeLaunchUrl(url)) return true;

    if (
      hostname === "github.com" &&
      pathname.startsWith("/login/oauth")
    ) {
      return true;
    }

    if (hostname === "accounts.google.com") {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export async function launchDesktopOAuth(
  provider: OAuthProvider,
): Promise<void> {
  if (!OAUTH_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported OAuth provider: ${provider}`);
  }

  const url = buildDesktopOAuthAuthorizeUrl(provider);
  await shell.openExternal(url);
}

export async function openValidatedOAuthUrl(url: string): Promise<void> {
  if (!isOAuthAuthorizeLaunchUrl(url)) {
    throw new Error("Refusing to open non-OAuth authorize URL in system browser");
  }
  await shell.openExternal(url);
}

export function parseOAuthProviderArg(value: string): OAuthProvider {
  const provider = parseOAuthProvider(value);
  if (!provider) {
    throw new Error(`Unsupported OAuth provider: ${value}`);
  }
  return provider;
}
