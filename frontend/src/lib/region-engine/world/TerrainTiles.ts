/**
 * CDLOD 四叉树地形瓦片(移植 LAAS `TerrainTiles.ts`)。
 *
 * - 单个 InstancedMesh 绘制全部活动瓦片;每瓦片 (origin, size, lod) 存
 *   InstancedBufferAttribute,仅相机移动超阈值时重建四叉树 —— 无逐帧逐实例 CPU 更新。
 * - CDLOD 顶点形变:奇数顶点在 LOD 环外带滑向偶数网格位 → 无裂缝无跳变。
 * - skirt 裙边:±0.5 外一圈顶点钳到边缘再下落,遮住非均匀分裂的缝隙。
 */

import { InstancedBufferAttribute, InstancedMesh, PerspectiveCamera, PlaneGeometry } from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  float,
  fract,
  instancedBufferAttribute,
  mix,
  vec3,
} from "three/tsl";
import { positionLocal } from "three/tsl";
import type { NF, NV2, NV4 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import { sampleCpu, sampleFloatBilinear, type WorldTextures } from "../render/fields";
import { buildTerrainShading } from "../render/terrainMaterial";

const MAX_TILES = 1200;
const PATCH_SEGS = 32;
/** camDist < size·SPLIT_K 时分裂 */
const SPLIT_K = 2.1;
const MIN_TILE = 32;

export class TerrainTiles {
  readonly mesh: InstancedMesh;
  activeTiles = 0;

  private tileData: Float32Array;
  private tileAttr: InstancedBufferAttribute;
  private heights: Float32Array;
  private res: number;
  private size: number;
  private lastCamX = Infinity;
  private lastCamZ = Infinity;

  constructor(
    tex: WorldTextures,
    env: EnvState,
    heights: Float32Array,
    opts: { cloudShadow?: (wpos: NV2) => NF } = {},
  ) {
    this.heights = heights;
    this.res = tex.res;
    this.size = tex.size;

    this.tileData = new Float32Array(MAX_TILES * 4);
    this.tileAttr = new InstancedBufferAttribute(this.tileData, 4);

    // --- patch 几何:±0.5 外一圈 skirt 顶点 ---
    const s = 1 / PATCH_SEGS;
    const patch = new PlaneGeometry(1 + 2 * s, 1 + 2 * s, PATCH_SEGS + 2, PATCH_SEGS + 2);
    patch.rotateX(-Math.PI / 2); // 局部 xz ∈ [-0.5-s, 0.5+s],+y 上

    const mat = new MeshStandardNodeMaterial();
    mat.metalness = 0;

    const tile = instancedBufferAttribute(this.tileAttr) as unknown as NV4;
    const tileOrigin = tile.xy;
    const tileSize = tile.z;

    // CDLOD 形变 + skirt
    const rawLocal = positionLocal.xz;
    const clampedLocal = clamp(rawLocal, -0.5, 0.5);
    const isSkirt = rawLocal
      .abs()
      .x.max(rawLocal.abs().y)
      .greaterThan(0.5001)
      .select(float(1), float(0));
    const local = clampedLocal.mul(tileSize);
    const wpos0 = local.add(tileOrigin).toVar();
    const quad = tileSize.div(PATCH_SEGS);
    const gridUV = clampedLocal.add(0.5).mul(PATCH_SEGS);
    const odd = fract(gridUV.mul(0.5)).mul(2); // 奇数顶点=1
    const snapped = wpos0.sub(odd.mul(quad));
    const camD = wpos0.sub(cameraPosition.xz).length();
    const rangeEnd = tileSize.mul(SPLIT_K).mul(2);
    const morphK = clamp(camD.sub(rangeEnd.mul(0.7)).div(rangeEnd.mul(0.24)), 0, 1);
    const wpos = mix(wpos0, snapped, morphK);

    const skirtDrop = isSkirt.mul(tileSize.mul(0.045).add(2.5));
    const h = sampleFloatBilinear(tex.heightTex, wpos, this.res, this.size).sub(skirtDrop);
    mat.positionNode = vec3(wpos.x, h, wpos.y);

    const shading = buildTerrainShading(tex, env, opts);
    mat.colorNode = shading.colorNode;
    mat.normalNode = shading.normalNode;
    mat.roughnessNode = shading.roughnessNode;

    this.mesh = new InstancedMesh(patch, mat, MAX_TILES);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;

    patch.setAttribute("tileData", this.tileAttr);
  }

  heightAtCpu(x: number, z: number): number {
    return sampleCpu(this.heights, x, z, this.res, this.size);
  }

  /** 相机移动超 20 m 时重建四叉树 */
  update(camera: PerspectiveCamera): void {
    const cx = camera.position.x;
    const cz = camera.position.z;
    if (Math.hypot(cx - this.lastCamX, cz - this.lastCamZ) < 20 && this.activeTiles > 0) {
      return;
    }
    this.lastCamX = cx;
    this.lastCamZ = cz;

    let n = 0;
    const data = this.tileData;
    const emit = (ox: number, oz: number, size: number, lod: number): void => {
      if (n >= MAX_TILES) return;
      data[n * 4] = ox;
      data[n * 4 + 1] = oz;
      data[n * 4 + 2] = size;
      data[n * 4 + 3] = lod;
      n++;
    };
    const cy = camera.position.y;
    const recurse = (ox: number, oz: number, size: number, lod: number): void => {
      const dx = Math.max(Math.abs(cx - ox) - size / 2, 0);
      const dz = Math.max(Math.abs(cz - oz) - size / 2, 0);
      // 三维距离:高空俯视时正下方无需 MIN_TILE 细分
      const groundY = this.heightAtCpu(ox, oz);
      const dy = Math.max(Math.abs(cy - groundY) - 200, 0) * 0.8;
      const dist = Math.hypot(dx, dz, dy);
      if (size > MIN_TILE && dist < size * SPLIT_K) {
        const q = size / 4;
        const h = size / 2;
        recurse(ox - q, oz - q, h, lod + 1);
        recurse(ox + q, oz - q, h, lod + 1);
        recurse(ox - q, oz + q, h, lod + 1);
        recurse(ox + q, oz + q, h, lod + 1);
      } else {
        emit(ox, oz, size, lod);
      }
    };
    recurse(0, 0, this.size, 0);

    this.activeTiles = n;
    this.mesh.count = n;
    this.tileAttr.needsUpdate = true;
  }
}
