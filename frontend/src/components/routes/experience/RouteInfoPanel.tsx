"use client";

import { Clapperboard, Landmark, PanelRightClose } from "lucide-react";
import { useState } from "react";

import { useAppLocale } from "@/hooks/use-app-locale";
import { cn } from "@/lib/utils";

import type { RouteExperienceConfig } from "./types";

export type RouteInfoPanelProps = {
  config: RouteExperienceConfig;
};

type PanelTab = "video" | "history";

/**
 * 右侧场景详情面板（占位）。
 *
 * 后续用于播放选中场景的相关视频、展示历史人文介绍等。
 * 当前阶段仅完成布局与空状态。
 */
export function RouteInfoPanel({ config: _config }: RouteInfoPanelProps) {
  const { t } = useAppLocale();
  const [tab, setTab] = useState<PanelTab>("video");

  const p = "routes.experience.panel";

  return (
    <aside className="pointer-events-auto flex w-full flex-col overflow-hidden rounded-xl border border-surface-700/60 bg-surface-900/80 shadow-xl ring-1 ring-brand-500/10 backdrop-blur-md">
      <header className="flex items-center justify-between border-b border-surface-700/60 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink-100">{t(`${p}.title`)}</h2>
        <PanelRightClose className="size-4 text-ink-500" aria-hidden />
      </header>

      <div className="flex gap-1 px-3 pt-3">
        {(
          [
            { id: "video" as const, label: t(`${p}.videoTab`), icon: Clapperboard },
            { id: "history" as const, label: t(`${p}.historyTab`), icon: Landmark },
          ]
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              tab === id
                ? "bg-surface-800 text-ink-100 ring-1 ring-surface-700/70"
                : "text-ink-400 hover:text-ink-200",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-2 px-5 py-8 text-center">
        <div className="aspect-video w-full rounded-lg border border-dashed border-surface-700/70 bg-surface-950/40" />
        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          {t(`${p}.empty`)}
        </p>
        <span className="rounded-full bg-surface-800/70 px-2.5 py-0.5 text-[11px] text-ink-500 ring-1 ring-surface-700/60">
          {t(`${p}.comingSoon`)}
        </span>
      </div>
    </aside>
  );
}
