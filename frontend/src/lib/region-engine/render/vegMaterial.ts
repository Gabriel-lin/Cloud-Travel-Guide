/**
 * 植被实例材质 kernel(近景网格)。
 *
 * bark:烘焙树皮双贴图(LAAS barkTexturedMaterial)—— sqrt 解码 albedo、
 *   切线法线、腔隙 AO(aoNode)、粗糙度通道
 * cards:sqrt 解码图集 + 色相抖动 + 背光透光 + 边缘淡出(LAAS foliageCardMaterial)
 */

import {
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  type Texture,
} from "three";
import { MeshPhysicalNodeMaterial } from "three/webgpu";
import {
  attribute,
  cameraPosition,
  clamp,
  cos,
  float,
  instancedBufferAttribute,
  mix,
  normalLocal,
  normalWorld,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  texture,
  transformNormalToView,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { NF, NV3, NV4 } from "../gpu/tsl-types";
import type { EnvState } from "./env";
import type { BarkTextures } from "./barkSynth";
import { leafFlutter, windSway } from "./wind";

export type VegInstances = {
  instA: InstancedBufferAttribute;
  instB: InstancedBufferAttribute;
  instHue: InstancedBufferAttribute;
  capacity: number;
};

export function makeVegInstances(capacity: number): VegInstances {
  return {
    instA: new InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
    instB: new InstancedBufferAttribute(new Float32Array(capacity * 4), 4),
    instHue: new InstancedBufferAttribute(new Float32Array(capacity), 1),
    capacity,
  };
}

export type VegPool = {
  geometry: BufferGeometry;
  material: MeshPhysicalNodeMaterial;
};

/** LAAS 色相抖动:暖(+)/冷(−) */
function hueShift(base: NV3, hue: NF, amount: number): NV3 {
  const k = hue.mul(amount);
  const warm = vec3(1.18, 1.0, 0.55);
  const cool = vec3(0.7, 0.95, 1.25);
  return base
    .mul(warm)
    .mul(clamp(k, 0, 1))
    .add(base.mul(cool).mul(clamp(k.negate(), 0, 1)))
    .add(base.mul(float(1).sub(k.abs())));
}

/** 背光透光(薄叶面近似,LAAS translucency) */
function foliageTranslucency(albedo: NV3, env: EnvState, k: number): NV3 {
  const viewDir = positionWorld.sub(cameraPosition).normalize();
  const toward = clamp(viewDir.dot(env.sunDir.negate()), 0, 1);
  const glow = toward.pow(5).mul(env.sunIntensity()).mul(k);
  const nightK = env.nightK;
  const sunCol = mix(vec3(0.9, 1.05, 0.55), vec3(0.15, 0.2, 0.35), nightK);
  return albedo.mul(sunCol).mul(glow);
}

/** 实例变换 + 风:设 positionNode,返回 yaw 的 cos/sin 供法线旋转 */
function applyWind(
  material: MeshPhysicalNodeMaterial,
  env: EnvState,
  inst: VegInstances,
  windAmp: number,
  flutterAmp: number,
  leafK: number,
): { c: NF; s: NF } {
  const a = instancedBufferAttribute(inst.instA) as unknown as NV4;
  const b = instancedBufferAttribute(inst.instB) as unknown as NV4;
  const yaw = b.x;
  const c = cos(yaw);
  const s = sin(yaw);
  const local = positionLocal.mul(a.w).toVar();
  const rot = vec3(
    local.x.mul(c).sub(local.z.mul(s)).add(b.y.mul(local.y)),
    local.y,
    local.x.mul(s).add(local.z.mul(c)).add(b.z.mul(local.y)),
  ).toVar();
  const instPos = a.xyz;
  const vcol = attribute("color") as unknown as NV4;
  const heightK = vcol.w;
  const anchor = vec2(instPos.x, instPos.z);
  const sway = windSway(env, anchor, heightK, b.w, windAmp);
  const flutter =
    leafK > 0 && flutterAmp > 0
      ? leafFlutter(env, anchor, b.w.mul(43).add(heightK.mul(7)), flutterAmp)
      : vec3(0, 0, 0);
  material.positionNode = rot.add(instPos).add(sway).add(flutter);
  return { c, s };
}

/** 局部法线绕 y 按实例 yaw 旋转后送入光照 */
function yawRotatedNormal(n: NV3, c: NF, s: NF): NV3 {
  return vec3(
    n.x.mul(c).sub(n.z.mul(s)),
    n.y,
    n.x.mul(s).add(n.z.mul(c)),
  ) as unknown as NV3;
}

export function buildVegPool(
  baseGeometry: BufferGeometry,
  env: EnvState,
  inst: VegInstances,
  opts: {
    windAmp: number;
    flutterAmp: number;
    atlas?: Texture;
    leafK?: number;
    /** 烘焙树皮双贴图(bark 池) */
    barkTex?: BarkTextures;
    foliageHueVar?: number;
  },
): VegPool {
  const geometry = baseGeometry.clone();
  geometry.setAttribute("instA", inst.instA);
  geometry.setAttribute("instB", inst.instB);
  geometry.setAttribute("instHue", inst.instHue);

  const leafK = opts.leafK ?? 1;
  const hue = (instancedBufferAttribute(inst.instHue) as unknown as NF)
    .sub(0.5)
    .mul(2); // 0..1 → −1..1(LAAS vdata.x 约定)

  // ---- 树皮池(LAAS barkTexturedMaterial) ----
  if (opts.barkTex) {
    const mat = new MeshPhysicalNodeMaterial();
    mat.specularIntensity = 0.45;
    mat.metalness = 0;
    // 封闭管 DoubleSide 近零开销,且 LOD/抖动下永不露出"空心"内壁
    mat.side = DoubleSide;

    const { c, s } = applyWind(mat, env, inst, opts.windAmp, 0, 0);

    const a = texture(opts.barkTex.texA, uv()) as unknown as NV4;
    const b = texture(opts.barkTex.texB, uv()) as unknown as NV4;
    const albedo = a.rgb.mul(a.rgb); // 烘焙时 sqrt 编码
    const vcol = attribute("color") as unknown as NV4;
    // 干基压暗近似枝干 AO(LAAS 用逐顶点烘焙 AO)
    const baseAo = vcol.w.mul(0.3).add(0.7);
    mat.colorNode = hueShift(albedo as unknown as NV3, hue, 0.14).mul(baseAo);
    mat.aoNode = a.w;
    mat.roughnessNode = b.z;

    // 切线法线:管面局部帧(T = 周向/u,B = 沿枝/v)展开贴图法线,再随实例 yaw 旋转
    const nl = normalLocal;
    const bx = b.x.mul(2).sub(1);
    const by = b.y.mul(2).sub(1);
    const t = vec3(nl.z.negate(), float(0.001), nl.x).normalize();
    const bi = nl.cross(t).normalize();
    const np = nl.add(t.mul(bx)).add(bi.mul(by)).normalize();
    mat.normalNode = transformNormalToView(yawRotatedNormal(np as unknown as NV3, c, s));

    return { geometry, material: mat };
  }

  // ---- 叶簇卡片 / 农作物池 ----
  const mat = new MeshPhysicalNodeMaterial();
  mat.specularIntensity = 0.18;
  mat.metalness = 0;
  mat.side = DoubleSide;

  const { c, s } = applyWind(mat, env, inst, opts.windAmp, opts.flutterAmp, leafK);
  mat.normalNode = transformNormalToView(
    yawRotatedNormal(normalLocal as unknown as NV3, c, s),
  );

  if (opts.atlas) {
    const vcol = attribute("color") as unknown as NV4;
    const t = texture(opts.atlas, uv()) as unknown as NV4;
    // sqrt 解码(LAAS 烘焙编码)
    const albedo = t.rgb.mul(t.rgb);
    const hueVar = opts.foliageHueVar ?? 0.35;
    const tintF = hueShift(vec3(1, 1, 1), hue, hueVar * 0.8).mul(
      vcol.w.mul(0.75).add(0.25),
    );
    const tinted = albedo.mul(tintF);
    mat.colorNode = tinted;

    // 背光透光
    mat.emissiveNode = foliageTranslucency(tinted as unknown as NV3, env, 0.06);

    // 边缘淡出:卡片平面与视线平行时近距变暗薄片(LAAS DELTA #5)
    const viewDir = cameraPosition.sub(positionWorld).normalize();
    const ndv = normalWorld.normalize().dot(viewDir).abs();
    const camDist = positionWorld.sub(cameraPosition).length();
    const edgeFade = mix(
      smoothstep(0.06, 0.2, ndv),
      float(1),
      smoothstep(35, 70, camDist),
    );
    mat.opacityNode = t.w.mul(edgeFade);
    mat.alphaTest = 0.32;
    mat.transparent = false;
    mat.roughness = 0.92;
  }

  return { geometry, material: mat };
}
