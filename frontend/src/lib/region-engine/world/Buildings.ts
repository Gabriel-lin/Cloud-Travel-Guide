/**
 * 建筑系统:OSM footprint 挤出 + 程序化立面 kernel + 距离 LOD。
 *
 * - 每栋建筑 Shape 挤出到 tags 高度(缺省逐 id 哈希),按 256 m 网格合并成
 *   分块大网格(视锥剔除粒度),顶点色带逐栋色相/屋顶标记。
 * - 立面 kernel:世界坐标窗格网格(白天墙面纹理、夜间暖色窗光按哈希点亮),
 *   近景细节按距离淡出(远处纯色块)。
 */

import {
  BufferAttribute,
  ExtrudeGeometry,
  Group,
  Mesh,
  Shape,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  attribute,
  cameraPosition,
  clamp,
  floor,
  fract,
  mix,
  normalWorld,
  positionWorld,
  smoothstep,
  step,
  vec2,
  vec3,
} from "three/tsl";
import { fbm2, hash2 } from "../gpu/noise";
import type { NV3 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import { sampleCpu } from "../render/fields";
import type { OsmData, WorldFields } from "../types";

const MERGE_CELL = 256;

function buildFacadeMaterial(env: EnvState): MeshStandardNodeMaterial {
  const mat = new MeshStandardNodeMaterial();
  mat.metalness = 0.05;

  const wp = positionWorld;
  const n = normalWorld;
  // 建筑基色(顶点色:rgb=墙色,由逐栋哈希生成) + 宏观污渍
  const base = attribute("color") as unknown as NV3;
  const grime = fbm2(wp.xz.div(18), 3).mul(0.06);

  // 窗格:沿墙面切向的世界网格(3.2 m 开间 × 3.0 m 层高)
  const tangentU = n.x.abs().greaterThan(0.5).select(wp.z, wp.x);
  const cellUv = vec2(tangentU.div(3.2), wp.y.div(3.0)).toVar();
  const cellId = floor(cellUv).toVar();
  const inWin = step(0.22, fract(cellUv.x))
    .mul(step(fract(cellUv.x), 0.78))
    .mul(step(0.25, fract(cellUv.y)))
    .mul(step(fract(cellUv.y), 0.8))
    .toVar();
  // 屋顶(法线朝上)不开窗
  const wallK = n.y.abs().lessThan(0.6).select(1, 0);
  // 距离淡出:>600 m 退化为纯色块
  const dist = wp.xz.sub(cameraPosition.xz).length();
  const detailK = smoothstep(650, 380, dist).mul(wallK);
  const win = inWin.mul(detailK).toVar();

  // 白天:窗户为深色玻璃;墙面细分横带
  const bandK = fract(wp.y.div(3.0)).lessThan(0.08).select(0.85, 1.0);
  const dayWall = base.mul(bandK).sub(grime);
  const glassDay = vec3(0.22, 0.27, 0.32).add(fbm2(cellId.mul(1.7), 2).mul(0.05));
  const dayCol = mix(dayWall, glassDay, win);

  // 夜晚:按 cell 哈希 ~35% 窗点亮(暖光),其余深灰
  const lit = step(hash2(cellId, 5), 0.35);
  const glassNight = mix(vec3(0.02, 0.025, 0.04), vec3(1.0, 0.75, 0.38), lit);
  const nightWall = base.mul(0.12).sub(grime.mul(0.5));
  const nightCol = mix(nightWall, glassNight, win);

  mat.colorNode = clamp(mix(dayCol, nightCol, env.nightK), 0, 1);
  // 夜间窗光自发光
  mat.emissiveNode = glassNight
    .mul(win)
    .mul(lit)
    .mul(env.nightK)
    .mul(1.6);
  mat.roughnessNode = mix(mix(0.85, 0.25, win), 0.9, env.nightK.mul(0.2));
  return mat;
}

export function createBuildings(
  osm: OsmData,
  world: WorldFields,
  env: EnvState,
): Group {
  const group = new Group();
  if (osm.buildings.length === 0) return group;

  const { res, size } = world;
  const cellsOf = new Map<number, ExtrudeGeometry[]>();
  const cellsX = Math.ceil(size / MERGE_CELL);

  for (let bi = 0; bi < osm.buildings.length; bi++) {
    const b = osm.buildings[bi];
    if (!b) continue;
    const ring = b.ring;
    const nPts = ring.length / 2;
    if (nPts < 3) continue;
    const cx0 = ring[0] as number;
    const cz0 = ring[1] as number;
    if (Math.abs(cx0) > size / 2 || Math.abs(cz0) > size / 2) continue;

    const shape = new Shape();
    // 注意:three Shape 在 xy 平面;挤出后绕 x 轴翻到 xz(y 向上),z 取反
    shape.moveTo(ring[0] as number, -(ring[1] as number));
    for (let i = 1; i < nPts; i++) {
      shape.lineTo(ring[i * 2] as number, -(ring[i * 2 + 1] as number));
    }
    shape.closePath();

    let geo: ExtrudeGeometry;
    try {
      geo = new ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false });
    } catch {
      continue;
    }
    // 挤出方向 +z → 旋成 +y,并落到地形上
    geo.rotateX(-Math.PI / 2);
    const groundY = sampleCpu(world.heights, cx0, cz0, res, size);
    geo.translate(0, groundY - 0.6, 0);

    // 逐栋顶点色(墙面色相哈希:灰白/米黄/青砖)
    const hash = ((bi * 2654435761) >>> 0) / 4294967295;
    const palette: [number, number, number][] = [
      [0.72, 0.7, 0.66],
      [0.78, 0.72, 0.6],
      [0.6, 0.62, 0.64],
      [0.52, 0.5, 0.48],
      [0.66, 0.6, 0.55],
    ];
    const col = palette[Math.floor(hash * palette.length) % palette.length] as [
      number,
      number,
      number,
    ];
    const pos = geo.getAttribute("position");
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const jitter = (((i * 97 + bi * 31) % 17) / 17 - 0.5) * 0.04;
      colors[i * 3] = col[0] + jitter;
      colors[i * 3 + 1] = col[1] + jitter;
      colors[i * 3 + 2] = col[2] + jitter;
    }
    geo.setAttribute("color", new BufferAttribute(colors, 3));

    const gx = Math.min(Math.max(Math.floor((cx0 + size / 2) / MERGE_CELL), 0), cellsX - 1);
    const gz = Math.min(Math.max(Math.floor((cz0 + size / 2) / MERGE_CELL), 0), cellsX - 1);
    const key = gz * cellsX + gx;
    const arr = cellsOf.get(key) ?? [];
    arr.push(geo);
    cellsOf.set(key, arr);
  }

  const mat = buildFacadeMaterial(env);
  for (const geos of cellsOf.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    for (const g of geos) g.dispose();
  }
  return group;
}
