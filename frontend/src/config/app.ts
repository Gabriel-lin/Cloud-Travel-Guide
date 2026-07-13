import { ENV_DEFAULTS, defaultDesktopOAuthRedirectUri } from "./defaults";

/**
 * App identity constants shared by Next renderer and Electron main.
 * Static `process.env.KEY` access is required so Vite/Next can inline .env values.
 */
export const APP_PROTOCOL =
  process.env.NEXT_PUBLIC_APP_PROTOCOL?.trim() ||
  ENV_DEFAULTS.NEXT_PUBLIC_APP_PROTOCOL;

export const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME?.trim() || ENV_DEFAULTS.NEXT_PUBLIC_APP_NAME;

export const APP_DESCRIPTION =
  process.env.NEXT_PUBLIC_APP_DESCRIPTION?.trim() ||
  ENV_DEFAULTS.NEXT_PUBLIC_APP_DESCRIPTION;

export const APP_ID =
  process.env.NEXT_PUBLIC_APP_ID?.trim() || ENV_DEFAULTS.NEXT_PUBLIC_APP_ID;

export const DESKTOP_OAUTH_REDIRECT_URI =
  process.env.NEXT_PUBLIC_DESKTOP_OAUTH_REDIRECT_URI?.trim() ||
  defaultDesktopOAuthRedirectUri(APP_PROTOCOL);
