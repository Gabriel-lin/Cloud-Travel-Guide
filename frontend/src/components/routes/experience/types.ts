/** 相机视角模式：第一人称沉浸 / 第三人称环绕。 */
export type RouteViewMode = "first-person" | "third-person";

/** 指针工具：光标用于点击选择，抓手用于拖动场景画布。 */
export type RoutePointerTool = "cursor" | "hand";

/** 场景光照模式：白天 / 夜晚。 */
export type RouteLighting = "day" | "night";

/** 工具栏可调节的全部交互状态。 */
export type RouteToolbarState = {
  viewMode: RouteViewMode;
  pointerTool: RoutePointerTool;
  lighting: RouteLighting;
  /** 自动导览：开启后按预定轨迹驱动光照、时间与模型动画。 */
  autoTour: boolean;
};

/** 路线上的一个站点（场景节点）。 */
export type RouteStop = {
  id: string;
  /** i18n 文案 key，例如 `routes.silkRoad.stops.xian`。 */
  labelKey: string;
  /** 真实地理坐标，用于 2D 俯视图与后续场景定位。 */
  coord: { lat: number; lon: number };
};

/** 单条推荐路线的体验配置（驱动统一的子页面组件）。 */
export type RouteExperienceConfig = {
  /** URL slug，例如 `silk-road`。 */
  slug: string;
  /** 路线文案的 i18n 命名空间 key，例如 `routes.silkRoad`。 */
  i18nKey: string;
  /** 主题强调色（用于轨迹、标记物等）。 */
  accent: string;
  /** 占位背景图（场景模块完成前使用）。 */
  backgroundImage: string;
  /** 路线站点列表。 */
  stops: RouteStop[];
};
