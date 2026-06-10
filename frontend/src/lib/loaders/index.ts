import { FbxModelLoader } from "./FbxModelLoader";
import {
  GaussianSplatLoader,
  type GaussianSplatLoaderOptions,
} from "./GaussianSplatLoader";
import {
  GltfModelLoader,
  type GltfModelLoaderOptions,
} from "./GltfModelLoader";
import { ModelLoaderRegistry } from "./ModelLoaderRegistry";
import { ObjModelLoader } from "./ObjModelLoader";
import type { AbstractModelLoaderOptions } from "./AbstractModelLoader";

export type {
  IModelLoader,
  IModelLoaderRegistry,
  KnownModelFormat,
  LoadProgress,
  ModelCategory,
  ModelFormat,
  ModelLoadOptions,
  ModelLoadResult,
  ModelLoaderFactory,
  ModelLoaderRegisterOptions,
  ModelMatchDescriptor,
  ModelMetadata,
  ModelSource,
} from "./types";

export {
  AbstractModelLoader,
  type AbstractModelLoaderOptions,
  type ModelLoaderContext,
  type ModelLoaderPayload,
} from "./AbstractModelLoader";
export { ModelLoaderRegistry } from "./ModelLoaderRegistry";
export { GltfModelLoader, type GltfModelLoaderOptions } from "./GltfModelLoader";
export { ObjModelLoader } from "./ObjModelLoader";
export { FbxModelLoader } from "./FbxModelLoader";
export {
  GaussianSplatLoader,
  type GaussianSplatLoaderOptions,
  type GaussianSplatData,
  type GaussianSplatDecoder,
} from "./GaussianSplatLoader";

/** {@link createDefaultModelLoaderRegistry} 的配置项。 */
export interface DefaultRegistryOptions extends AbstractModelLoaderOptions {
  /** 透传给 GLTF 加载器的配置（DRACO / KTX2 / meshopt）。 */
  gltf?: GltfModelLoaderOptions;
  /** 透传给高斯泼溅加载器的配置（自定义解码器、点尺寸等）。 */
  gaussianSplat?: GaussianSplatLoaderOptions;
  /** 是否注册 OBJ 加载器。默认 true。 */
  obj?: boolean;
  /** 是否注册 FBX 加载器。默认 true。 */
  fbx?: boolean;
}

/**
 * 创建一个预置主流格式的加载器注册中心。
 *
 * 默认注册：
 * - {@link GltfModelLoader}（gltf / glb）
 * - {@link ObjModelLoader}（obj）
 * - {@link FbxModelLoader}（fbx）
 * - {@link GaussianSplatLoader}（splat / ksplat / spz / ply）
 *
 * @example
 * ```ts
 * const registry = createDefaultModelLoaderRegistry({
 *   gltf: { renderer },
 * });
 * const result = await registry.load("/models/scene.glb", {
 *   onProgress: (p) => console.log(p.ratio),
 * });
 * scene.add(result.object);
 * ```
 */
export function createDefaultModelLoaderRegistry(
  options: DefaultRegistryOptions = {},
): ModelLoaderRegistry {
  const { manager, gltf, gaussianSplat, obj = true, fbx = true } = options;
  const shared: AbstractModelLoaderOptions = { manager };

  const registry = new ModelLoaderRegistry();
  registry.register(new GltfModelLoader({ ...shared, ...gltf }));
  if (obj) registry.register(new ObjModelLoader(shared));
  if (fbx) registry.register(new FbxModelLoader(shared));
  registry.register(
    new GaussianSplatLoader({ ...shared, ...gaussianSplat }),
  );
  return registry;
}
