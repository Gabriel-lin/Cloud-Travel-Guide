/**
 * 区域场景后处理:概念网格不再靠 MSAA 扛边缘,
 * 把抗锯齿 / 近景微对比(喙、羽缘、建筑窗格)挪到全屏 pass。
 *
 * 场景 pass 强制 0x MSAA;边缘走 luma FXAA,近景用深度加权反锐化
 * 补回关掉硬件 MSAA 后损失的轮廓。天空(远平面)几乎不锐化,避免光晕。
 */

import type { Camera, Scene } from "three";
import {
  abs,
  float,
  mix,
  pass,
  screenSize,
  screenUV,
  smoothstep,
  texture,
  vec2,
  vec4,
} from "three/tsl";
import { RenderPipeline, type Renderer } from "three/webgpu";

export function createRegionPostFX(
  renderer: Renderer,
  scene: Scene,
  camera: Camera,
): RenderPipeline {
  const scenePass = pass(scene, camera, { samples: 0 });
  const sceneColor = scenePass.getTextureNode();
  const distM = abs(scenePass.getViewZNode());

  const texel = float(1).div(screenSize);
  const uv0 = screenUV;
  const c = texture(sceneColor, uv0);
  const n = texture(sceneColor, uv0.add(vec2(0, texel.y)));
  const s = texture(sceneColor, uv0.add(vec2(0, texel.y.negate())));
  const e = texture(sceneColor, uv0.add(vec2(texel.x, 0)));
  const w = texture(sceneColor, uv0.add(vec2(texel.x.negate(), 0)));

  const luma = (q: typeof c) => q.r.mul(0.299).add(q.g.mul(0.587)).add(q.b.mul(0.114));
  const lC = luma(c);
  const edge = abs(luma(n).sub(lC))
    .add(abs(luma(s).sub(lC)))
    .add(abs(luma(e).sub(lC)))
    .add(abs(luma(w).sub(lC)));
  const aaK = smoothstep(0.045, 0.24, edge);
  const blur = n.add(s).add(e).add(w).mul(0.25);
  const aa = mix(c, blur, aaK.mul(0.58));

  // 近处(鸟/建筑,约 24–200 m)补轮廓;远景与天空几乎不动
  const sharpK = smoothstep(float(200), float(24), distM)
    .mul(smoothstep(0.08, 0.28, edge))
    .mul(0.32);
  const out = aa.add(aa.sub(blur).mul(sharpK));

  const pipe = new RenderPipeline(renderer);
  pipe.outputNode = vec4(out.rgb, 1);
  return pipe;
}
