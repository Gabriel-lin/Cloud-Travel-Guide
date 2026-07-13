"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { ModulePage } from "@/components/layout/ModulePage";
import { ROUTE_EXPERIENCES } from "@/components/routes/experience/route-configs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ROUTE_EXPERIENCES.map((route) => (
          <Link
            key={route.slug}
            href={`/routes/${route.slug}`}
            className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60"
          >
            <Card className="h-full border-surface-700/80 bg-surface-900/75 shadow-lg ring-1 ring-brand-500/10 backdrop-blur-md transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-brand-500/40 group-hover:ring-brand-500/30">
              <CardHeader>
                <CardDescription className="text-brand-400">
                  {t(`${route.i18nKey}.region`)}
                </CardDescription>
                <CardTitle className="text-ink-100">
                  {t(`${route.i18nKey}.title`)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-ink-400">
                  {t(`${route.i18nKey}.summary`)}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-400 opacity-0 transition-opacity group-hover:opacity-100">
                  {t("routes.card.enter")}
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </ModulePage>
  );
}
