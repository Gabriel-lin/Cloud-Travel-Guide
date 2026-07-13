/**
 * 植被渲染系统:近景实例网格环 + 远景 impostor(LAAS LOD 环的双层简化)。
 *
 * - 近景:每 (树种, 结构变体) 一对 InstancedMesh —— bark(枝干)+ cards
 *   (叶簇卡片,逐树种 2×2 图集 alpha 测试)—— 共享同一组实例属性;
 *   相机移动超 24 m 时从散布层的 chunk 索引重填(数百实例量级,亚毫秒)。
 * - 远景(240 m~2.6 km):每树种一个静态 impostor InstancedMesh(全部实例常驻,
 *   顶点阶段按相机距离做环切换淡入淡出 —— 零逐帧 CPU)。
 * - 灌木/农作物:同一套池机制,更小的近景半径(农作物无卡片,纯网格)。
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  PerspectiveCamera,
  PlaneGeometry,
  type Texture,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshBasicNodeMaterial, type Renderer } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  instancedBufferAttribute,
  mix,
  positionLocal,
  smoothstep,
  texture,
  uv,
  vec3,
} from "three/tsl";
import { CHUNK_SIZE, TREE_FAR_DIST, TREE_MESH_DIST } from "../const";
import type { NF, NV4 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import {
  buildVegPool,
  makeVegInstances,
  type VegInstances,
} from "../render/vegMaterial";
import type { WorldFields } from "../types";
import { captureFoliageAtlas } from "../veg/foliageAtlas";
import { bakeImpostor } from "../veg/impostor";
import {
  INSTANCE_STRIDE,
  type ScatterLayer,
  type ScatterResult,
} from "../veg/scatter";
import {
  SHRUB,
  TREE_SPECIES,
  VARIANTS_PER_SPECIES,
  type SpeciesParams,
} from "../veg/species";
import { buildTreeGeometry, makeRng, type BuiltTree } from "../veg/treeBuilder";

const SHRUB_MESH_DIST = 150;
const CROP_MESH_DIST = 220;
const TREE_POOL_CAP = 640;
const SHRUB_POOL_CAP = 1792;
const CROP_POOL_CAP = 4608;
const REPACK_MOVE = 24;

type NearPool = {
  /** bark 与 cards 共享实例属性;cards 可为空(农作物) */
  meshes: InstancedMesh[];
  inst: VegInstances;
};

type LayerRuntime = {
  layer: ScatterLayer;
  pools: NearPool[]; // 按 variant 索引
  radius: number;
};

/** 农作物:交叉双面片(水稻/油菜量级) */
function buildCropGeometry(seed: number): BufferGeometry {
  const rng = makeRng(seed);
  const h = 0.9 + rng() * 0.35;
  const mk = (rotY: number) => {
    const p = new PlaneGeometry(0.75, h, 1, 2);
    p.translate(0, h / 2, 0);
    p.rotateY(rotY);
    return p;
  };
  const geo = mergeGeometries([mk(0), mk(Math.PI / 2)], false);
  const pos = geo.getAttribute("position");
  const n = pos.count;
  // RGBA:rgb = 颜色,w = 相对高度(风悬臂剖面)
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = pos.getY(i) / h;
    colors[i * 4] = 0.26 + t * 0.1 + (rng() - 0.5) * 0.05;
    colors[i * 4 + 1] = 0.4 + t * 0.14;
    colors[i * 4 + 2] = 0.1 + t * 0.04;
    colors[i * 4 + 3] = t;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 4));
  return geo;
}

export class Vegetation {
  readonly group = new Group();
  private layers: LayerRuntime[] = [];
  private lastX = Infinity;
  private lastZ = Infinity;
  private size: number;

  constructor(
    private renderer: Renderer,
    private env: EnvState,
    world: WorldFields,
    private scatter: ScatterResult,
  ) {
    this.size = world.size;
  }

