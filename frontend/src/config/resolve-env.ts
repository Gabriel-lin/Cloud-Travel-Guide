import { ENV_DEFAULTS, defaultDesktopOAuthRedirectUri } from "./defaults";
import { loadEnvFiles } from "./load-env-files";

export type ResolvedPublicEnv = {
  NEXT_PUBLIC_APP_NAME: string;
  NEXT_PUBLIC_APP_DESCRIPTION: string;
  NEXT_PUBLIC_APP_ID: string;
  NEXT_PUBLIC_APP_PROTOCOL: string;
  NEXT_PUBLIC_DESKTOP_OAUTH_REDIRECT_URI: string;
  NEXT_PUBLIC_API_BASE_URL: string;
  ELECTRON_DEV_SERVER_URL: string;
};

function pickEnv(
  fileEnv: Record<string, string>,
  key: keyof ResolvedPublicEnv,
  fallback: string,
): string {
  const fromProcess = process.env[key]?.trim();
  if (fromProcess) return fromProcess;
  const fromFile = fileEnv[key]?.trim();
  if (fromFile) return fromFile;
  return fallback;
}

/** Resolve public env for build tooling (Next config, Vite Electron, dev scripts). */
export function resolvePublicEnv(mode: string, root: string): ResolvedPublicEnv {
  const fileEnv = loadEnvFiles(root, mode);
  const protocol = pickEnv(
    fileEnv,
    "NEXT_PUBLIC_APP_PROTOCOL",
    ENV_DEFAULTS.NEXT_PUBLIC_APP_PROTOCOL,
  );

  return {
    NEXT_PUBLIC_APP_NAME: pickEnv(
      fileEnv,
      "NEXT_PUBLIC_APP_NAME",
      ENV_DEFAULTS.NEXT_PUBLIC_APP_NAME,
    ),
    NEXT_PUBLIC_APP_DESCRIPTION: pickEnv(
      fileEnv,
      "NEXT_PUBLIC_APP_DESCRIPTION",
      ENV_DEFAULTS.NEXT_PUBLIC_APP_DESCRIPTION,
    ),
    NEXT_PUBLIC_APP_ID: pickEnv(
      fileEnv,
      "NEXT_PUBLIC_APP_ID",
      ENV_DEFAULTS.NEXT_PUBLIC_APP_ID,
    ),
    NEXT_PUBLIC_APP_PROTOCOL: protocol,
    NEXT_PUBLIC_DESKTOP_OAUTH_REDIRECT_URI: pickEnv(
      fileEnv,
      "NEXT_PUBLIC_DESKTOP_OAUTH_REDIRECT_URI",
      defaultDesktopOAuthRedirectUri(protocol),
    ),
    NEXT_PUBLIC_API_BASE_URL: pickEnv(
      fileEnv,
      "NEXT_PUBLIC_API_BASE_URL",
      ENV_DEFAULTS.NEXT_PUBLIC_API_BASE_URL,
    ),
    ELECTRON_DEV_SERVER_URL: pickEnv(
      fileEnv,
      "ELECTRON_DEV_SERVER_URL",
      ENV_DEFAULTS.ELECTRON_DEV_SERVER_URL,
    ),
  };
}

export function toProcessEnvDefine(env: ResolvedPublicEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)]),
  );
}
