import { ENV_DEFAULTS, defaultDesktopOAuthRedirectUri } from "./defaults";
import { readEnv } from "./env";

export const APP_PROTOCOL = readEnv(
  "NEXT_PUBLIC_APP_PROTOCOL",
  ENV_DEFAULTS.NEXT_PUBLIC_APP_PROTOCOL,
);

export const APP_NAME = readEnv("NEXT_PUBLIC_APP_NAME", ENV_DEFAULTS.NEXT_PUBLIC_APP_NAME);

export const APP_DESCRIPTION = readEnv(
  "NEXT_PUBLIC_APP_DESCRIPTION",
  ENV_DEFAULTS.NEXT_PUBLIC_APP_DESCRIPTION,
);

export const APP_ID = readEnv("NEXT_PUBLIC_APP_ID", ENV_DEFAULTS.NEXT_PUBLIC_APP_ID);

export const DESKTOP_OAUTH_REDIRECT_URI = readEnv(
  "NEXT_PUBLIC_DESKTOP_OAUTH_REDIRECT_URI",
  defaultDesktopOAuthRedirectUri(APP_PROTOCOL),
);
