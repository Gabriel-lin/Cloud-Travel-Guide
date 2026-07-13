/**
 * 环境粒子 kernel(全 GPU 顶点驱动,零逐帧 CPU):
 *
 * - 萤火虫(夜):散布器选出的水边/植被聚集点周围游曳;每只有独立的
 *   Lissajous 轨道(相位/速度/半径哈希)+ 呼吸式明暗;加色混合软光点。
 * - 花粉/飘叶(昼):相机环形域内随风平流 + 缓慢下沉,mod 环绕永续。
 */

import { InstancedBufferAttribute, InstancedMesh, PlaneGeometry } from "three";
import { AdditiveBlending } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  cos,
  instancedBufferAttribute,
  mix,
  positionLocal,
  sin,
  smoothstep,
  uv,
  vec3,
} from "three/tsl";
import type { NV4 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import { makeRng } from "../veg/treeBuilder";

const FIREFLY_COUNT = 1400;
const AMBIENT_COUNT = 900;

/** 相机朝向广告牌小方片 */
function billboardQuad(
  instA: InstancedBufferAttribute,
  instB: InstancedBufferAttribute,
): PlaneGeometry {
  const quad = new PlaneGeometry(1, 1);
  quad.setAttribute("instA", instA);
  quad.setAttribute("instB", instB);
  return quad;
}

export function createFireflies(env: EnvState, spots: Float32Array): InstancedMesh {
  const nSpots = spots.length / 4;
  const count = nSpots > 0 ? FIREFLY_COUNT : 0;
  const instA = new InstancedBufferAttribute(new Float32Array(Math.max(count, 1) * 4), 4);
  const instB = new InstancedBufferAttribute(new Float32Array(Math.max(count, 1) * 4), 4);
  const rng = makeRng(20260709);
  for (let i = 0; i < count; i++) {
    const s = Math.floor(rng() * nSpots);
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * 22;
    instA.array[i * 4] = (spots[s * 4] as number) + Math.cos(ang) * rad;
    instA.array[i * 4 + 1] = (spots[s * 4 + 1] as number) + 0.6 + rng() * 2.4;
    instA.array[i * 4 + 2] = (spots[s * 4 + 2] as number) + Math.sin(ang) * rad;
    instA.array[i * 4 + 3] = 0.05 + rng() * 0.05; // 尺寸
    instB.array[i * 4] = rng(); // 相位
    instB.array[i * 4 + 1] = 0.4 + rng() * 0.9; // 速度
    instB.array[i * 4 + 2] = 1.5 + rng() * 3.5; // 游曳半径
    instB.array[i * 4 + 3] = rng(); // 闪烁去相关
  }

  const mat = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.blending = AdditiveBlending;
  mat.depthWrite = false;
  mat.fog = false;

  const a = instancedBufferAttribute(instA) as unknown as NV4;
  const b = instancedBufferAttribute(instB) as unknown as NV4;
  const t = env.time.mul(b.y).add(b.x.mul(43));
  // Lissajous 游曳轨道(每只不同)
  const orbit = vec3(
    sin(t).mul(b.z),
    sin(t.mul(1.7).add(b.w.mul(9))).mul(0.7),
    cos(t.mul(0.83)).mul(b.z),
  );
  const base = a.xyz.add(orbit).toVar();
  const toCam = cameraPosition.sub(base);
  const fwd = vec3(toCam.x, 0, toCam.z).normalize();
  const right = vec3(fwd.z.negate(), 0, fwd.x);
  const up = vec3(0, 1, 0);
  // 呼吸式明暗(0.6 Hz 左右,占空比偏灭)
  const pulse = smoothstep(0.35, 0.9, sin(env.time.mul(1.9).add(b.w.mul(37))).mul(0.5).add(0.5))
    .mul(env.nightK)
    .toVar();
  const sizeK = a.w.mul(pulse.mul(0.7).add(0.3));
  mat.positionNode = base
    .add(right.mul(positionLocal.x.mul(sizeK)))
    .add(up.mul(positionLocal.y.mul(sizeK)));

  const d = uv().sub(0.5).length();
  const glow = smoothstep(0.5, 0.06, d);
  mat.colorNode = vec3(0.75, 1.0, 0.32).mul(glow).mul(pulse).mul(3.2);
  mat.opacityNode = glow.mul(pulse);

  const mesh = new InstancedMesh(billboardQuad(instA, instB), mat, Math.max(count, 1));
  mesh.count = count;
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  return mesh;
}

export function createAmbientParticles(env: EnvState): InstancedMesh {
  const instA = new InstancedBufferAttribute(new Float32Array(AMBIENT_COUNT * 4), 4);
  const instB = new InstancedBufferAttribute(new Float32Array(AMBIENT_COUNT * 4), 4);
  const rng = makeRng(19981123);
  const RANGE = 64;
  for (let i = 0; i < AMBIENT_COUNT; i++) {
    instA.array[i * 4] = (rng() - 0.5) * RANGE * 2;
    instA.array[i * 4 + 1] = rng() * 30;
    instA.array[i * 4 + 2] = (rng() - 0.5) * RANGE * 2;
    instA.array[i * 4 + 3] = 0.02 + rng() * 0.04;
    instB.array[i * 4] = rng(); // 相位
    instB.array[i * 4 + 1] = 0.25 + rng() * 0.6; // 下沉速度
    instB.array[i * 4 + 2] = rng(); // 叶(>0.8)/花粉
    instB.array[i * 4 + 3] = rng();
  }

  const mat = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.fog = false;

  const a = instancedBufferAttribute(instA) as unknown as NV4;
  const b = instancedBufferAttribute(instB) as unknown as NV4;
  const t = env.time;
  // 风平流 + 摆动 + 下沉;相机环形域 mod 环绕
  const drift = vec3(env.windDir.x, 0, env.windDir.y)
    .mul(env.windStrength.mul(3.5).add(0.5))
    .mul(t);
  const wobble = vec3(
    sin(t.mul(0.9).add(b.x.mul(31))).mul(0.8),
    0,
    cos(t.mul(0.7).add(b.x.mul(17))).mul(0.8),
  );
  // 材质构建在 Fn() 之外,不能用 subAssign —— 下沉项并入纯表达式
  const rawBase = a.xyz.add(drift).add(wobble);
  const raw = vec3(rawBase.x, rawBase.y.sub(t.mul(b.y)), rawBase.z).toVar();
  const wrap = (v: typeof raw.x, range: number) =>
    v.div(range).fract().mul(range);
  const rel = vec3(
    wrap(raw.x.add(RANGE).sub(cameraPosition.x), RANGE * 2).sub(RANGE),
    wrap(raw.y.add(18).sub(cameraPosition.y), 36).sub(18),
    wrap(raw.z.add(RANGE).sub(cameraPosition.z), RANGE * 2).sub(RANGE),
  );
  const base = cameraPosition.add(rel).toVar();
  const toCam = cameraPosition.sub(base);
  const fwd = vec3(toCam.x, 0, toCam.z).normalize();
  const right = vec3(fwd.z.negate(), 0, fwd.x);
  const dayK = env.nightK.oneMinus().toVar();
  // 叶片略大且旋转下落
  const leafK = smoothstep(0.78, 0.82, b.z);
  const spin = sin(t.mul(2.2).add(b.w.mul(21))).mul(leafK).mul(0.5).add(1);
  const sizeK = a.w.mul(leafK.mul(3).add(1)).mul(spin).mul(dayK);
  mat.positionNode = base
    .add(right.mul(positionLocal.x.mul(sizeK)))
    .add(vec3(0, 1, 0).mul(positionLocal.y.mul(sizeK)));

  const d = uv().sub(0.5).length();
  const soft = smoothstep(0.5, 0.12, d);
  const distFade = smoothstep(RANGE, RANGE * 0.4, rel.length());
  const pollen = vec3(1.0, 0.96, 0.78);
  const leaf = vec3(0.62, 0.52, 0.22);
  mat.colorNode = mix(pollen, leaf, leafK);
  mat.opacityNode = clamp(soft.mul(distFade).mul(dayK).mul(0.55), 0, 1);

  const mesh = new InstancedMesh(billboardQuad(instA, instB), mat, AMBIENT_COUNT);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  return mesh;
}
