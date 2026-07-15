/**
 * 区域地形引擎全局常量。
 *
 * 世界坐标约定:x = 东(米),z = 南(米),y = 海拔(米,相对区域最低点)。
 * 高度场网格:RES×RES,覆盖 size×size 米,texel = size/RES。
 */

/** 高度场/遮罩网格分辨率(边长格数) */
export const GRID_RES = 1024;

/** 默认渲染区域边长(km) */
export const DEFAULT_SIZE_KM = 4;

/** 侵蚀模拟迭代次数(WebGPU 路径) */
export const EROSION_ITERS = 240;

/** 植被散布分块尺寸(米)——LOD 环与视锥剔除的粒度 */
export const CHUNK_SIZE = 128;

/** 树近景网格 → impostor 的切换距离(米) */
export const TREE_MESH_DIST = 240;

/** 植被最远渲染距离(米) */
export const TREE_FAR_DIST = 2600;

/** 雪线基准海拔(米,绝对海拔;按温度模型再修正) */
export const SNOWLINE_ALT = 4400;

/** Terrarium DEM 瓦片服务 */
export const TERRARIUM_URL = (z: number, x: number, y: number): string =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/** Esri World Imagery 卫星影像瓦片(外围衔接层背景;注意 y 在 x 前) */
export const ESRI_IMAGERY_URL = (z: number, x: number, y: number): string =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

/** Overpass API 端点(依次重试) */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** 生物群系 id(biomeTex.r × 8) */
export const BIOME = {
  meadow: 0,
  forest: 1,
  rainforest: 2,
  farmland: 3,
  urban: 4,
  desert: 5,
  alpine: 6,
  wetland: 7,
} as const;

export type BiomeId = (typeof BIOME)[keyof typeof BIOME];
