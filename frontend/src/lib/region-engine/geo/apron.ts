/**
 * 外围衔接层数据:真实卫星影像 + 粗采样 DEM。
 *
 * 主地形(4 km)边界外露白很生硬 —— 拉一圈 8× 范围的 Esri World Imagery
 * 卫星影像和低 zoom Terrarium DEM,拼成"裙带地形"的贴图与高度采样器。
 * 影像/高程都按瓦片 HTTP 缓存,失败静默降级(返回 null,场景不挂裙带)。
 */

import { ESRI_IMAGERY_URL, TERRARIUM_URL } from "../const";
import { latToTileY, lonToTileX, type Projector } from "./project";

const TILE_PX = 256;

/** 米/像素(WebMercator,随纬度收缩) */
function mPerPx(lat: number, z: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** 覆盖 bbox 的瓦片范围 */
function tileRange(
  bbox: [number, number, number, number],
  zoom: number,
): { tx0: number; tx1: number; ty0: number; ty1: number } {
  const [south, west, north, east] = bbox;
  return {
    tx0: Math.floor(lonToTileX(west, zoom)),
    tx1: Math.floor(lonToTileX(east, zoom)),
    ty0: Math.floor(latToTileY(north, zoom)),
    ty1: Math.floor(latToTileY(south, zoom)),
  };
}

async function fetchBitmap(url: string): Promise<ImageBitmap | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await createImageBitmap(await resp.blob());
  } catch {
    return null;
  }
}

/** Terrarium 解码:height = R·256 + G + B/256 − 32768 */
async function fetchDemTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const bmp = await fetchBitmap(TERRARIUM_URL(z, x, y));
  if (!bmp) return null;
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
}

export type ApronLayer = {
  /** 拼好的卫星影像画布 */
  imagery: OffscreenCanvas;
  /** 局部米坐标 → 影像 uv(v 已翻转为 GL 约定,texture.flipY 须为 false) */
  uvOf: (x: number, z: number) => [u: number, v: number];
  /** 局部米坐标 → 绝对海拔(米,双线性) */
  heightOf: (x: number, z: number) => number;
};

/**
 * 拉取外围衔接层(影像 ~25 瓦片、DEM 1~4 瓦片,全部并行)。
 * 任一影像瓦片失败留黑块;DEM 全失败时返回 null。
 */
export async function fetchApronLayer(
  proj: Projector,
  outerSize: number,
): Promise<ApronLayer | null> {
  const bbox = proj.bbox(outerSize);

  // ---- 卫星影像:m/px ≈ outer/1200(背景层精度足够,~5×5 瓦片) ----
  let imgZoom = 14;
  for (let z = 6; z <= 14; z++) {
    if (mPerPx(proj.lat0, z) <= outerSize / 1200) {
      imgZoom = z;
      break;
    }
  }
  const ir = tileRange(bbox, imgZoom);
  const iw = (ir.tx1 - ir.tx0 + 1) * TILE_PX;
  const ih = (ir.ty1 - ir.ty0 + 1) * TILE_PX;
  const imagery = new OffscreenCanvas(iw, ih);
  const ictx = imagery.getContext("2d");
  if (!ictx) return null;
  ictx.fillStyle = "#22282f";
  ictx.fillRect(0, 0, iw, ih);

  // ---- 粗 DEM:m/px ≈ 顶点间距(~300 m) ----
  let demZoom = 11;
  for (let z = 5; z <= 11; z++) {
    if (mPerPx(proj.lat0, z) <= outerSize / 110) {
      demZoom = z;
      break;
    }
  }
  const dr = tileRange(bbox, demZoom);
  const dw = (dr.tx1 - dr.tx0 + 1) * TILE_PX;
  const dh = (dr.ty1 - dr.ty0 + 1) * TILE_PX;
  const dem = new Float32Array(dw * dh);
  let demOk = false;

  const jobs: Promise<void>[] = [];
  for (let ty = ir.ty0; ty <= ir.ty1; ty++) {
    for (let tx = ir.tx0; tx <= ir.tx1; tx++) {
      jobs.push(
        fetchBitmap(ESRI_IMAGERY_URL(imgZoom, tx, ty)).then((bmp) => {
          if (!bmp) return;
          ictx.drawImage(bmp, (tx - ir.tx0) * TILE_PX, (ty - ir.ty0) * TILE_PX);
          bmp.close();
        }),
      );
    }
  }
  for (let ty = dr.ty0; ty <= dr.ty1; ty++) {
    for (let tx = dr.tx0; tx <= dr.tx1; tx++) {
      jobs.push(
        fetchDemTile(demZoom, tx, ty).then((tile) => {
          if (!tile) return;
          demOk = true;
          const ox = (tx - dr.tx0) * TILE_PX;
          const oy = (ty - dr.ty0) * TILE_PX;
          for (let row = 0; row < TILE_PX; row++) {
            dem.set(tile.subarray(row * TILE_PX, row * TILE_PX + TILE_PX), (oy + row) * dw + ox);
          }
        }),
      );
    }
  }
  await Promise.all(jobs);
  if (!demOk) return null;

  const uvOf = (x: number, z: number): [number, number] => {
    const [lat, lon] = proj.toLatLon(x, z);
    const px = (lonToTileX(lon, imgZoom) - ir.tx0) * TILE_PX;
    const py = (latToTileY(lat, imgZoom) - ir.ty0) * TILE_PX;
    return [px / iw, 1 - py / ih];
  };

  const heightOf = (x: number, z: number): number => {
    const [lat, lon] = proj.toLatLon(x, z);
    const px = (lonToTileX(lon, demZoom) - dr.tx0) * TILE_PX;
    const py = (latToTileY(lat, demZoom) - dr.ty0) * TILE_PX;
    const x0 = Math.max(0, Math.min(Math.floor(px), dw - 2));
    const y0 = Math.max(0, Math.min(Math.floor(py), dh - 2));
    const fx = Math.min(Math.max(px - x0, 0), 1);
    const fy = Math.min(Math.max(py - y0, 0), 1);
    const h00 = dem[y0 * dw + x0] as number;
    const h10 = dem[y0 * dw + x0 + 1] as number;
    const h01 = dem[(y0 + 1) * dw + x0] as number;
    const h11 = dem[(y0 + 1) * dw + x0 + 1] as number;
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  };

  return { imagery, uvOf, heightOf };
}
