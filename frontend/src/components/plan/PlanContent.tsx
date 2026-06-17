"use client";

import { ModulePage } from "@/components/layout/ModulePage";
import { useAppLocale } from "@/hooks/use-app-locale";

const PLAN_BG = "/images/plan-scenery.jpg";

const PLAN_FEATURES = [
  "plan.featureDayRoute",
  "plan.featureMapMarkers",
  "plan.featureExport",
] as const;

export function PlanContent() {
  const { t } = useAppLocale();

  return (
    <ModulePage
      title={t("nav.plan.pageTitle")}
      description={t("nav.plan.pageDescription")}
      showBreadcrumb={false}
      backgroundImage={PLAN_BG}
      contentClassName="overflow-hidden"
    >
      <div className="w-full space-y-4 rounded-lg border border-surface-700/80 bg-surface-900/75 p-5 shadow-lg ring-1 ring-brand-500/10 backdrop-blur-md">
        <p className="text-base font-medium text-ink-200">
          {t("plan.gettingStarted")}
        </p>
        <p className="text-sm text-ink-400">{t("plan.intro")}</p>
        <ul className="list-inside list-disc space-y-1 text-sm text-ink-400">
          {PLAN_FEATURES.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </div>
    </ModulePage>
  );
}
