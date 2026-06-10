import {
  AbstractTerrainProvider,
} from "./AbstractTerrainProvider";
import { createFbmGenerator, type FbmOptions } from "./noise";
import type {
  TerrainHeightField,
  TerrainHeightGenerator,
  TerrainProviderOptions,
} from "./types";

/** 高程图来源:URL 或已加载的图像/画布。 */
export type HeightmapSource =
  | string
  | HTMLImageElement
  | HTMLCanvasElement
  | ImageBitmap;

/** 高程地形提供者配置。 */
export interface HeightmapTerrainProviderOptions extends TerrainProviderOptions {
  /** 高程图来源(灰度,亮度越高越高)。与 `generator` 二选一。 */
  heightmap?: HeightmapSource;
  /** 程序化高度生成器。未提供 `heightmap` 时使用;默认内置 fBm。 */
  generator?: TerrainHeightGenerator;
  /** 内置 fBm 生成器的参数(仅在使用默认生成器时生效)。 */
  fbm?: FbmOptions;
  /**
   * 栅格分辨率(每边顶点数)。
   * - 程序化:直接决定网格细分;默认 256。
   * - 高程图:对图像重采样到该分辨率;不传则使用图像原始尺寸(上限 1024)。
   */
  resolution?: number;
}

const MAX_IMAGE_RESOLUTION = 1024;

/**
 * 高程地形提供者。
 *
 * 两种高度来源:
 * - **高程图**:从灰度图(URL / Image / Canvas / ImageBitmap)读取亮度作为高度;
 * - **程序化**:无任何外部数据时,用内置 fBm 噪声即时生成连续起伏地形(默认)。
 *
 * 输出标准 Three.js 网格,并提供 `getHeightAt` 以便在地表放置模型 / 约束漫游高度。
 */
export class HeightmapTerrainProvider extends AbstractTerrainProvider {
  readonly name = "heightmap";

  private readonly source: HeightmapSource | null;
  private readonly generator: TerrainHeightGenerator;
  private readonly resolution: number | null;

  constructor(options: HeightmapTerrainProviderOptions = {}) {
    super(options);
    this.source = options.heightmap ?? null;
    this.generator =
      options.generator ?? createFbmGenerator(options.fbm ?? { octaves: 6 });
    this.resolution = options.resolution ?? null;
  }

  protected async sampleHeightField(): Promise<TerrainHeightField> {
    if (this.source) return this.sampleFromImage(this.source);
    return this.sampleFromGenerator(this.resolution ?? 256);
  }

  /** 用程序化生成器在 size×size 栅格上采样。 */
  private sampleFromGenerator(size: number): TerrainHeightField {
    const cols = Math.max(2, Math.floor(size));
    const rows = cols;
    const data = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const nx = c / (cols - 1);
        const nz = r / (rows - 1);
        data[r * cols + c] = this.generator(nx, nz);
      }
    }
    return { data, cols, rows };
  }

  /** 从灰度图读取亮度作为高度。 */
  private async sampleFromImage(
    source: HeightmapSource,
  ): Promise<TerrainHeightField> {
    const image = await this.resolveImage(source);
    const nativeW = "width" in image ? image.width : MAX_IMAGE_RESOLUTION;
    const nativeH = "height" in image ? image.height : MAX_IMAGE_RESOLUTION;

    const target = this.resolution ?? Math.min(nativeW, MAX_IMAGE_RESOLUTION);
    const cols = Math.max(2, Math.min(target, MAX_IMAGE_RESOLUTION));
    const rows = Math.max(
      2,
      Math.min(Math.round((cols * nativeH) / nativeW), MAX_IMAGE_RESOLUTION),
    );

    const canvas = this.createCanvas(cols, rows);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error(`[${this.name}] 无法获取 2D 画布上下文`);
    ctx.drawImage(image as CanvasImageSource, 0, 0, cols, rows);
    const { data: rgba } = ctx.getImageData(0, 0, cols, rows);

    const data = new Float32Array(cols * rows);
    for (let i = 0; i < cols * rows; i += 1) {
      // 采用 Rec.601 亮度;灰度图三通道相同,结果一致。
      const r = rgba[i * 4]!;
      const g = rgba[i * 4 + 1]!;
      const b = rgba[i * 4 + 2]!;
      data[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    return { data, cols, rows };
  }

  private createCanvas(
    w: number,
    h: number,
  ): HTMLCanvasElement | OffscreenCanvas {
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(w, h);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }

  private async resolveImage(
    source: HeightmapSource,
  ): Promise<HTMLImageElement | HTMLCanvasElement | ImageBitmap> {
    if (typeof source !== "string") return source;
    if (typeof createImageBitmap !== "undefined") {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(
          `[${this.name}] 高程图加载失败:${response.status} ${response.statusText}`,
        );
      }
      return createImageBitmap(await response.blob());
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(new Error(`[${this.name}] 高程图加载失败:${source}`));
      img.src = source;
    });
  }
}
