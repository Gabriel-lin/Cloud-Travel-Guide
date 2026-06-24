import { useMemo } from "react";

import { APP_NAME } from "@/config/app";
import { useAppLocale } from "@/hooks/use-app-locale";
import {
  APP_NAV_ITEMS,
  PRIMARY_NAV_IDS,
  SECONDARY_NAV_IDS,
  type AppNavId,
  type AppNavItem,
} from "@/lib/app-nav";

function localizeNavItem(
  item: AppNavItem,
  t: (key: string) => string,
): AppNavItem {
  const id = item.id;
  return {
    ...item,
    label: t(`nav.${id}.label`),
    description: t(`nav.${id}.description`),
    pageTitle: t(`nav.${id}.pageTitle`),
    pageDescription: t(`nav.${id}.pageDescription`),
  };
}

export function useLocalizedNavItems() {
  const { t } = useAppLocale();

  return useMemo(() => {
    const items = Object.fromEntries(
      Object.entries(APP_NAV_ITEMS).map(([id, item]) => [
        id,
        localizeNavItem(item, t),
      ]),
    ) as Record<AppNavId, AppNavItem>;

    return {
      items,
      primaryIds: PRIMARY_NAV_IDS,
      secondaryIds: SECONDARY_NAV_IDS,
      brand: {
        title: t("nav.brand.title"),
        subtitle: t("nav.brand.subtitle"),
        tooltip: APP_NAME,
      },
      groupLabel: t("nav.groupLabel"),
    };
  }, [t]);
}
