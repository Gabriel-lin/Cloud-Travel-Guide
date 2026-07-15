"use client";

import { Map as MapIcon } from "lucide-react";
import { useMemo } from "react";

import { useAppLocale } from "@/hooks/use-app-locale";
import { cn } from "@/lib/utils";

import type { RouteExperienceConfig } from "./types";

export type RouteMiniMapProps = {
  config: RouteExperienceConfig;
  /** 当前站点下标（高亮 + 场景所在地）。 */
  activeIndex: number;
  /** 点击站点切换场景。 */
  onSelectStop?: (index: number) => void;
};

const VIEW = 100;
const PADDING = 16;

/**
 * 2D 路线俯视图。
 *
 * 路线主题背景图 + 站点折线；当前站点高亮（脉冲光环），每个站点
 * 显示名称（上下交替避让折线），点击站点可切换场景。
 */
export function RouteMiniMap({ config, activeIndex, onSelectStop }: RouteMiniMapProps) {
  const { t } = useAppLocale();

  const points = useMemo(() => {
    const lons = config.stops.map((s) => s.coord.lon);
    const lats = config.stops.map((s) => s.coord.lat);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const spanLon = maxLon - minLon || 1;
    const spanLat = maxLat - minLat || 1;
    const usable = VIEW - PADDING * 2;

    return config.stops.map((stop) => ({
      id: stop.id,
      labelKey: stop.labelKey,
      x: PADDING + ((stop.coord.lon - minLon) / spanLon) * usable,
      // 纬度向上为正，SVG y 向下为正，故取反。
      y: PADDING + ((maxLat - stop.coord.lat) / spanLat) * usable,
    }));
  }, [config.stops]);

  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const activeStop = config.stops[activeIndex];

  return (
    <div className="pointer-events-auto w-64 max-w-[70vw] overflow-hidden rounded-xl border border-surface-700/60 bg-surface-900/80 shadow-xl ring-1 ring-brand-500/10 backdrop-blur-md">
      <header className="flex items-center justify-between border-b border-surface-700/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <MapIcon className="size-3.5 text-ink-400" aria-hidden />
          <h2 className="text-xs font-semibold text-ink-200">
            {t("routes.experience.miniMap.title")}
          </h2>
        </div>
        <span className="max-w-24 truncate text-[10px] font-medium" style={{ color: config.accent }}>
          {activeStop ? t(activeStop.labelKey) : ""}
        </span>
      </header>

      <div className="relative aspect-square w-full bg-surface-950/50">
        {/* 路线主题背景图（暗化保证折线/文字可读） */}
        {/* eslint-disable-next-line @next/next/no-img-element -- 装饰性小图,无需 next/image 优化 */}
        <img
          src={config.miniMapImage}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover opacity-80"
          draggable={false}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-surface-950/45 via-surface-950/15 to-surface-950/50" />

        <svg
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label={t("routes.experience.miniMap.placeholder")}
        >
          <polyline
            points={polyline}
            fill="none"
            stroke="#0b0f17"
            strokeOpacity="0.55"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={polyline}
            fill="none"
            stroke={config.accent}
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="3 2"
          />
          {points.map((p, i) => {
            const active = i === activeIndex;
            // 名称上下交替，减少相邻站点标签互压；水平方向钳入画幅
            const labelY = i % 2 === 0 ? p.y - 4.6 : p.y + 8.2;
            const labelX = Math.min(Math.max(p.x, 11), VIEW - 11);
            return (
              <g
                key={p.id}
                onClick={onSelectStop ? () => onSelectStop(i) : undefined}
                className={cn(onSelectStop && "cursor-pointer")}
              >
                {/* 命中区域（透明大圆,方便点击） */}
                <circle cx={p.x} cy={p.y} r="6.5" fill="transparent" />
                {active && (
                  <>
                    {/* 常驻光环 + 脉冲扩散环 */}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r="4.6"
                      fill="none"
                      stroke={config.accent}
                      strokeOpacity="0.45"
                      strokeWidth="1"
                    />
                    <circle cx={p.x} cy={p.y} r="4.6" fill="none" stroke={config.accent} strokeWidth="0.8">
                      <animate attributeName="r" values="3;7.5" dur="1.8s" repeatCount="indefinite" />
                      <animate attributeName="stroke-opacity" values="0.7;0" dur="1.8s" repeatCount="indefinite" />
                    </circle>
                  </>
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={active ? 3 : 2}
                  fill={active ? "#ffffff" : config.accent}
                  stroke={active ? config.accent : "#0b0f17"}
                  strokeWidth={active ? 1.2 : 0.6}
                />
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor="middle"
                  fontSize={active ? 5.4 : 4.6}
                  fontWeight={active ? 700 : 500}
                  fill={active ? "#ffffff" : "#d7dde6"}
                  stroke="#0b0f17"
                  strokeWidth="0.9"
                  strokeOpacity="0.85"
                  paintOrder="stroke"
                  style={{ userSelect: "none" }}
                >
                  {t(p.labelKey)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
