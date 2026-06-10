import * as THREE from "three";

/**
 * 3D 地球的地理数学工具(球面模型,与 Web Mercator 切片一致)。
 *
 * 采用球面(半径取 Web Mercator 基准半径)而非椭球,保证切片经纬度与几何对齐;
 * 坐标系约定:+Y 为北极,经度绕 Y 轴。
 */

/** Web Mercator 基准地球半径(米)。 */
export const EARTH_RADIUS = 6378137;

/** Web Mercator 有效纬度上限(度);更高纬度需极点补盖。 */
export const MAX_MERCATOR_LAT = 85.05112877980659;

const DEG2RAD = Math.PI / 180;
const MAX_MERCATOR_LAT_RAD = MAX_MERCATOR_LAT * DEG2RAD;

/** 将经纬度(弧度)+ 海拔(米)转换为 ECEF 坐标(+Y 朝北)。 */
export function lonLatToVec3(
  lonRad: number,
  latRad: number,
  height: number,
  target: THREE.Vector3,
): THREE.Vector3 {
  const r = EARTH_RADIUS + height;
  const cosLat = Math.cos(latRad);
  return target.set(
    r * cosLat * Math.cos(lonRad),
    r * Math.sin(latRad),
    -r * cosLat * Math.sin(lonRad),
  );
}

/** 将 ECEF 坐标转换为经纬度(度)与海拔(米)。 */
export function vec3ToLonLat(pos: THREE.Vector3): {
  lat: number;
  lon: number;
  height: number;
} {
  const r = pos.length() || 1;
  const lat = Math.asin(THREE.MathUtils.clamp(pos.y / r, -1, 1)) / DEG2RAD;
  const lon = Math.atan2(-pos.z, pos.x) / DEG2RAD;
  return { lat, lon, height: r - EARTH_RADIUS };
}

/** 归一化墨卡托坐标(0..1)→ 经纬度(弧度)。my=0 为北。 */
export function mercatorToLonLat(mx: number, my: number): {
  lonRad: number;
  latRad: number;
} {
  const lonRad = mx * 2 * Math.PI - Math.PI;
  const myClamped = THREE.MathUtils.clamp(my, 0, 1);
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * myClamped)));
  return { lonRad, latRad };
}

/** 瓦片是否为最北/最南行(需补极点扇形)。 */
export function tilePolarKind(
  z: number,
  y: number,
): "north" | "south" | null {
  const n = tilesAtZoom(z);
  if (y === 0) return "north";
  if (y === n - 1) return "south";
  return null;
}

/** 某缩放级别下每行/列的瓦片数。 */
export function tilesAtZoom(zoom: number): number {
  return 2 ** zoom;
}

/** 瓦片中心的经纬度(弧度)。 */
export function tileCenterLonLat(
  z: number,
  x: number,
  y: number,
): { lonRad: number; latRad: number } {
  const n = tilesAtZoom(z);
  return mercatorToLonLat((x + 0.5) / n, (y + 0.5) / n);
}

/** 瓦片在其中心纬度处的近似地面边长(米)。 */
export function tileGroundSize(z: number, latRad: number): number {
  const n = tilesAtZoom(z);
  return ((2 * Math.PI * EARTH_RADIUS) / n) * Math.cos(latRad);
}

/** 经度(度)→ 分数瓦片 X。 */
export function lonToTileX(lonDeg: number, zoom: number): number {
  return ((lonDeg + 180) / 360) * tilesAtZoom(zoom);
}

/** 纬度(度)→ 分数瓦片 Y。 */
export function latToTileY(latDeg: number, zoom: number): number {
  const latRad = latDeg * DEG2RAD;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    tilesAtZoom(zoom)
  );
}