  /** 烘图集 + 建几何 + 烘 impostor + 建实例池(boot 一次) */
  async init(): Promise<void> {
    for (const [speciesId, layer] of this.scatter.trees) {
      if (layer.count === 0) continue;
      const sp = TREE_SPECIES[speciesId];

      // 1. 叶簇图集(每树种一次)
      const atlas = await captureFoliageAtlas(
        this.renderer, sp, makeRng(speciesId.length * 733 + 41),
      );

      // 2. 结构变体 + 近景池
      const variants: BuiltTree[] = [];
      const pools: NearPool[] = [];
      for (let v = 0; v < VARIANTS_PER_SPECIES; v++) {
        const built = buildTreeGeometry(sp, v * 7919 + speciesId.length * 131 + 17);
        variants.push(built);
        pools.push(this.makeNearPool(built, atlas, TREE_POOL_CAP, sp, true));
      }
      this.layers.push({ layer, pools, radius: TREE_MESH_DIST });

      // 3. 远景 impostor(变体 0 烘焙,宽高取几何真实包围盒)
      const v0 = variants[0] as BuiltTree;
      await this.makeImpostors(v0, atlas, layer, TREE_MESH_DIST, TREE_FAR_DIST);
    }

    // 灌木(同一套图集卡片方案)
    if (this.scatter.shrubs.count > 0) {
      const atlas = await captureFoliageAtlas(this.renderer, SHRUB, makeRng(9127));
      const pools: NearPool[] = [];
      for (let v = 0; v < VARIANTS_PER_SPECIES; v++) {
        const built = buildTreeGeometry(SHRUB, v * 5417 + 907);
        pools.push(this.makeNearPool(built, atlas, SHRUB_POOL_CAP, SHRUB, false));
      }
      this.layers.push({ layer: this.scatter.shrubs, pools, radius: SHRUB_MESH_DIST });
    }

    // 农作物(纯网格,无卡片)
    if (this.scatter.crops.count > 0) {
      const pools: NearPool[] = [];
      for (let v = 0; v < VARIANTS_PER_SPECIES; v++) {
        const inst = makeVegInstances(CROP_POOL_CAP / 4);
        const pool = buildVegPool(buildCropGeometry(v * 2221 + 5), this.env, inst, {
          windAmp: 0.09,
          flutterAmp: 0.02,
          leafK: 1,
        });
        const mesh = new InstancedMesh(pool.geometry, pool.material, inst.capacity);
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.count = 0;
        this.group.add(mesh);
        pools.push({ meshes: [mesh], inst });
      }
      this.layers.push({ layer: this.scatter.crops, pools, radius: CROP_MESH_DIST });
    }
  }

  /** bark + cards 双网格池(共享实例属性) */
  private makeNearPool(
    built: BuiltTree,
    atlas: Texture,
    capacity: number,
    sp: SpeciesParams,
    castShadow: boolean,
  ): NearPool {
    const inst = makeVegInstances(capacity);
    const windAmp = sp.culms ? 0.5 : 0.4;

    const barkPool = buildVegPool(built.bark, this.env, inst, {
      windAmp: windAmp * 0.7,
      flutterAmp: 0,
      leafK: 0,
      barkStyle: sp.barkStyle,
      barkSeed: sp.id.length * 17,
    });
    const barkMesh = new InstancedMesh(barkPool.geometry, barkPool.material, capacity);

    const cardPool = buildVegPool(built.cards, this.env, inst, {
      windAmp,
      flutterAmp: 0.05,
      atlas,
      leafK: 1,
      foliageHueVar: sp.foliage.hueVar,
    });
    const cardMesh = new InstancedMesh(cardPool.geometry, cardPool.material, capacity);

    for (const mesh of [barkMesh, cardMesh]) {
      mesh.frustumCulled = false;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = false;
      mesh.count = 0;
      this.group.add(mesh);
    }
    return { meshes: [barkMesh, cardMesh], inst };
  }

  private async makeImpostors(
    built: BuiltTree,
    atlas: Texture,
    layer: ScatterLayer,
    nearDist: number,
    farDist: number,
  ): Promise<void> {
    const bake = await bakeImpostor(this.renderer, built.bark, built.cards, atlas);
    const quad = new PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0); // 底部锚定

    const instA = new InstancedBufferAttribute(new Float32Array(layer.count * 4), 4);
    const instB = new InstancedBufferAttribute(new Float32Array(layer.count * 4), 4);
    for (let i = 0; i < layer.count; i++) {
      const o = i * INSTANCE_STRIDE;
      instA.array[i * 4] = layer.data[o] as number;
      instA.array[i * 4 + 1] = layer.data[o + 1] as number;
      instA.array[i * 4 + 2] = layer.data[o + 2] as number;
      instA.array[i * 4 + 3] = layer.data[o + 3] as number;
      instB.array[i * 4] = layer.data[o + 8] as number; // hue
      instB.array[i * 4 + 1] = layer.data[o + 7] as number; // phase
    }
    quad.setAttribute("instA", instA);
    quad.setAttribute("instB", instB);

    const mat = new MeshBasicNodeMaterial();
    mat.transparent = false;
    mat.alphaTest = 0.42;
    mat.fog = true;

