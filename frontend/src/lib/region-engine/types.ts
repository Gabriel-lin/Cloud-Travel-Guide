/** 区域地形引擎公共类型。 */

export type SceneMode = "walk" | "fly";
export type TimeOfDay = "day" | "night";

export type RegionParams = {
  lat: number;
  lon: number;
  /** 渲染区域边长(km),默认 4 */
  sizeKm?: number;
  mode: SceneMode;
  timeOfDay: TimeOfDay;
  /** 程序化细节种子;默认由经纬度导出(可复现) */
  seed?: number;
};

export type BootStatus =
  | "idle"
  | "fetching-dem"
  | "fetching-osm"
  | "gpu-bake"
  | "building"
  | "ready"
  | "error";

/** DEM 重采样结果(局部网格) */
export type DemGrid = {
  /** RES×RES 海拔(米,绝对) */
  heights: Float32Array;
  res: number;
  /** 区域边长(米) */
  size: number;
  minH: number;
  maxH: number;
};

/** 局部米坐标折线/环:[x0, z0, x1, z1, ...] */
export type Coords = Float64Array;

export type BuildingFoot = {
  ring: Coords;
  /** 挑出的建筑高度(米) */
  height: number;
};

export type RiverKind = "river" | "stream" | "canal";

export type RiverLine = {
  pts: Coords;
  /** 河面宽度(米,已含逐河哈希扰动) */
  width: number;
  /** 稳定 id(OSM way id 哈希),驱动逐河唯一的深度/流速 */
  id: number;
  kind: RiverKind;
};

export type LandKind =
  | "water"
  | "forest"
  | "farmland"
  | "urban"
  | "sand"
  | "scrub"
  | "grass"
  | "wetland";

export type LandPoly = {
  ring: Coords;
  kind: LandKind;
};

export type OsmData = {
  buildings: BuildingFoot[];
  rivers: RiverLine[];
  land: LandPoly[];
};

/** 光栅化遮罩(全部 RES×RES,行主序,x 东 z 南) */
export type RegionMasks = {
  res: number;
  size: number;
  /** 水体(湖泊/宽河面多边形)0..1 */
  water: Float32Array;
  /** 河道:0..1 河床剖面(1=河中心) */
  riverProfile: Float32Array;
  /** 流向(单位向量),非河道处为 0 */
  flowX: Float32Array;
  flowZ: Float32Array;
  /** 逐河 0..1 哈希(深度/流速扰动) */
  riverHash: Float32Array;
  forest: Float32Array;
  farmland: Float32Array;
  urban: Float32Array;
  sand: Float32Array;
  scrub: Float32Array;
  wetland: Float32Array;
  /** OSM 草地/牧场(landuse=meadow|grass, natural=grassland)0..1 */
  grass: Float32Array;
};

/** boot 完成后的世界数据(渲染与交互共用) */
export type WorldFields = {
  res: number;
  size: number;
  seed: number;
  /** 最终高度(米,相对 minH),CPU 镜像 */
  heights: Float32Array;
  /** 水面高度(米,相对 minH);无水处为大负值哨兵 */
  waterY: Float32Array;
  /** 湿度 0..1 */
  moisture: Float32Array;
  /** 生物群系 id */
  biome: Uint8Array;
  /** 雪覆盖 0..1 */
  snow: Float32Array;
  /** 植被密度 0..1 */
  vegDensity: Float32Array;
  /** 高度基准(绝对海拔 = heights + baseAlt) */
  baseAlt: number;
  masks: RegionMasks;
};

export type BootProgress = {
  status: BootStatus;
  /** 0..1 总进度 */
  value: number;
  detail?: string;
};
