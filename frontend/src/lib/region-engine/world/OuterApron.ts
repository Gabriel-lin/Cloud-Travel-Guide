/**
 * 外围裙带地形:主地形(4 km)边界外铺 8× 范围的真实卫星影像 + 粗 DEM,
 * 让区域边缘自然衔接到周边真实地貌,而不是露出雾底。
 *
 * - 几何:环形(四条矩形带)静态网格,顶点高度取粗 DEM;
 *   内缘 700 m 内高度渐混到主地形边缘采样(无缝),并伸入主地形下方
 *   60 m + 下沉,由主地形 skirt 遮住接缝。
 * - 材质:卫星影像直接作 albedo(拍摄时已含光照,粗糙度 1 无高光),
 *   夜晚随场景灯光压暗;远端交给指数雾融入天际。
 */

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  SRGBColorSpace,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { texture, uv } from "three/tsl";
import { fetchApronLayer, type ApronLayer } from "../geo/apron";
import type { Projector } from "../geo/project";
import { sampleCpu } from "../render/fields";
import type { WorldFields } from "../types";

/** 裙带外径 = 主地形的倍数 */
const OUTER_K = 8;
/** 伸入主地形下方的重叠带(米,防接缝漏光) */
const OVERLAP = 60;
/** 内缘高度渐混带宽(米) */
const BLEND_M = 700;

const smooth01 = (t: number): number => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

/** 一条矩形带:x0..x1 × z0..z1,分段随尺寸取 */
function buildStrip(
  layer: ApronLayer,
  fields: WorldFields,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
): BufferGeometry {
  const halfI = fields.size / 2;
  const segX = Math.max(4, Math.round((x1 - x0) / 320));
  const segZ = Math.max(4, Math.round((z1 - z0) / 320));
  const pos: number[] = [];
  const uvA: number[] = [];
  const idx: number[] = [];

  for (let j = 0; j <= segZ; j++) {
    const z = z0 + ((z1 - z0) * j) / segZ;
    for (let i = 0; i <= segX; i++) {
      const x = x0 + ((x1 - x0) * i) / segX;
      // 距主地形边界的外距(0 = 在边界/内部)
      const distOut = Math.max(Math.abs(x) - halfI, Math.abs(z) - halfI, 0);
      const w = smooth01(distOut / BLEND_M);
      const hCoarse = layer.heightOf(x, z);
      // 主地形边缘采样(位置钳入内域,即最近边界点的地形高)
      const cx = Math.min(Math.max(x, -halfI + 1), halfI - 1);
      const cz = Math.min(Math.max(z, -halfI + 1), halfI - 1);
      const hEdge =
        sampleCpu(fields.heights, cx, cz, fields.res, fields.size) + fields.baseAlt;
      // 重叠带下沉(躲进主地形下方,skirt 盖住)
      const sink = (1 - w) * 1.4;
      const y = hEdge * (1 - w) + hCoarse * w - fields.baseAlt - sink;
      pos.push(x, y, z);
      const [u, v] = layer.uvOf(x, z);
      uvA.push(u, v);
    }
  }
  const stride = segX + 1;
  for (let j = 0; j < segZ; j++) {
    for (let i = 0; i < segX; i++) {
      const a = j * stride + i;
      idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uvA), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * 构建外围裙带网格(数据后台拉取,失败返回 null,场景无裙带照常运行)。
 */
export async function createOuterApron(
  proj: Projector,
  fields: WorldFields,
): Promise<Mesh | null> {
  const layer = await fetchApronLayer(proj, fields.size * OUTER_K);
  if (!layer) return null;

  const halfI = fields.size / 2 - OVERLAP;
  const halfO = (fields.size * OUTER_K) / 2;

  const geo = mergeGeometries([
    buildStrip(layer, fields, -halfO, halfO, -halfO, -halfI), // 北
    buildStrip(layer, fields, -halfO, halfO, halfI, halfO), // 南
    buildStrip(layer, fields, -halfO, -halfI, -halfI, halfI), // 西
    buildStrip(layer, fields, halfI, halfO, -halfI, halfI), // 东
  ], false);

  const tex = new CanvasTexture(layer.imagery as unknown as HTMLCanvasElement);
  tex.colorSpace = SRGBColorSpace;
  tex.flipY = false; // uvOf 已按 GL 约定翻转 v
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;

  const mat = new MeshStandardNodeMaterial();
  // 影像自带拍摄光照:压一点避免与场景光叠加过曝
  mat.colorNode = texture(tex, uv()).xyz.mul(0.82);
  mat.roughness = 1;
  mat.metalness = 0;

  const mesh = new Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // 先画,主地形覆盖重叠带
  console.info(
    "[region-engine] outer apron imagery © Esri World Imagery (Earthstar Geographics)",
  );
  return mesh;
}
