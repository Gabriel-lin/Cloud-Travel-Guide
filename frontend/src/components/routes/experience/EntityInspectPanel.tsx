"use client";

import { useState } from "react";
import { Box, Pause, Play, X } from "lucide-react";

import { useAppLocale } from "@/hooks/use-app-locale";
import type { PickedEntity } from "@/lib/region-engine/pick/types";
import { cn } from "@/lib/utils";

import { ViewNavGizmo, type InspectView } from "./ViewNavGizmo";

export type { InspectView };

export type EntityInspectPanelProps = {
  entity: PickedEntity;
  onClose: () => void;
  /** 后续 glTF 动画接入。播放传 clip 名,暂停传 "pause"。 */
  onPlayClip?: (clip: string) => void;
  /** 导航球:点击轴或拖动后的对齐/重置。 */
  onSetView?: (view: InspectView) => void;
};

/**
 * 拾取检查卡片。宽度随场景区域缩放；窄屏改为底部面板。
 * 模型区右下角是导航球，动画只有一个播放/暂停开关。
 */
export function EntityInspectPanel({
  entity,
  onClose,
  onPlayClip,
  onSetView,
}: EntityInspectPanelProps) {
  const { t } = useAppLocale();
  const p = "routes.experience.inspect";
  const ready = Boolean(entity.model?.src);
  const [playback, setPlayback] = useState({ key: entity.instanceKey, playing: false });
  const playing = playback.key === entity.instanceKey && playback.playing;
  const toggleLabel = playing ? t(`${p}.pause`) : t(`${p}.play`);

  return (
    <aside className="@container/inspect pointer-events-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-surface-700/60 bg-surface-900/80 shadow-xl ring-1 ring-brand-500/10 backdrop-blur-md">
      <header className="flex items-center justify-between gap-2 border-b border-surface-700/60 px-3 py-2.5 @md/inspect:px-4 @md/inspect:py-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-brand-400">
            {t(`${p}.kind.${entity.kind}`)}
          </p>
          <h2 className="truncate text-sm font-semibold text-ink-100">{t(entity.titleKey)}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t(`${p}.close`)}
          className="inline-flex size-7 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-surface-800/80 hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-3 @md/inspect:gap-3 @md/inspect:px-4 @md/inspect:py-4">
        <div className="relative flex min-h-32 flex-1 flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-surface-700/70 bg-surface-950/40">
          <Box className="size-6 text-ink-500 @md/inspect:size-8" aria-hidden />
          <p className="mt-2 max-w-[min(24rem,calc(100%-5.5rem))] px-3 text-center text-xs leading-relaxed text-ink-400 @md/inspect:mt-3">
            {t(`${p}.modelPlaceholder`)}
          </p>
          {entity.model?.src ? (
            <p className="mt-1 max-w-full truncate px-4 font-mono text-[10px] text-ink-500">
              {t(`${p}.modelPath`, { path: entity.model.src })}
            </p>
          ) : (
            <span className="mt-2 rounded-full bg-surface-800/70 px-2.5 py-0.5 text-[11px] text-ink-500 ring-1 ring-surface-700/60">
              {t(`${p}.comingSoon`)}
            </span>
          )}
          <div className="absolute bottom-1 right-1" title={t(`${p}.viewGizmo`)}>
            <ViewNavGizmo
              key={entity.instanceKey}
              className="size-16 @sm/inspect:size-24 @md/inspect:size-30"
              label={t(`${p}.viewGizmo`)}
              axisLabel={(view) => t(`${p}.axis.${view}`)}
              onChange={onSetView}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-ink-500">
            {t(`${p}.animation`)}
          </p>
          <button
            type="button"
            disabled={!ready}
            aria-pressed={playing}
            title={toggleLabel}
            onClick={() => {
              const next = !playing;
              setPlayback({ key: entity.instanceKey, playing: next });
              onPlayClip?.(next ? (entity.model?.clip ?? "idle") : "pause");
            }}
            className={cn(
              "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[11px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
              ready
                ? "bg-surface-800/70 text-ink-200 ring-1 ring-surface-700/60 hover:bg-surface-800 hover:text-ink-50"
                : "cursor-not-allowed bg-surface-800/40 text-ink-600",
            )}
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            {toggleLabel}
          </button>
        </div>
      </div>
    </aside>
  );
}
