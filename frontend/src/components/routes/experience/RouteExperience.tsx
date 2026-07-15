"use client";

import { useCallback, useState } from "react";

import { RouteInfoPanel } from "./RouteInfoPanel";
import { RouteMiniMap } from "./RouteMiniMap";
import { RouteScene } from "./RouteScene";
import { RouteToolbar } from "./RouteToolbar";
import type { RouteExperienceConfig, RouteToolbarState } from "./types";

export type RouteExperienceProps = {
  config: RouteExperienceConfig;
};

const INITIAL_STATE: RouteToolbarState = {
  viewMode: "third-person",
  pointerTool: "cursor",
  lighting: "day",
  autoTour: false,
};

/**
 * 推荐路线的统一子页面组件。
 *
 * 所有路线共用此布局，仅通过 {@link RouteExperienceConfig} 驱动差异化内容。
 * 由四个部分组成：
 *  1. 顶部工具栏（{@link RouteToolbar}，已实现）
 *  2. 铺满整页的三维场景（{@link RouteScene}，布局占位）
 *  3. 右侧场景详情面板（{@link RouteInfoPanel}，布局占位）
 *  4. 右下角 2D 路线俯视图（{@link RouteMiniMap}，布局占位）
 */
export function RouteExperience({ config }: RouteExperienceProps) {
  const [state, setState] = useState<RouteToolbarState>(INITIAL_STATE);
  // 当前站点：驱动三维场景所在地与俯视图高亮
  const [activeStopIndex, setActiveStopIndex] = useState(0);

  const handleChange = useCallback((patch: Partial<RouteToolbarState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-surface-950">
      {/* 2 · 场景（铺满整页，位于最底层） */}
      <RouteScene
        config={config}
        state={state}
        activeStopIndex={activeStopIndex}
        onStateChange={handleChange}
      />

      {/* 1 · 顶部工具栏 */}
      <RouteToolbar config={config} state={state} onChange={handleChange} />

      {/* 3 + 4 · 右侧详情面板 与 右下角俯视图 */}
      <div className="pointer-events-none absolute bottom-3 right-3 top-20 z-20 flex w-80 max-w-[80vw] flex-col items-end gap-3">
        <div className="flex min-h-0 w-full flex-1">
          <RouteInfoPanel config={config} />
        </div>
        <RouteMiniMap
          config={config}
          activeIndex={activeStopIndex}
          onSelectStop={setActiveStopIndex}
        />
      </div>
    </div>
  );
}
