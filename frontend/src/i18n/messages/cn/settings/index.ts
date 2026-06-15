import { language } from "./language";
import { page } from "./page";
import { reduceMotion } from "./reduce-motion";
import { terrain } from "./terrain";
import { theme } from "./theme";

export const settings = {
  ...page,
  theme,
  terrain,
  reduceMotion,
  language,
} as const;
