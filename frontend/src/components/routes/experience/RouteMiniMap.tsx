"use client";

import { Map as MapIcon } from "lucide-react";
import { useMemo } from "react";

import { useAppLocale } from "@/hooks/use-app-locale";

import type { RouteExperienceConfig } from "./types";

export type RouteMiniMapProps = {
  config: RouteExperienceConfig;
};

const VIEW = 100;
const PADDING = 14;

/**
 * 2D 路线俯视图（占位）。
 *
 * 后续将渲染完整的 2D 地图，包含当前路线、位置点与标记物。
 * 当前阶段用 SVG 将站点经纬度归一化后绘制路线折线与节点作为布局占位。
 */
export function RouteMiniMap({ config }: RouteMiniMapProps) {
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

  return (
    <div className="pointer-events-auto w-64 max-w-[70vw] overflow-hidden rounded-xl border border-surface-700/60 bg-surface-900/80 shadow-xl ring-1 ring-brand-500/10 backdrop-blur-md">
      <header className="flex items-center justify-between border-b border-surface-700/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <MapIcon className="size-3.5 text-ink-400" aria-hidden />
          <h2 className="text-xs font-semibold text-ink-200">
            {t("routes.experience.miniMap.title")}
          </h2>
        </div>
        <span className="text-[10px] text-ink-500">
          {t("routes.experience.miniMap.stops", { count: config.stops.length })}
        </span>
      </header>

      <div className="relative aspect-square w-full bg-surface-950/50">
        <svg
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label={t("routes.experience.miniMap.placeholder")}
        >
          <defs>
            <pattern
              id={`grid-${config.slug}`}
              width="12.5"
              height="12.5"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 12.5 0 L 0 0 0 12.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="0.3"
                className="text-surface-700/40"
              />
            </pattern>
          </defs>
          <rect width={VIEW} height={VIEW} fill={`url(#grid-${config.slug})`} />
          <polyline
            points={polyline}
            fill="none"
            stroke={config.accent}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="3 2"
          />
          {points.map((p, i) => (
            <g key={p.id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={i === 0 ? 2.6 : 2}
                fill={config.accent}
                stroke="#0b0f17"
                strokeWidth="0.6"
              />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
