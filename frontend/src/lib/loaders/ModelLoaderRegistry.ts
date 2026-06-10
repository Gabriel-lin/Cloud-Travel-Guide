import type {
  IModelLoader,
  IModelLoaderRegistry,
  ModelFormat,
  ModelLoadOptions,
  ModelLoadResult,
  ModelLoaderFactory,
  ModelLoaderRegisterOptions,
  ModelMatchDescriptor,
  ModelSource,
} from "./types";
import { extractExtension, sniffFormat } from "./utils";

/** 工厂注册项：记录其声明支持的格式，延迟到首次解析时实例化。 */
interface FactoryEntry {
  factory: ModelLoaderFactory;
  formats: readonly ModelFormat[];
  instance: IModelLoader | null;
}

/**
 * 模型加载器注册中心。
 *
 * 维护"格式 → 加载器"的映射，并对外提供统一的加载入口 {@link load}：
 * 根据显式格式、扩展名或二进制魔数自动路由到匹配的加载器。
 * 支持直接注册实例，或注册工厂以实现按需懒加载。
 */
export class ModelLoaderRegistry implements IModelLoaderRegistry {
  private readonly registered: IModelLoader[] = [];
  private readonly byName = new Map<string, IModelLoader>();
  private readonly factories: FactoryEntry[] = [];

  get loaders(): readonly IModelLoader[] {
    return this.registered.slice();
  }

  register(
    loader: IModelLoader,
    options: ModelLoaderRegisterOptions = {},
  ): this {
    const existing = this.byName.get(loader.name);
    if (existing) {
      if (!options.override) {
        throw new Error(
          `已存在同名加载器 "${loader.name}"，如需替换请传入 { override: true }。`,
        );
      }
      this.removeInstance(existing);
    }
    // 新注册的实例置于前列，使其在匹配时优先于既有同格式加载器。
    this.registered.unshift(loader);
    this.byName.set(loader.name, loader);
    return this;
  }

  registerFactory(
    factory: ModelLoaderFactory,
    formats: readonly ModelFormat[],
    options: ModelLoaderRegisterOptions = {},
  ): this {
    if (!options.override) {
      const clash = formats.find((format) => this.has(format));
      if (clash) {
        throw new Error(
          `格式 "${clash}" 已被占用，如需替换请传入 { override: true }。`,
        );
      }
    }
    this.factories.unshift({ factory, formats, instance: null });
    return this;
  }

  unregister(loaderOrName: string | IModelLoader): boolean {
    const name =
      typeof loaderOrName === "string" ? loaderOrName : loaderOrName.name;
    const loader = this.byName.get(name);
    if (!loader) return false;
    this.removeInstance(loader);
    return true;
  }

  has(format: ModelFormat): boolean {
    return this.resolve({ format }) !== null;
  }

  resolve(descriptor: ModelMatchDescriptor): IModelLoader | null {
    for (const loader of this.registered) {
      if (loader.supports(descriptor)) return loader;
    }

    const ext =
      descriptor.extension ??
      extractExtension(descriptor.url ?? descriptor.fileName ?? undefined) ??
      undefined;
    for (const entry of this.factories) {
      const match =
        (descriptor.format && entry.formats.includes(descriptor.format)) ||
        (ext && entry.formats.includes(ext));
      if (match) return this.instantiate(entry);
    }
    return null;
  }

  getByName(name: string): IModelLoader | null {
    return this.byName.get(name) ?? null;
  }

  supportedFormats(): ModelFormat[] {
    const formats = new Set<ModelFormat>();
    for (const loader of this.registered) {
      for (const ext of loader.extensions) formats.add(ext);
    }
    for (const entry of this.factories) {
      for (const format of entry.formats) formats.add(format);
    }
    return [...formats];
  }

  supportedExtensions(): string[] {
    return this.supportedFormats().filter((format) => typeof format === "string");
  }

  async load(
    source: ModelSource,
    options: ModelLoadOptions = {},
  ): Promise<ModelLoadResult> {
    const descriptor = this.describe(source, options);
    let loader = this.resolve(descriptor);

    // 二进制源缺少格式提示时，尝试通过魔数嗅探。
    if (!loader && !descriptor.format) {
      const sniffed = this.sniff(source);
      if (sniffed) {
        descriptor.format = sniffed;
        loader = this.resolve(descriptor);
        if (loader) options = { ...options, format: sniffed };
      }
    }

    if (!loader) {
      throw new Error(
        `未找到可处理该模型的加载器（format=${descriptor.format ?? "?"}, ` +
          `ext=${descriptor.extension ?? "?"}）。已支持：${this.supportedFormats().join(", ")}`,
      );
    }
    return loader.load(source, options);
  }

  dispose(): void {
    for (const loader of this.registered) loader.dispose();
    for (const entry of this.factories) {
      entry.instance?.dispose();
      entry.instance = null;
    }
    this.registered.length = 0;
    this.factories.length = 0;
    this.byName.clear();
  }

  private describe(
    source: ModelSource,
    options: ModelLoadOptions,
  ): ModelMatchDescriptor {
    const url = typeof source === "string" ? source : undefined;
    const hint = url ?? options.fileName;
    return {
      format: options.format,
      url,
      fileName: options.fileName,
      extension: extractExtension(hint) ?? undefined,
    };
  }

  private sniff(source: ModelSource): ModelFormat | null {
    if (source instanceof ArrayBuffer) return sniffFormat(source);
    if (ArrayBuffer.isView(source)) {
      return sniffFormat(
        source.buffer.slice(
          source.byteOffset,
          source.byteOffset + source.byteLength,
        ) as ArrayBuffer,
      );
    }
    return null;
  }

  private instantiate(entry: FactoryEntry): IModelLoader {
    if (!entry.instance) {
      entry.instance = entry.factory();
      this.byName.set(entry.instance.name, entry.instance);
    }
    return entry.instance;
  }

  private removeInstance(loader: IModelLoader): void {
    const index = this.registered.indexOf(loader);
    if (index >= 0) this.registered.splice(index, 1);
    this.byName.delete(loader.name);
  }
}
