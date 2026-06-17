import type { AppLocale } from "@/lib/locale";
import type { ThemePreference } from "@/lib/theme";

export type RemoteSettings = {
  theme: ThemePreference;
  locale: AppLocale;
  terrainStreaming?: boolean;
  reduceMotion?: boolean;
};

export type UpdateRemoteSettingsPayload = Partial<RemoteSettings>;
