/**
 * 远景 impostor 烘焙:boot 时把每树种的代表几何(枝干 + 叶簇卡片)渲到
 * 透明底纹理,远处以相机朝向广告牌绘制(LAAS 八面体 impostor 的单视角简化)。
 *
 * 注意:几何的 color attribute 为 RGBA(w = 相对高度,供风 kernel 用),
 * 因此必须用显式 colorNode 取 rgb,不能开 vertexColors(会把 w 当透明度)。
 */

import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Mesh,
  OrthographicCamera,
  RenderTarget,
  Scene,
  Vector3,
  type BufferGeometry,
  type Texture,
} from "three";
import {
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Renderer,
} from "three/webgpu";
import { attribute, texture, uv } from "three/tsl";
import type { NF, NV4 } from "../gpu/tsl-types";

export type ImpostorBake = {
  texture: Texture;
  /** 广告牌宽高(米,几何真实包围盒) */
  width: number;
  height: number;
};

export async function bakeImpostor(
  renderer: Renderer,
  bark: BufferGeometry,
  cards: BufferGeometry,
  atlas: Texture,
  texSize = 256,
): Promise<ImpostorBake> {
  const scene = new Scene();

  const barkMat = new MeshStandardNodeMaterial();
  barkMat.colorNode = (attribute("color") as unknown as NV4).xyz;
  barkMat.roughness = 0.9;

  const cardMat = new MeshBasicNodeMaterial();
  const tex = texture(atlas, uv());
  const tint = (attribute("color") as unknown as NV4).xyz;
  cardMat.colorNode = tex.xyz.mul(tint);
  cardMat.opacityNode = tex.w as NF;
  cardMat.alphaTest = 0.42;
  cardMat.side = DoubleSide;
  cardMat.fog = false;

  scene.add(new Mesh(bark, barkMat));
  scene.add(new Mesh(cards, cardMat));
  scene.add(new AmbientLight(new Color(1, 1, 1), 1.6));
  const sun = new DirectionalLight(new Color(1, 0.97, 0.9), 2.2);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  bark.computeBoundingBox();
  cards.computeBoundingBox();
  const box = new Box3()
    .union(bark.boundingBox as Box3)
    .union(cards.boundingBox as Box3);
  const sizeV = box.getSize(new Vector3());
  const width = Math.max(sizeV.x, sizeV.z) * 1.05;
  const height = sizeV.y * 1.02;

  const cam = new OrthographicCamera(
    -width / 2,
    width / 2,
    box.max.y + height * 0.01,
    box.min.y - height * 0.01,
    0.1,
    200,
  );
  cam.position.set(0, (box.min.y + box.max.y) / 2, 60);
  cam.lookAt(0, (box.min.y + box.max.y) / 2, 0);

  const rt = new RenderTarget(texSize, texSize, { depthBuffer: true });
  const prevTarget = renderer.getRenderTarget();
  // Color4 类型未从 three/webgpu 重导出;Color 是其父类,getClearColor 仅写 rgb+a
  const prevClear = renderer.getClearColor(
    new Color() as Parameters<Renderer["getClearColor"]>[0],
  );
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(rt);
  renderer.setClearColor(new Color(0, 0, 0), 0);
  await renderer.renderAsync(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);

  barkMat.dispose();
  cardMat.dispose();
  return { texture: rt.texture, width, height };
}
