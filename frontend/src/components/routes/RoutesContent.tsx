"use client";

import { ModulePage } from "@/components/layout/ModulePage";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAppLocale } from "@/hooks/use-app-locale";

const ROUTES_BG = "/images/routes-scenery.jpg";

const FEATURED_ROUTE_KEYS = [
  "routes.silkRoad",
  "routes.sichuanTibet",
  "routes.mediterranean",
] as const;

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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURED_ROUTE_KEYS.map((key) => (
          <Card
            key={key}
            className="border-surface-700/80 bg-surface-900/75 shadow-lg ring-1 ring-brand-500/10 backdrop-blur-md"
          >
            <CardHeader>
              <CardDescription className="text-brand-400">
                {t(`${key}.region`)}
              </CardDescription>
              <CardTitle className="text-ink-100">{t(`${key}.title`)}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink-400">{t(`${key}.summary`)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </ModulePage>
  );
}
