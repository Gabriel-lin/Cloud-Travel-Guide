import * as THREE from "three";

import type {
  IModelLoader,
  LoadProgress,
  ModelCategory,
  ModelFormat,
  ModelLoadOptions,
  ModelLoadResult,
  ModelMatchDescriptor,
  ModelSource,
} from "./types";
import {
  computeMetadata,
  disposeObject,
  extractExtension,
  throwIfAborted,
  toArrayBuffer,
  toLoadProgress,
  withAbort,
} from "./utils";

/** 抽象基类的构造可选项。 */
export interface AbstractModelLoaderOptions {
  /** 复用的 three.js LoadingManager。 */
  manager?: THREE.LoadingManager;
}

/** 具体加载器解析后返回的中间负载，由基类组装为统一结果。 */
export interface ModelLoaderPayload {
  /** 解析得到的根对象。 */
  object: THREE.Object3D;
  /** 动画轨道。 */
  animations?: THREE.AnimationClip[];
  /** 覆盖默认大类（如点云/泼溅）。 */
  category?: ModelCategory;
  /** 原始负载，原样透传到结果的 `raw` 字段。 */
  raw?: unknown;
  /** 点 / splat 数量（点云/泼溅类专用）。 */
  splatCount?: number;
  /** 自定义释放逻辑；提供后基类不再自动释放对象树。 */
  dispose?: () => void;
  /** 附加元信息。 */
  extra?: Record<string, unknown>;
}

/** 传递给具体加载器解析方法的上下文。 */
export interface ModelLoaderContext {
  source: ModelSource;
  options: ModelLoadOptions;
  format: ModelFormat;
  /** 当数据源为 URL 时的地址，否则为 null。 */
  url: string | null;
  signal: AbortSignal | undefined;
  /** 已包装的进度上报函数。 */
  reportProgress: (progress: LoadProgress) => void;
}

/**
 * 模型加载器抽象基类。
 *
 * 采用"模板方法"模式：
 * - `load()` 固化了 取消检查 → 格式推断 → 解析 → 组装结果 → 统计元信息 的公共流程；
 * - 子类只需实现 {@link loadModel}，专注于"如何把数据变成 Object3D"。
 */
export abstract class AbstractModelLoader implements IModelLoader {
  abstract readonly name: string;
  abstract readonly extensions: readonly string[];
  readonly mimeTypes: readonly string[] = [];
  readonly category: ModelCategory = "mesh";

  protected readonly manager: THREE.LoadingManager;

  constructor(options: AbstractModelLoaderOptions = {}) {
    this.manager = options.manager ?? THREE.DefaultLoadingManager;
  }

  supports(descriptor: ModelMatchDescriptor): boolean {
    const ext =
      descriptor.extension ??
      extractExtension(descriptor.url ?? descriptor.fileName ?? undefined) ??
      undefined;

    if (descriptor.format && this.extensions.includes(descriptor.format)) {
      return true;
    }
    if (ext && this.extensions.includes(ext)) return true;
    if (descriptor.mimeType && this.mimeTypes.includes(descriptor.mimeType)) {
      return true;
    }
    return false;
  }

  async load(
    source: ModelSource,
    options: ModelLoadOptions = {},
  ): Promise<ModelLoadResult> {
    const signal = options.signal;
    throwIfAborted(signal);

    const url = typeof source === "string" ? source : null;
    const format = this.resolveFormat(source, options);

    const reportProgress = (progress: LoadProgress) => {
      options.onProgress?.(progress);
    };

    const context: ModelLoaderContext = {
      source,
      options,
      format,
      url,
      signal,
      reportProgress,
    };

    const payload = await this.loadModel(context);
    throwIfAborted(signal);

    return this.buildResult(payload, context);
  }

  dispose(): void {
    // 默认无状态；持有 Worker / 解码器的子类应覆写本方法。
  }

