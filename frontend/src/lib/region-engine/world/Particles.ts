/**
 * 环境粒子 kernel(全 GPU 顶点驱动,零逐帧 CPU):
 *
 * - 萤火虫(夜):厘米级针尖光点(真实腹部发光 1–2 cm + 薄晕)。参数打进
 *   浮点纹理,InstancedMesh 按 instanceIndex 读取 —— 一次绘制、零逐帧上传。
 *   点光只作很弱的环境填充;光柱从虫群上方升起便于定位。
 * - 花粉/飘叶(昼):相机环形域内随风平流 + 缓慢下沉,mod 环绕永续。
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  FloatType,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  PointLight,
  RGBAFormat,
} from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  cameraPosition,
  clamp,
  cos,
  instancedBufferAttribute,
  instanceIndex,
  ivec2,
  mix,
  positionLocal,
  sin,
  smoothstep,
  textureLoad,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { NF, NV3, NV4 } from "../gpu/tsl-types";
import type { EnvState } from "../render/env";
import {
  sampleFloatBilinear,
  sampleWaterLevel,
  type WorldTextures,
} from "../render/fields";
import { makeRng } from "../veg/treeBuilder";

const AMBIENT_COUNT = 900;
/** 实际点亮场景的点光上限(WebGL 回退路径灯光预算紧) */
const FIREFLY_LIGHT_MAX = 12;
/** 成群投放的聚集点上限 */
const FIREFLY_SWARM_MAX = 24;
/** 每群只数(小光点,靠数量而不是体积出群感) */
const FIREFLY_PER_SPOT = 96;
/** 虫群水平半径 m */
const FIREFLY_SPREAD = 7.5;
/** 参数纹理列数:0=位置/尺寸 1=相位/速度/半径/闪烁 */
const FIREFLY_ROWS = 2;
/** 萤火虫黄绿:与粒子 colorNode 一致 */
const FIREFLY_RGB: [number, number, number] = [0.75, 1.0, 0.32];
const FIREFLY_HEX = 0xbfff52;
/** 光柱从虫群上方升起,避免加色柱体把粒子洗掉 */
const BEAM_HEIGHT = 52;
const BEAM_LIFT = 4.6;

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

export type FireflySys = {
  group: Group;
  update: (nightK: number, time: number) => void;
};

/**
 * 萤火虫:InstancedMesh + 参数纹理(与鱼群同一套 WebGPU 实例路径)。
 * 几何只有一张单位方片;每只的位置/闪烁全在 GPU 读纹理,零逐帧 CPU。
 * 视觉:4–8 cm 世界尺寸、针尖内核 + 薄晕,占空比偏低的真实闪烁。
 */
function createFireflyMesh(env: EnvState, spots: Float32Array): InstancedMesh | null {
  const nSpots = spots.length / 4;
  const nSwarms = Math.min(nSpots, FIREFLY_SWARM_MAX);
  const count = nSwarms > 0 ? nSwarms * FIREFLY_PER_SPOT : 0;
  if (count === 0) return null;

  const data = new Float32Array(count * FIREFLY_ROWS * 4);
  const rng = makeRng(20260709);
  for (let i = 0; i < count; i++) {
    const s = Math.floor(i / FIREFLY_PER_SPOT);
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * FIREFLY_SPREAD;
    const o = i * FIREFLY_ROWS * 4;
    data[o] = (spots[s * 4] as number) + Math.cos(ang) * rad;
    data[o + 1] = (spots[s * 4 + 1] as number) + 0.9 + rng() * 1.7;
    data[o + 2] = (spots[s * 4 + 2] as number) + Math.sin(ang) * rad;
    data[o + 3] = 0.045 + rng() * 0.04; // 4.5–8.5 cm
    data[o + 4] = rng();
    data[o + 5] = 0.35 + rng() * 0.7;
    data[o + 6] = 0.35 + rng() * 0.9;
    data[o + 7] = rng();
  }

  const pTex = new DataTexture(data, FIREFLY_ROWS, count, RGBAFormat, FloatType);
  pTex.magFilter = NearestFilter;
  pTex.minFilter = NearestFilter;
  pTex.wrapS = ClampToEdgeWrapping;
  pTex.wrapT = ClampToEdgeWrapping;
  pTex.generateMipmaps = false;
  pTex.needsUpdate = true;

  const quad = new PlaneGeometry(1, 1);
  quad.deleteAttribute("normal");

  const mat = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.blending = AdditiveBlending;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.side = DoubleSide;
  mat.fog = false;
  mat.toneMapped = false;

  const fp = (row: number) =>
    textureLoad(pTex, ivec2(row, instanceIndex.toInt())).toVar() as unknown as NV4;
  const a = fp(0);
  const b = fp(1);
  const t = env.time.mul(b.y).add(b.x.mul(43));
  const orbit = vec3(
    sin(t).mul(b.z),
    sin(t.mul(1.7).add(b.w.mul(9))).mul(0.45),
    cos(t.mul(0.83)).mul(b.z),
  );
  const base = a.xyz.add(orbit).toVar();
  const toCam = cameraPosition.sub(base).toVar();
  const dist = toCam.length().max(0.4);
  const xzLen = toCam.xz.length().max(0.001);
  const fwd = vec3(toCam.x, 0, toCam.z).div(xzLen);
  const right = vec3(fwd.z.negate(), 0, fwd.x);
  const up = vec3(0, 1, 0);
  // 真实萤火虫:大部分时间熄灭,短暂点亮
  const pulse = smoothstep(0.58, 0.9, sin(env.time.mul(1.45).add(b.w.mul(37))).mul(0.5).add(0.5))
    .mul(env.nightK)
    .toVar();
  // 近处保持厘米级;远处用距离下限避免亚像素消失(仍远小于旧版 1 m 光球)
  const sizeK = a.w.max(dist.mul(0.0009)).mul(pulse.mul(0.15).add(0.85));
  mat.positionNode = base
    .add(right.mul(positionLocal.x.mul(sizeK)))
    .add(up.mul(positionLocal.y.mul(sizeK)));

  const d = uv().sub(0.5).length();
  const core = smoothstep(0.09, 0.0, d);
  const halo = smoothstep(0.48, 0.08, d);
  const glow = core.add(halo.mul(halo).mul(0.32)).toVar();
  const tint = mix(vec3(FIREFLY_RGB[0], FIREFLY_RGB[1], FIREFLY_RGB[2]), vec3(1.0, 0.98, 0.62), core);
  mat.colorNode = tint.mul(glow).mul(pulse).mul(5.5);
  mat.opacityNode = glow.mul(pulse);

  const mesh = new InstancedMesh(quad, mat, count);
  mesh.count = count;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 32;
  mesh.userData.pTex = pTex;
  return mesh;
}

