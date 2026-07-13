/**
 * AWS Terrain Tiles(Terrarium 编码 DEM)抓取 + 解码 + 重采样。
 *
 * 编码:height = (R·256 + G + B/256) − 32768(米)。
 * 瓦片 256×256,取 zoom 使瓦片分辨率 ≈ 目标网格 texel,拼接后双线性重采样。
 */

import { GRID_RES, TERRARIUM_URL } from "../const";
import type { DemGrid } from "../types";
import { cacheGet, cacheSet } from "./cache";
import { latToTileY, lonToTileX, type Projector } from "./project";

const TILE_PX = 256;
const MAX_ZOOM = 15;

async function decodeTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  try {
    const resp = await fetch(TERRARIUM_URL(z, x, y));
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const bmp = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(TILE_PX, TILE_PX);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const img = ctx.getImageData(0, 0, TILE_PX, TILE_PX).data;
    const out = new Float32Array(TILE_PX * TILE_PX);
    for (let i = 0; i < out.length; i++) {
      const o = i * 4;
      out[i] = (img[o] as number) * 256 + (img[o + 1] as number) + (img[o + 2] as number) / 256 - 32768;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * 拉取区域 DEM 并重采样为 RES×RES 局部网格(行主序,x 东 → 列,z 南 → 行)。
 */
export async function fetchDem(
  proj: Projector,
  sizeM: number,
  onProgress?: (v: number) => void,
): Promise<DemGrid> {
  const cacheKey = `dem:${proj.lat0.toFixed(4)},${proj.lon0.toFixed(4)},${sizeM},${GRID_RES}`;
  const cached = await cacheGet<{ heights: Float32Array; minH: number; maxH: number }>(cacheKey);
  if (cached) {
    onProgress?.(1);
    return {
      heights: cached.heights,
      res: GRID_RES,
      size: sizeM,
      minH: cached.minH,
      maxH: cached.maxH,
    };
  }

  // zoom:瓦片像素 ≈ 网格 texel
  const texel = sizeM / GRID_RES;
  const mPerPxAtZ = (z: number) =>
    (156543.03392 * Math.cos((proj.lat0 * Math.PI) / 180)) / 2 ** z;
  let zoom = MAX_ZOOM;
  for (let z = 8; z <= MAX_ZOOM; z++) {
    if (mPerPxAtZ(z) <= texel * 1.2) {
      zoom = z;
      break;
    }
  }

  const [south, west, north, east] = proj.bbox(sizeM);
  const tx0 = Math.floor(lonToTileX(west, zoom));
  const tx1 = Math.floor(lonToTileX(east, zoom));
  const ty0 = Math.floor(latToTileY(north, zoom)); // 北纬更小的 tileY
  const ty1 = Math.floor(latToTileY(south, zoom));

  const nx = tx1 - tx0 + 1;
  const ny = ty1 - ty0 + 1;
  const stitched = new Float32Array(nx * TILE_PX * ny * TILE_PX);
  const stitchW = nx * TILE_PX;

  let done = 0;
  const total = nx * ny;
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(
        decodeTile(zoom, tx, ty).then((tile) => {
          if (tile) {
            const ox = (tx - tx0) * TILE_PX;
            const oy = (ty - ty0) * TILE_PX;
            for (let row = 0; row < TILE_PX; row++) {
              stitched.set(
                tile.subarray(row * TILE_PX, row * TILE_PX + TILE_PX),
                (oy + row) * stitchW + ox,
              );
            }
          }
          done++;
          onProgress?.(done / total);
        }),
      );
    }
  }
  await Promise.all(jobs);

  // 拼图 → 局部网格重采样(双线性;瓦片是 WebMercator 像素,直接经纬度插值)
  const heights = new Float32Array(GRID_RES * GRID_RES);
  let minH = Infinity;
  let maxH = -Infinity;
  for (let row = 0; row < GRID_RES; row++) {
    // 行 = z 南向:row 0 在北缘
    const zLocal = (row / (GRID_RES - 1) - 0.5) * sizeM;
    const [lat] = proj.toLatLon(0, zLocal);
    const py = (latToTileY(lat, zoom) - ty0) * TILE_PX;
    for (let col = 0; col < GRID_RES; col++) {
      const xLocal = (col / (GRID_RES - 1) - 0.5) * sizeM;
      const [, lon] = proj.toLatLon(xLocal, 0);
      const px = (lonToTileX(lon, zoom) - tx0) * TILE_PX;
      const x0 = Math.max(0, Math.min(Math.floor(px), stitchW - 2));
      const y0 = Math.max(0, Math.min(Math.floor(py), ny * TILE_PX - 2));
      const fx = Math.min(Math.max(px - x0, 0), 1);
      const fy = Math.min(Math.max(py - y0, 0), 1);
      const i00 = stitched[y0 * stitchW + x0] as number;
      const i10 = stitched[y0 * stitchW + x0 + 1] as number;
      const i01 = stitched[(y0 + 1) * stitchW + x0] as number;
      const i11 = stitched[(y0 + 1) * stitchW + x0 + 1] as number;
      const h = (i00 * (1 - fx) + i10 * fx) * (1 - fy) + (i01 * (1 - fx) + i11 * fx) * fy;
      heights[row * GRID_RES + col] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  await cacheSet(cacheKey, { heights, minH, maxH });
  return { heights, res: GRID_RES, size: sizeM, minH, maxH };
}
