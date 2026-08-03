"use client";

import { ModulePage } from "@/components/layout/ModulePage";
import { RouteCard } from "@/components/routes/RouteCard";
import { ROUTE_EXPERIENCES } from "@/components/routes/experience/route-configs";
import { useAppLocale } from "@/hooks/use-app-locale";

const ROUTES_BG = "/images/routes-scenery.jpg";

export function RoutesContent() {
  const { t } = useAppLocale();

  return (
    <ModulePage
      title={t("nav.routes.pageTitle")}
      description={t("nav.routes.pageDescription")}
      showBreadcrumb={false}
      backgroundImage={ROUTES_BG}
      contentClassName="overflow-hidden"
    >
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {ROUTE_EXPERIENCES.map((route) => {
          const origin = route.stops[0];
          return (
            <RouteCard
              key={route.slug}
              route={route}
              region={t(`${route.i18nKey}.region`)}
              title={t(`${route.i18nKey}.title`)}
              summary={t(`${route.i18nKey}.summary`)}
              originLabel={
                origin ? t(origin.labelKey) : ""
              }
              enterLabel={t("routes.card.enter")}
            />
          );
        })}
      </div>
    </ModulePage>
  );
}
