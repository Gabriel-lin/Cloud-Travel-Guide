import type { RouteExperienceConfig } from "./types";

/**
 * 推荐路线体验配置表。
 *
 * 顺序即推荐页卡片与子页面的展示顺序；每条路线共用同一套子页面组件，
 * 仅通过此配置驱动差异化的场景内容（站点、坐标、主题色等）。
 */
export const ROUTE_EXPERIENCES: readonly RouteExperienceConfig[] = [
  {
    slug: "silk-road",
    i18nKey: "routes.silkRoad",
    accent: "#d9a441",
    backgroundImage: "/images/routes-scenery.jpg",
    miniMapImage: "/images/minimap/silk-road.png",
    stops: [
      { id: "xian", labelKey: "routes.silkRoad.stops.xian", coord: { lat: 34.34, lon: 108.94 } },
      { id: "lanzhou", labelKey: "routes.silkRoad.stops.lanzhou", coord: { lat: 36.06, lon: 103.83 } },
      { id: "dunhuang", labelKey: "routes.silkRoad.stops.dunhuang", coord: { lat: 40.14, lon: 94.66 } },
      { id: "turpan", labelKey: "routes.silkRoad.stops.turpan", coord: { lat: 42.95, lon: 89.18 } },
      { id: "kashgar", labelKey: "routes.silkRoad.stops.kashgar", coord: { lat: 39.47, lon: 75.99 } },
    ],
  },
  {
    slug: "sichuan-tibet",
    i18nKey: "routes.sichuanTibet",
    accent: "#4fb6a6",
    backgroundImage: "/images/routes-scenery.jpg",
    miniMapImage: "/images/minimap/sichuan-tibet.png",
    stops: [
      { id: "chengdu", labelKey: "routes.sichuanTibet.stops.chengdu", coord: { lat: 30.57, lon: 104.07 } },
      { id: "kangding", labelKey: "routes.sichuanTibet.stops.kangding", coord: { lat: 30.05, lon: 101.96 } },
      { id: "litang", labelKey: "routes.sichuanTibet.stops.litang", coord: { lat: 30.0, lon: 100.27 } },
      { id: "nyingchi", labelKey: "routes.sichuanTibet.stops.nyingchi", coord: { lat: 29.65, lon: 94.36 } },
      { id: "lhasa", labelKey: "routes.sichuanTibet.stops.lhasa", coord: { lat: 29.65, lon: 91.14 } },
    ],
  },
  {
    slug: "mediterranean",
    i18nKey: "routes.mediterranean",
    accent: "#5b9bd5",
    backgroundImage: "/images/routes-scenery.jpg",
    miniMapImage: "/images/minimap/mediterranean.png",
    stops: [
      { id: "barcelona", labelKey: "routes.mediterranean.stops.barcelona", coord: { lat: 41.39, lon: 2.17 } },
      { id: "marseille", labelKey: "routes.mediterranean.stops.marseille", coord: { lat: 43.3, lon: 5.37 } },
      { id: "rome", labelKey: "routes.mediterranean.stops.rome", coord: { lat: 41.9, lon: 12.5 } },
      { id: "athens", labelKey: "routes.mediterranean.stops.athens", coord: { lat: 37.98, lon: 23.73 } },
      { id: "istanbul", labelKey: "routes.mediterranean.stops.istanbul", coord: { lat: 41.01, lon: 28.98 } },
    ],
  },
];

/** 所有路线 slug（用于 generateStaticParams 等）。 */
export const ROUTE_SLUGS: readonly string[] = ROUTE_EXPERIENCES.map(
  (route) => route.slug,
);

/** 按 slug 获取路线配置。 */
export function getRouteConfig(
  slug: string,
): RouteExperienceConfig | undefined {
  return ROUTE_EXPERIENCES.find((route) => route.slug === slug);
}
