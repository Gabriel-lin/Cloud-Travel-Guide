import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

import {
  AbstractModelLoader,
  type AbstractModelLoaderOptions,
  type ModelLoaderContext,
  type ModelLoaderPayload,
} from "./AbstractModelLoader";

/**
 * Autodesk FBX 加载器（支持网格、骨骼与动画）。
 */
export class FbxModelLoader extends AbstractModelLoader {
  readonly name = "fbx";
  readonly extensions = ["fbx"] as const;
  readonly mimeTypes = ["application/octet-stream"] as const;

  private readonly loader: FBXLoader;

  constructor(options: AbstractModelLoaderOptions = {}) {
    super(options);
    this.loader = new FBXLoader(this.manager);
  }

  protected async loadModel(
    context: ModelLoaderContext,
  ): Promise<ModelLoaderPayload> {
    let group: THREE.Group;
    if (context.url !== null) {
      group = await this.loadWithThreeLoader<THREE.Group>(
        this.loader,
        context.url,
        context,
      );
    } else {
      const buffer = await this.readArrayBuffer(context);
      group = this.loader.parse(buffer, "");
    }

    return {
      object: group,
      // FBXLoader 将动画挂在返回 Group 的 animations 上。
      animations: (group as THREE.Object3D).animations ?? [],
    };
  }
}