    const a = instancedBufferAttribute(instA) as unknown as NV4;
    const b = instancedBufferAttribute(instB) as unknown as NV4;
    const instPos = a.xyz;
    const toCam = cameraPosition.sub(instPos).toVar();
    const dist = toCam.xz.length().toVar();
    // 环切换:近于网格环隐藏,远于可视半径淡出
    const fadeIn = smoothstep(nearDist * 0.78, nearDist * 0.95, dist);
    const fadeOut = smoothstep(farDist, farDist * 0.85, dist);
    const k = fadeIn.mul(fadeOut).toVar();
    const fwd = vec3(toCam.x, 0, toCam.z).normalize();
    const right = vec3(fwd.z.negate(), 0, fwd.x);
    const w = a.w.mul(bake.width).mul(k);
    const h = a.w.mul(bake.height).mul(k);
    mat.positionNode = instPos
      .add(right.mul(positionLocal.x.mul(w)))
      .add(vec3(0, positionLocal.y.mul(h), 0));

    const tex = texture(bake.texture, uv());
    const hueShift = b.x.sub(0.5).mul(0.3);
    const light = mix(1.0, 0.16, this.env.nightK);
    const col = vec3(
      tex.x.mul(hueShift.mul(0.8).add(1)),
      tex.y.mul(hueShift.mul(-0.4).add(1)),
      tex.z.mul(hueShift.mul(-0.5).add(1)),
    ).mul(light);
    mat.colorNode = clamp(col, 0, 4);
    mat.opacityNode = tex.w as NF;

    const mesh = new InstancedMesh(quad, mat, layer.count);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
  }

  /** 近景环重填(相机移动超阈值时) */
  update(camera: PerspectiveCamera): void {
    const cx = camera.position.x;
    const cz = camera.position.z;
    if (Math.hypot(cx - this.lastX, cz - this.lastZ) < REPACK_MOVE) return;
    this.lastX = cx;
    this.lastZ = cz;

    const chunksX = Math.ceil(this.size / CHUNK_SIZE);
    for (const rt of this.layers) {
      const counts = rt.pools.map(() => 0);
      const r = rt.radius;
      const c0x = Math.max(Math.floor((cx - r + this.size / 2) / CHUNK_SIZE), 0);
      const c1x = Math.min(Math.floor((cx + r + this.size / 2) / CHUNK_SIZE), chunksX - 1);
      const c0z = Math.max(Math.floor((cz - r + this.size / 2) / CHUNK_SIZE), 0);
      const c1z = Math.min(Math.floor((cz + r + this.size / 2) / CHUNK_SIZE), chunksX - 1);
      const r2 = r * r;
      for (let gz = c0z; gz <= c1z; gz++) {
        for (let gx = c0x; gx <= c1x; gx++) {
          const range = rt.layer.chunkIndex.get(gz * chunksX + gx);
          if (!range) continue;
          const [start, count] = range;
          for (let i = start; i < start + count; i++) {
            const o = i * INSTANCE_STRIDE;
            const x = rt.layer.data[o] as number;
            const z = rt.layer.data[o + 2] as number;
            const dx = x - cx;
            const dz = z - cz;
            if (dx * dx + dz * dz > r2) continue;
            const variant = (rt.layer.data[o + 9] as number) | 0;
            const pool = rt.pools[variant % rt.pools.length] as NearPool;
            const n = counts[variant % rt.pools.length] as number;
            if (n >= pool.inst.capacity) continue;
            const aArr = pool.inst.instA.array as Float32Array;
            const bArr = pool.inst.instB.array as Float32Array;
            const hArr = pool.inst.instHue.array as Float32Array;
            aArr[n * 4] = x;
            aArr[n * 4 + 1] = rt.layer.data[o + 1] as number;
            aArr[n * 4 + 2] = z;
            aArr[n * 4 + 3] = rt.layer.data[o + 3] as number;
            bArr[n * 4] = rt.layer.data[o + 4] as number;
            bArr[n * 4 + 1] = rt.layer.data[o + 5] as number;
            bArr[n * 4 + 2] = rt.layer.data[o + 6] as number;
            bArr[n * 4 + 3] = rt.layer.data[o + 7] as number;
            hArr[n] = rt.layer.data[o + 8] as number;
            counts[variant % rt.pools.length] = n + 1;
          }
        }
      }
      rt.pools.forEach((pool, v) => {
        for (const mesh of pool.meshes) mesh.count = counts[v] as number;
        pool.inst.instA.needsUpdate = true;
        pool.inst.instB.needsUpdate = true;
        pool.inst.instHue.needsUpdate = true;
      });
    }
  }
}
