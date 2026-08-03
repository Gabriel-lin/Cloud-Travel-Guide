"use client";

import { PlanRuntimeProvider } from "@/components/plan/PlanRuntimeProvider";
import { PlanThread } from "@/components/plan/PlanThread";
import { PlanThreadList } from "@/components/plan/PlanThreadList";
import { useAppLocale } from "@/hooks/use-app-locale";

const PLAN_BG = "/images/plan-scenery.jpg";

export function PlanContent() {
  const { t } = useAppLocale();

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${PLAN_BG})` }}
        aria-hidden
      />
      {/* 对话是长文阅读面，亮色下照片必须退成极淡的底纹，否则正文压在景物上 */}
      <div
        className="pointer-events-none absolute inset-0 bg-surface-950/75 backdrop-blur-[2px] dark:bg-surface-950/60 dark:backdrop-blur-none"
        aria-hidden
      />

      {/* Indicator header — compact, not a full ModulePage chrome */}
      <header className="relative z-10 flex shrink-0 items-center gap-3 border-b border-surface-700/50 bg-surface-900/30 px-5 py-3 backdrop-blur-md">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight text-ink-100">
            {t("nav.plan.pageTitle")}
          </h1>
          <p className="truncate text-xs text-ink-400">
            {t("nav.plan.pageDescription")}
          </p>
        </div>
      </header>

      <PlanRuntimeProvider>
        <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
          <PlanThreadList className="hidden md:flex" />
          <PlanThread />
        </div>
      </PlanRuntimeProvider>
    </div>
  );
}
