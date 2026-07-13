/**
 * 经纬度 ↔ 局部米坐标投影。
 *
 * 4 km 量级区域用等距圆柱近似(误差 < 0.1%),原点为区域中心:
 * x = 东(米),z = 南(米)——北方向为 -z,与 three.js 默认相机(-z 前方)对齐。
 */

const M_PER_DEG_LAT = 111320;

export type Projector = {
  lat0: number;
  lon0: number;
  /** 每经度米数(随纬度收缩) */
  mPerDegLon: number;
  toLocal: (lat: number, lon: number) => [x: number, z: number];
  toLatLon: (x: number, z: number) => [lat: number, lon: number];
  /** 区域 bbox [south, west, north, east] */
  bbox: (sizeM: number) => [number, number, number, number];
};

export function createProjector(lat0: number, lon0: number): Projector {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  return {
    lat0,
    lon0,
    mPerDegLon,
    toLocal: (lat, lon) => [
      (lon - lon0) * mPerDegLon,
      -(lat - lat0) * M_PER_DEG_LAT,
    ],
    toLatLon: (x, z) => [lat0 - z / M_PER_DEG_LAT, lon0 + x / mPerDegLon],
    bbox: (sizeM) => {
      const dLat = sizeM / 2 / M_PER_DEG_LAT;
      const dLon = sizeM / 2 / mPerDegLon;
      return [lat0 - dLat, lon0 - dLon, lat0 + dLat, lon0 + dLon];
    },
  };
}

/** WebMercator 瓦片编号 */
export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

export function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
