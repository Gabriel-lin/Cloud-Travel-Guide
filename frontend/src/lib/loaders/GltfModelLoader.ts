import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import {
  AbstractModelLoader,
  type AbstractModelLoaderOptions,
  type ModelLoaderContext,
  type ModelLoaderPayload,
} from "./AbstractModelLoader";
import { toArrayBuffer } from "./utils";

/** GLTF / GLB 加载器的可选配置。 */
export interface GltfModelLoaderOptions extends AbstractModelLoaderOptions {
  /**
   * DRACO 解码器目录（含 wasm/js）。
   * 传入后启用 Draco 几何压缩支持。默认指向 gstatic CDN。
   */
  dracoDecoderPath?: string | null;
  /**
   * KTX2 transcoder 目录（basis）。
   * 传入后启用 KTX2 压缩贴图支持。默认指向 jsDelivr 上的 three basis 目录。
   */
  ktx2TranscoderPath?: string | null;
  /** 用于 KTX2 能力探测的渲染器（不传则跳过探测，可能影响压缩贴图）。 */
  renderer?: Parameters<KTX2Loader["detectSupport"]>[0] | null;
  /** 是否启用 EXT_meshopt_compression 解码。默认 true。 */
  meshopt?: boolean;
}

const DEFAULT_DRACO_PATH =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
const DEFAULT_KTX2_PATH =
  "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/basis/";

/**
 * GLTF / GLB 模型加载器。
 *
 * 基于 three.js 官方 {@link GLTFLoader}，并按需装配：
 * - DRACO 几何压缩；
 * - KTX2（Basis Universal）压缩贴图；
 * - EXT_meshopt_compression。
 */
export class GltfModelLoader extends AbstractModelLoader {
  readonly name = "gltf";
  readonly extensions = ["gltf", "glb"] as const;
  readonly mimeTypes = ["model/gltf+json", "model/gltf-binary"] as const;
  override readonly category = "mesh" as const;

  private readonly loader: GLTFLoader;
  private dracoLoader: DRACOLoader | null = null;
  private ktx2Loader: KTX2Loader | null = null;

  constructor(options: GltfModelLoaderOptions = {}) {
    super(options);
    this.loader = new GLTFLoader(this.manager);

    const dracoPath =
      options.dracoDecoderPath === undefined
        ? DEFAULT_DRACO_PATH
        : options.dracoDecoderPath;
    if (dracoPath) {
      this.dracoLoader = new DRACOLoader(this.manager).setDecoderPath(dracoPath);
      this.loader.setDRACOLoader(this.dracoLoader);
    }

    const ktx2Path =
      options.ktx2TranscoderPath === undefined
        ? DEFAULT_KTX2_PATH
        : options.ktx2TranscoderPath;
    if (ktx2Path) {
      this.ktx2Loader = new KTX2Loader(this.manager).setTranscoderPath(ktx2Path);
      if (options.renderer) this.ktx2Loader.detectSupport(options.renderer);
      this.loader.setKTX2Loader(this.ktx2Loader);
    }

    if (options.meshopt !== false) {
      this.loader.setMeshoptDecoder(MeshoptDecoder);
    }
  }

  protected async loadModel(
    context: ModelLoaderContext,
  ): Promise<ModelLoaderPayload> {
    const gltf =
      context.url !== null
        ? await this.loadWithThreeLoader<GLTF>(this.loader, context.url, context)
        : await this.parseBuffer(context);

    return {
      object: gltf.scene,
      animations: gltf.animations,
      raw: gltf,
      extra: {
        generator: gltf.asset?.generator,
        version: gltf.asset?.version,
        sceneCount: gltf.scenes.length,
        cameraCount: gltf.cameras.length,
      },
    };
  }

  private async parseBuffer(context: ModelLoaderContext): Promise<GLTF> {
    const raw = context.source;
    // 对 .gltf（JSON）允许字符串，其余按二进制处理。
    const data: ArrayBuffer | string =
      typeof raw === "string"
        ? raw
        : raw instanceof ArrayBuffer
          ? raw
          : toArrayBuffer(raw);
    return this.loader.parseAsync(data, "");
  }

  override dispose(): void {
    this.dracoLoader?.dispose();
    this.ktx2Loader?.dispose();
    this.dracoLoader = null;
    this.ktx2Loader = null;
  }
}
