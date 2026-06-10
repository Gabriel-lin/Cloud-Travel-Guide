import type * as THREE from "three";

/**
 * 模型加载体系的公共类型定义。
 *
 * 设计目标：
 * - 以 `interface` 描述"加载器"与"加载器注册中心"两套契约；
 * - 以 `ModelFormat` 收敛主流格式（gltf/glb、obj、fbx、ply 以及主流高斯泼溅格式）；
 * - 通过 `(string & {})` 保留字面量自动补全的同时允许扩展自定义格式。
 */

/** 内置可识别的主流模型 / 点云 / 高斯泼溅格式。 */
export type KnownModelFormat =
  // 网格 / 场景
  | "gltf"
  | "glb"
  | "obj"
  | "fbx"
  // 点云
  | "ply"
  // 高斯泼溅（Gaussian Splatting）主流格式
  | "splat"
  | "ksplat"
  | "spz";

/** 模型格式标识，允许扩展自定义字符串。 */
export type ModelFormat = KnownModelFormat | (string & {});

/** 资源的大类，便于上层按渲染方式区分处理。 */
export type ModelCategory = "mesh" | "pointcloud" | "splat";

/** 可被加载的数据源：远程/本地 URL 或内存中的二进制数据。 */
export type ModelSource = string | ArrayBuffer | ArrayBufferView;

/** 加载进度信息。 */
export interface LoadProgress {
  /** 已加载字节数。 */
  loaded: number;
  /** 总字节数；无法获知时为 0。 */
  total: number;
  /** 进度比例 [0,1]；当总大小未知时为 undefined。 */
  ratio: number | undefined;
  /** 总大小是否可计算。 */
  lengthComputable: boolean;
}

/** 单次加载的可选参数。 */
export interface ModelLoadOptions {
  /** 显式指定格式，优先级高于根据扩展名/魔数的自动推断。 */
  format?: ModelFormat;
  /** 取消信号，用于中断进行中的加载。 */
  signal?: AbortSignal;
  /** 进度回调。 */
  onProgress?: (progress: LoadProgress) => void;
  /** 当数据源为二进制时，用于推断格式的文件名提示。 */
  fileName?: string;
  /** 自定义请求头（仅对 URL 数据源有效）。 */
  requestHeaders?: Record<string, string>;
  /** 是否携带跨域凭证（仅对 URL 数据源有效）。 */
  withCredentials?: boolean;
  /** 透传给具体加载器的额外参数。 */
  extra?: Record<string, unknown>;
}

/** 用于在注册中心匹配加载器的描述符。 */
export interface ModelMatchDescriptor {
  format?: ModelFormat;
  /** 小写、不含点号的扩展名，如 `glb`。 */
  extension?: string;
  mimeType?: string;
  url?: string;
  fileName?: string;
}

/** 加载结果的统计元信息。 */
export interface ModelMetadata {
  format: ModelFormat;
  category: ModelCategory;
  /** 场景图中对象（Object3D）总数。 */
  objectCount: number;
  meshCount: number;
  vertexCount: number;
  triangleCount: number;
  materialCount: number;
  textureCount: number;
  animationCount: number;
  /** 高斯泼溅 / 点云的点（splat）数量。 */
  splatCount?: number;
  boundingBox: THREE.Box3 | null;
  boundingSphere: THREE.Sphere | null;
  /** 加载器自定义的附加信息。 */
  extra?: Record<string, unknown>;
}

/** 统一的加载结果。 */
export interface ModelLoadResult {
  /** 可直接 `scene.add(...)` 的根对象。 */
  object: THREE.Object3D;
  /** 动画轨道（无动画时为空数组）。 */
  animations: THREE.AnimationClip[];
  format: ModelFormat;
  category: ModelCategory;
  /** 产生该结果的加载器名称。 */
  loaderName: string;
  /** 原始数据源（URL 字符串或 `<buffer>` 占位）。 */
  source: string;
  metadata: ModelMetadata;
  /** 加载器特定的原始负载，例如 GLTF 对象或高斯泼溅原始数据。 */
  raw?: unknown;
  /** 释放该结果占用的 GPU / 内存资源。 */
  dispose(): void;
}

/**
 * 模型加载器契约。
 *
 * 每种格式（或一组相近格式）对应一个实现了该接口的加载器；
 * 抽象基类 `AbstractModelLoader` 提供了通用实现，具体加载器只需补全解析逻辑。
 */
export interface IModelLoader {
  /** 加载器唯一名称（注册中心以此作为键）。 */
  readonly name: string;
  /** 支持的扩展名集合（小写、不含点号）。 */
  readonly extensions: readonly string[];
  /** 支持的 MIME 类型集合。 */
  readonly mimeTypes: readonly string[];
  /** 资源大类。 */
  readonly category: ModelCategory;

  /** 判断该加载器能否处理给定描述符。 */
  supports(descriptor: ModelMatchDescriptor): boolean;

  /** 执行加载并返回统一结果。 */
  load(source: ModelSource, options?: ModelLoadOptions): Promise<ModelLoadResult>;

  /** 释放加载器自身持有的资源（如 Worker、解码器等）。 */
  dispose(): void;
}

/** 加载器工厂：注册中心可延迟实例化加载器。 */
export type ModelLoaderFactory = () => IModelLoader;

/** 注册时的可选项。 */
export interface ModelLoaderRegisterOptions {
  /** 是否允许覆盖同名加载器。 */
  override?: boolean;
}

/**
 * 模型加载器注册中心契约。
 *
 * 负责维护"格式 → 加载器"的映射，并对外暴露统一的加载入口；
 * 上层只需面向该接口即可加载任意已注册格式，无需关心具体实现。
 */
export interface IModelLoaderRegistry {
  /** 当前已注册的加载器（只读快照）。 */
  readonly loaders: readonly IModelLoader[];

  /** 注册一个加载器实例。 */
  register(loader: IModelLoader, options?: ModelLoaderRegisterOptions): this;

  /** 注册一个加载器工厂（首次解析到对应格式时实例化）。 */
  registerFactory(
    factory: ModelLoaderFactory,
    formats: readonly ModelFormat[],
    options?: ModelLoaderRegisterOptions,
  ): this;

  /** 注销加载器（按名称或实例）。 */
  unregister(loaderOrName: string | IModelLoader): boolean;

  /** 是否已存在可处理该格式的加载器。 */
  has(format: ModelFormat): boolean;

  /** 解析出能处理给定描述符的加载器（找不到返回 null）。 */
  resolve(descriptor: ModelMatchDescriptor): IModelLoader | null;

  /** 按名称获取加载器。 */
  getByName(name: string): IModelLoader | null;

  /** 列出全部受支持格式。 */
  supportedFormats(): ModelFormat[];

  /** 列出全部受支持扩展名。 */
  supportedExtensions(): string[];

  /** 统一加载入口：自动路由到匹配的加载器。 */
  load(source: ModelSource, options?: ModelLoadOptions): Promise<ModelLoadResult>;

  /** 释放全部已注册加载器的资源并清空注册表。 */
  dispose(): void;
}
