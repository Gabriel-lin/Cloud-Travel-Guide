import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

import {
  AbstractModelLoader,
  type AbstractModelLoaderOptions,
  type ModelLoaderContext,
  type ModelLoaderPayload,
} from "./AbstractModelLoader";
import { toArrayBuffer } from "./utils";

/**
 * Wavefront OBJ 加载器。
 *
 * 说明：OBJ 自身不含材质，材质由配套 `.mtl` 描述；此加载器仅解析几何与分组。
 * 如需材质，可在解析后自行使用 MTLLoader 装配。
 */
export class ObjModelLoader extends AbstractModelLoader {
  readonly name = "obj";
  readonly extensions = ["obj"] as const;
  readonly mimeTypes = ["model/obj", "text/plain"] as const;

  private readonly loader: OBJLoader;

  constructor(options: AbstractModelLoaderOptions = {}) {
    super(options);
    this.loader = new OBJLoader(this.manager);
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
      const text = this.decodeText(context.source);
      group = this.loader.parse(text);
    }
    return { object: group };
  }

  private decodeText(source: ArrayBuffer | ArrayBufferView | string): string {
    if (typeof source === "string") return source;
    const buffer =
      source instanceof ArrayBuffer ? source : toArrayBuffer(source);
    return new TextDecoder().decode(buffer);
  }
}