/**
 * 聚集点场景点光:照亮附近地形/植被,夜间才能看见虫群所在的那片绿晕。
 * 只取权重最高的若干点,避免 WebGL 回退路径灯光溢出。
 */
function createFireflyLights(spots: Float32Array): PointLight[] {
  const nSpots = spots.length / 4;
  const n = Math.min(nSpots, FIREFLY_LIGHT_MAX);
  const lights: PointLight[] = [];
  for (let i = 0; i < n; i++) {
    const w = spots[i * 4 + 3] as number;
    const light = new PointLight(FIREFLY_HEX, 0, 16, 2);
    light.position.set(
      spots[i * 4] as number,
      (spots[i * 4 + 1] as number) + 1.8,
      spots[i * 4 + 2] as number,
    );
    light.castShadow = false;
    light.userData.baseIntensity = 0.45 + w * 0.9;
    light.userData.phase = i * 2.17;
    lights.push(light);
  }
  return lights;
}

/**
 * 夜间光柱信标:从虫群头顶升起(白热内核 + 萤火虫色外晕),与鱼/鸟信标
 * 同一套加色混合。乘 nightK → 白天完全隐去;柱体抬到虫群上方,避免洗掉粒子。
 */
function createFireflyBeacons(env: EnvState, spots: Float32Array): Mesh | null {
  const nSpots = Math.min(spots.length / 4, FIREFLY_SWARM_MAX);
  if (nSpots <= 0) return null;

  const pos: number[] = [];
  const col: number[] = [];
  const fad: number[] = [];
  const idx: number[] = [];
  const SEG = 12;
  const [br, bg, bb] = FIREFLY_RGB;

  const addCyl = (
    cx: number,
    cy: number,
    cz: number,
    r: number,
    c: [number, number, number],
    alpha: number,
  ) => {
    const v0 = pos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const x = Math.cos(a);
      const z = Math.sin(a);
      pos.push(cx + x * r, cy, cz + z * r);
      pos.push(cx + x * r * 0.5, cy + BEAM_HEIGHT, cz + z * r * 0.5);
      col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
      fad.push(alpha, 0);
    }
    for (let k = 0; k < SEG; k++) {
      const a = v0 + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  };

  for (let i = 0; i < nSpots; i++) {
    const x = spots[i * 4] as number;
    const y = (spots[i * 4 + 1] as number) + BEAM_LIFT;
    const z = spots[i * 4 + 2] as number;
    addCyl(x, y, z, 0.1, [br * 0.35 + 0.55, bg * 0.35 + 0.55, bb * 0.35 + 0.55], 0.08);
    addCyl(x, y, z, 0.42, [br * 1.05, bg * 1.05, bb * 1.05], 0.03);
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("aCol", new BufferAttribute(new Float32Array(col), 3));
  geo.setAttribute("aFade", new BufferAttribute(new Float32Array(fad), 1));
  geo.setIndex(idx);

  const mat = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.blending = AdditiveBlending;
  mat.depthWrite = false;
  mat.depthTest = true;
  mat.side = DoubleSide;
  mat.fog = false;

  const aCol = attribute("aCol") as unknown as NV3;
  const aFade = attribute("aFade") as unknown as NF;
  const pulse = sin(env.time.mul(1.7)).mul(0.5).add(0.5);
  mat.colorNode = aCol;
  mat.opacityNode = aFade.mul(pulse.mul(0.28).add(0.72)).mul(env.nightK);

  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 30;
  return mesh;
}

export function createFireflies(env: EnvState, spots: Float32Array): FireflySys {
  const group = new Group();
  group.name = "fireflies";
  group.frustumCulled = false;
  const mesh = createFireflyMesh(env, spots);
  if (mesh) group.add(mesh);
  const lights = createFireflyLights(spots);
  for (const light of lights) group.add(light);
  const beacons = createFireflyBeacons(env, spots);
  if (beacons) group.add(beacons);

  return {
    group,
    update: (nightK: number, time: number) => {
      group.visible = nightK > 0.03;
      for (const light of lights) {
        const pulse = 0.78 + 0.22 * Math.sin(time * 1.6 + (light.userData.phase as number));
        light.intensity = (light.userData.baseIntensity as number) * nightK * pulse;
      }
    },
  };
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

/** 水下悬浮碎屑(marine snow):相机周围环绕,只在水面以下、河床以上可见 */
export function createMarineSnow(tex: WorldTextures, env: EnvState): InstancedMesh {
  const COUNT = 720;
  const RANGE = 8;
  const instA = new InstancedBufferAttribute(new Float32Array(COUNT * 4), 4);
  const instB = new InstancedBufferAttribute(new Float32Array(COUNT * 4), 4);
  const rng = makeRng(20260817);
  for (let i = 0; i < COUNT; i++) {
    instA.array[i * 4] = (rng() - 0.5) * RANGE * 2;
    instA.array[i * 4 + 1] = (rng() - 0.5) * RANGE * 2;
    instA.array[i * 4 + 2] = (rng() - 0.5) * RANGE * 2;
    instA.array[i * 4 + 3] = 0.008 + rng() * 0.018;
    instB.array[i * 4] = rng();
    instB.array[i * 4 + 1] = 0.04 + rng() * 0.12;
    instB.array[i * 4 + 2] = rng();
    instB.array[i * 4 + 3] = rng();
  }

  const mat = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = false;
  mat.fog = true;

  const a = instancedBufferAttribute(instA) as unknown as NV4;
  const b = instancedBufferAttribute(instB) as unknown as NV4;
  const t = env.time;
  const raw = vec3(
    a.x.add(sin(t.mul(0.11).add(b.x.mul(17))).mul(0.35)).add(t.mul(b.y).mul(0.15)),
    a.y.add(t.mul(b.y.negate())).add(sin(t.mul(0.19).add(b.z.mul(9))).mul(0.2)),
    a.z.add(cos(t.mul(0.13).add(b.w.mul(13))).mul(0.35)).add(t.mul(b.y).mul(0.08)),
  ).toVar();
  const wrap = (v: typeof raw.x, range: number) => v.div(range).fract().mul(range);
  const rel = vec3(
    wrap(raw.x.add(RANGE).sub(cameraPosition.x), RANGE * 2).sub(RANGE),
    wrap(raw.y.add(RANGE).sub(cameraPosition.y), RANGE * 2).sub(RANGE),
    wrap(raw.z.add(RANGE).sub(cameraPosition.z), RANGE * 2).sub(RANGE),
  );
  const base = cameraPosition.add(rel).toVar();
  const xz = vec2(base.x, base.z);
  const bed = sampleFloatBilinear(tex.heightTex, xz, tex.res, tex.size);
  const wl = sampleWaterLevel(tex.waterExtTex, xz, tex.res, tex.size);
  const under = wl.valid
    .mul(smoothstep(bed.add(0.04), bed.add(0.18), base.y))
    .mul(smoothstep(wl.y.add(0.02), wl.y.sub(0.12), base.y));
  const toCam = cameraPosition.sub(base);
  const dist = rel.length();
  const right = vec3(toCam.z.negate(), 0, toCam.x).normalize();
  const up = vec3(0, 1, 0);
  const sizeK = a.w.mul(under);
  mat.positionNode = base
    .add(right.mul(positionLocal.x.mul(sizeK)))
    .add(up.mul(positionLocal.y.mul(sizeK)));

  const d = uv().sub(0.5).length();
  const soft = smoothstep(0.5, 0.12, d);
  const distFade = smoothstep(RANGE, RANGE * 0.25, dist);
  mat.colorNode = vec3(0.55, 0.58, 0.42);
  mat.opacityNode = clamp(soft.mul(distFade).mul(under).mul(0.38), 0, 1);

  const mesh = new InstancedMesh(billboardQuad(instA, instB), mat, COUNT);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return mesh;
}