  /** 子类实现：将数据源解析为中间负载。 */
  protected abstract loadModel(
    context: ModelLoaderContext,
  ): Promise<ModelLoaderPayload>;

  /** 推断本次加载的格式：显式声明 > 扩展名（URL / fileName）。 */
  protected resolveFormat(
    source: ModelSource,
    options: ModelLoadOptions,
  ): ModelFormat {
    if (options.format) return options.format;

    const hint =
      typeof source === "string" ? source : (options.fileName ?? undefined);
    const ext = extractExtension(hint);
    if (ext && this.extensions.includes(ext)) return ext;

    // 单格式加载器可直接退化为其唯一支持的格式。
    if (this.extensions.length === 1) return this.extensions[0]!;

    throw new Error(
      `[${this.name}] 无法推断模型格式，请通过 options.format 或 options.fileName 指定。`,
    );
  }

  /** 读取数据源为 ArrayBuffer（URL 经 fetch 获取，支持进度与取消）。 */
  protected async readArrayBuffer(
    context: ModelLoaderContext,
  ): Promise<ArrayBuffer> {
    const { source } = context;
    if (source instanceof ArrayBuffer) return source;
    if (ArrayBuffer.isView(source)) return toArrayBuffer(source);
    return this.fetchArrayBuffer(source, context);
  }

  /** 通过 fetch 读取 URL，并按可读流上报下载进度。 */
  protected async fetchArrayBuffer(
    url: string,
    context: ModelLoaderContext,
  ): Promise<ArrayBuffer> {
    const { options, signal, reportProgress } = context;
    const response = await fetch(url, {
      signal,
      headers: options.requestHeaders,
      credentials: options.withCredentials ? "include" : "same-origin",
    });
    if (!response.ok) {
      throw new Error(
        `[${this.name}] 加载失败：${response.status} ${response.statusText} (${url})`,
      );
    }

    const total = Number(response.headers.get("content-length") ?? 0);
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      reportProgress({
        loaded: buffer.byteLength,
        total: buffer.byteLength,
        ratio: 1,
        lengthComputable: true,
      });
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        reportProgress({
          loaded,
          total,
          lengthComputable: total > 0,
          ratio: total > 0 ? loaded / total : undefined,
        });
      }
    }

    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged.buffer;
  }

  /**
   * 调用底层 three.js Loader 的 `loadAsync`，统一处理进度与取消。
   * 适用于需要解析相对资源（贴图、.bin）的场景（如 GLTF）。
   */
  protected loadWithThreeLoader<T>(
    loader: { loadAsync(url: string, onProgress?: (e: ProgressEvent) => void): Promise<T> },
    url: string,
    context: ModelLoaderContext,
  ): Promise<T> {
    const promise = loader.loadAsync(url, (event) => {
      context.reportProgress(toLoadProgress(event));
    });
    return withAbort(promise, context.signal);
  }

  /** 将中间负载组装为对外的统一结果。 */
  protected buildResult(
    payload: ModelLoaderPayload,
    context: ModelLoaderContext,
  ): ModelLoadResult {
    const category = payload.category ?? this.category;
    const animations = payload.animations ?? [];
    const metadata = computeMetadata(
      payload.object,
      context.format,
      category,
      payload.extra,
    );
    metadata.animationCount = animations.length;
    if (payload.splatCount !== undefined) metadata.splatCount = payload.splatCount;

    const sourceLabel =
      context.url ??
      (context.source instanceof ArrayBuffer || ArrayBuffer.isView(context.source)
        ? `<buffer:${context.format}>`
        : String(context.source));

    const object = payload.object;
    const raw = payload.raw;
    const customDispose = payload.dispose;
    let disposed = false;

    return {
      object,
      animations,
      format: context.format,
      category,
      loaderName: this.name,
      source: sourceLabel,
      metadata,
      raw,
      dispose() {
        if (disposed) return;
        disposed = true;
        if (customDispose) customDispose();
        else disposeObject(object);
      },
    };
  }
}
