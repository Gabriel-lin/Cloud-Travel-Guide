"use client";

import { useCallback, useEffect, useState } from "react";

import type { PickedEntity } from "@/lib/region-engine/pick/types";
import { clearsInspectOnEscape } from "@/lib/region-engine/pick/pointerPolicy";
import { cn } from "@/lib/utils";

import { EntityInspectPanel } from "./EntityInspectPanel";
import { RouteInfoPanel } from "./RouteInfoPanel";
import { RouteMiniMap } from "./RouteMiniMap";
import { RouteScene } from "./RouteScene";
import { RouteToolbar } from "./RouteToolbar";
import type { RouteExperienceConfig, RouteToolbarState } from "./types";

export type RouteExperienceProps = {
  config: RouteExperienceConfig;
};

const INITIAL_STATE: RouteToolbarState = {
  viewMode: "first-person",
  pointerTool: "cursor",
  lighting: "day",
  autoTour: false,
};

/**
 * 推荐路线的统一子页面组件。
 *
 * 所有路线共用此布局，仅通过 {@link RouteExperienceConfig} 驱动差异化内容。
 * 由四个部分组成：
 *  1. 顶部工具栏（{@link RouteToolbar}）
 *  2. 铺满整页的三维场景（{@link RouteScene}）
 *  3. 右侧场景详情面板 / 拾取检查卡片
 *  4. 右下角 2D 路线俯视图（拾取时隐藏）
 */
export function RouteExperience({ config }: RouteExperienceProps) {
  const [state, setState] = useState<RouteToolbarState>(INITIAL_STATE);
  const [activeStopIndex, setActiveStopIndex] = useState(0);
  const [picked, setPicked] = useState<PickedEntity | null>(null);

  const handleChange = useCallback((patch: Partial<RouteToolbarState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const handlePick = useCallback((entity: PickedEntity | null) => {
    setPicked(entity);
  }, []);

  const handleSelectStop = useCallback((index: number) => {
    setActiveStopIndex(index);
    setPicked(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (clearsInspectOnEscape(e)) setPicked(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-950">
      <RouteScene
        config={config}
        state={state}
        activeStopIndex={activeStopIndex}
        onStateChange={handleChange}
        onPick={handlePick}
      />

      <RouteToolbar config={config} state={state} onChange={handleChange} />

      <div
        className={cn(
          "pointer-events-none absolute z-20 flex flex-col items-end gap-3",
          picked
            ? "inset-x-3 bottom-3 h-[min(70dvh,calc(100%-4.5rem))] sm:inset-x-auto sm:right-3 sm:top-20 sm:h-auto sm:w-[min(70%,42rem)] sm:max-w-[calc(100%-1.5rem)]"
            : "bottom-3 right-3 top-20 w-[min(20rem,calc(100%-1.5rem))]",
        )}
      >
        {picked ? (
          <EntityInspectPanel entity={picked} onClose={() => setPicked(null)} />
        ) : (
          <>
            <div className="flex min-h-0 w-full flex-1">
              <RouteInfoPanel config={config} />
            </div>
            <RouteMiniMap
              config={config}
              activeIndex={activeStopIndex}
              onSelectStop={handleSelectStop}
            />
          </>
        )}
      </div>
    </div>
  );
}
