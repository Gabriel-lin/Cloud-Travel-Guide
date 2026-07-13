/**
 * 叶簇图集烘焙(移植 LAAS `FoliageCards.captureFoliageAtlas`):
 *
 * 把一支茂密的真实枝簇 —— 几十片条带叶 / 针叶梳 —— 渲染一次进逐树种的
 * 2×2 变体图集;树上则在每个叶锚点放大卡片(alpha 测试)。一张卡片 =
 * 一整簇叶子只花 2–4 个三角形,冠层的茂密感即来源于此。
 *
 * 烘焙细节:透明背景 + CPU 侧 alpha 感知膨胀(防 mip 黑边),读回后翻转行
 * (WebGPU 读回为左上原点)。每树种一次,毫秒级,seed 确定可复现。
 */

import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  Quaternion,
  RenderTarget,
  Scene,
  Vector3,
} from "three";
import { MeshBasicNodeMaterial, type Renderer } from "three/webgpu";
import { abs, attribute, float, smoothstep, uv } from "three/tsl";
import type { NV4 } from "../gpu/tsl-types";
import type { SpeciesParams } from "./species";
import { Grower, buildLeaf, buildNeedleSpray, leafRgb } from "./treeBuilder";

export const ATLAS_RES = 512;

const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);

/** 一个 capture tile 的枝簇内容,tile 中心 (cx, cy),tile 尺寸 1 */
function buildTwigTile(
  g: Grower,
  sp: SpeciesParams,
  rng: () => number,
  cx: number,
  cy: number,
): void {
  const fol = sp.foliage;
  const half = 0.46;
  if (fol.kind === "needleSpray") {
    const brush = fol.leaf.brush > 0.5;
    // 主簇由 tile 底部向 +y 生长;针叶尺寸换算到 tile 单位
    const scaleToTile = (2 * half) / (fol.scale[1] * 1.15);
    const leaf = {
      ...fol.leaf,
      len: fol.leaf.len * scaleToTile,
      width: fol.leaf.width * scaleToTile * 1.15,
      needleCount: Math.round(fol.leaf.needleCount * (brush ? 1.4 : 1.2)),
    };
    const sprayLen = fol.scale[1] * scaleToTile;
    const sub = brush ? 6 : 9;
    for (let i = -1; i < sub; i++) {
      const t = i < 0 ? 0 : (i + 0.6) / sub;
      const along = -half + t * sprayLen * 0.8;
      const side = i < 0 ? 0 : i % 2 === 0 ? 1 : -1;
      const ang = i < 0 ? 0 : side * (0.75 + rng() * 0.65) * (brush ? 1.1 : 1);
      _q.setFromAxisAngle(Z, ang);
      _q2.setFromAxisAngle(X, -Math.PI / 2); // 局部 +z → tile +y
      _q.multiply(_q2);
      const s = i < 0 ? 1 : (0.5 + rng() * 0.32) * (1.1 - t * 0.35);
      _m.compose(
        new Vector3(cx + (i < 0 ? 0 : Math.sin(ang) * 0.06), cy + along, 0),
        _q,
        new Vector3(s, s, s),
      );
      const ao = 0.72 + rng() * 0.28;
      const rgb = leafRgb(fol.color, (rng() * 2 - 1) * fol.hueVar);
      buildNeedleSpray(
        g, _m, leaf, sprayLen * (i < 0 ? 1 : s * 0.8), rng,
        [rgb[0] * ao, rgb[1] * ao, rgb[2] * ao], 0.5,
      );
    }
  } else {
    // 阔叶簇:自底部展开的宽扇,14–20 片叶朝向 +z(相机)
    const n = 18 + ((rng() * 8) | 0);
    const leafScale = (2 * half) / (fol.leaf.len * 2.1);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const spread = 0.5 + t * 0.6;
      const ang = (rng() - 0.5) * 3.0 * spread;
      const r = (0.15 + t * 0.85) * half * (0.75 + rng() * 0.45);
      const px = cx + Math.sin(ang) * r;
      const py = cy - half * 0.82 + (t * 1.45 + rng() * 0.3) * half;
      // 朝向:叶片沿扇形方向,向相机倾斜
      _q.setFromAxisAngle(Z, ang * 0.8 + (rng() - 0.5) * 0.5);
      _q2.setFromAxisAngle(X, -Math.PI / 2 + 0.45 + (rng() - 0.3) * 0.7);
      _q.multiply(_q2);
      const s = leafScale * (0.75 + rng() * 0.5);
      _m.compose(new Vector3(px, py, (rng() - 0.5) * 0.05), _q, new Vector3(s, s, s));
      const ao = 0.65 + rng() * 0.35;
      const rgb = leafRgb(fol.color, (rng() * 2 - 1) * fol.hueVar);
      buildLeaf(g, _m, fol.leaf, [rgb[0] * ao, rgb[1] * ao, rgb[2] * ao], 0.5);
    }
  }
}

