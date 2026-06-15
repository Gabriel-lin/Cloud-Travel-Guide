import { brand } from "./brand";
import { explore } from "./explore";
import { groupLabel } from "./group-label";
import { plan } from "./plan";
import { profile } from "./profile";
import { routes } from "./routes";
import { saved } from "./saved";
import { settings } from "./settings";

export const nav = {
  explore,
  routes,
  plan,
  saved,
  profile,
  settings,
  brand,
  groupLabel,
} as const;