/** WebGPU 读回为左上原点;UV 空间要求 v=0 在底部 */
function flipRows(px: Uint8Array, w: number, h: number): void {
  const row = w * 4;
  const tmp = new Uint8Array(row);
  for (let y = 0; y < h >> 1; y++) {
    const a = y * row;
    const b = (h - 1 - y) * row;
    tmp.set(px.subarray(a, a + row));
    px.copyWithin(a, b, b + row);
    px.set(tmp, b);
  }
}

/** alpha 感知膨胀:把簇色渗进透明 texel(防 mip 黑边) */
function dilate(px: Uint8Array, res: number, passes: number): void {
  const idx = (x: number, y: number): number => (y * res + x) * 4;
  for (let p = 0; p < passes; p++) {
    const src = px.slice();
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const i = idx(x, y);
        if ((src[i + 3] as number) > 8) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= res || yy >= res) continue;
            const j = idx(xx, yy);
            if ((src[j + 3] as number) > 8) {
              r += src[j] as number;
              g += src[j + 1] as number;
              b += src[j + 2] as number;
              n++;
            }
          }
        }
        if (n > 0) {
          px[i] = Math.round(r / n);
          px[i + 1] = Math.round(g / n);
          px[i + 2] = Math.round(b / n);
          px[i + 3] = 9; // 标记已填充,后续 pass 继续外扩
        }
      }
    }
  }
  // 膨胀标记 alpha 不得通过 alpha 测试
  for (let i = 3; i < px.length; i += 4) {
    if ((px[i] as number) <= 9) px[i] = 0;
  }
}

/** LAAS 图集 sqrt 编码:线性 albedo → sqrt 存盘,运行时 t.rgb*t.rgb 解码 */
function sqrtEncode(px: Uint8Array): void {
  for (let i = 0; i < px.length; i += 4) {
    if ((px[i + 3] as number) < 4) continue;
    px[i] = Math.round(Math.sqrt((px[i] as number) / 255) * 255);
    px[i + 1] = Math.round(Math.sqrt((px[i + 1] as number) / 255) * 255);
    px[i + 2] = Math.round(Math.sqrt((px[i + 2] as number) / 255) * 255);
  }
}

/**
 * 渲染树种的枝簇图集(2×2 变体)并返回带 mipmap 的纹理。
 * 每树种一次;按 seed 流确定。
 */
export async function captureFoliageAtlas(
  renderer: Renderer,
  sp: SpeciesParams,
  rng: () => number,
): Promise<DataTexture> {
  const scene = new Scene();
  const g = new Grower();
  for (let v = 0; v < 4; v++) {
    buildTwigTile(g, sp, rng, (v % 2) - 0.5, Math.floor(v / 2) - 0.5);
  }
  // 主脉/梢端明暗烘入 albedo;读回后 CPU 做 sqrt 编码(LAAS 图集约定)
  const mat = new MeshBasicNodeMaterial();
  const col = (attribute("color") as unknown as NV4).xyz;
  const uvo = uv();
  const midrib = smoothstep(float(0.02), float(0.09), abs(uvo.x.sub(0.5)));
  const tip = smoothstep(float(0.5), float(0.96), uvo.y);
  const vein = midrib.mul(0.82).add(0.18);
  const albedo = col.mul(vein).mul(tip.mul(0.22).add(0.78));
  mat.colorNode = albedo;
  mat.side = 2; // DoubleSide
  mat.fog = false;
  const mesh = new Mesh(g.build(), mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const cam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.set(0, 0, 5);
  cam.lookAt(0, 0, 0);

  const rt = new RenderTarget(ATLAS_RES, ATLAS_RES);
  rt.texture.colorSpace = NoColorSpace;

  const prevTarget = renderer.getRenderTarget();
  const prevClearAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(rt);
  await renderer.renderAsync(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearAlpha(prevClearAlpha);

  const raw = (await renderer.readRenderTargetPixelsAsync(
    rt, 0, 0, ATLAS_RES, ATLAS_RES,
  )) as Uint8Array;
  const px = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  flipRows(px, ATLAS_RES, ATLAS_RES);
  sqrtEncode(px);
  dilate(px, ATLAS_RES, 6);
  rt.dispose();
  mat.dispose();

  const tex = new DataTexture(px, ATLAS_RES, ATLAS_RES);
  tex.colorSpace = NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
