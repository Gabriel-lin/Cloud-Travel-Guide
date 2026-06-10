import * as THREE from "three";

import { AbstractTerrainProvider } from "./AbstractTerrainProvider";
import type {
  TerrainBuildResult,
  TerrainHeightField,
  TerrainProviderOptions,
} from "./types";

/** 地理中心点(度)。 */
export interface TerrainCenter {
  lat: number;
  lon: number;
}

/** 免费瓦片地形提供者配置。 */
export interface TiledDemTerrainProviderOptions
  extends Pick<TerrainProviderOptions, "origin" | "wireframe" | "colorByElevation"> {
  /** 地形中心经纬度。 */
  center: TerrainCenter;
  /** 切片缩放级别(越大越精细、范围越小)。默认 12。 */
  zoom?: number;
  /** 以中心瓦片为中心,向四周扩展的瓦片圈数。默认 2(5×5)。 */
  tileRadius?: number;
  /** 每个瓦片的采样分辨率(决定网格密度)。默认 64。 */
  samplesPerTile?: number;
  /** 垂直夸张系数。默认 1.5。 */
  exaggeration?: number;
  /**
   * 高程瓦片地址模板(Terrarium 编码 PNG)。
   * 默认使用 AWS 开放数据(无需 Key)。
   */
  demUrlTemplate?: string;
  /**
   * 卫星影像瓦片地址模板;传 null 则不贴影像、改用高程配色。
   * 默认使用 Esri World Imagery(无需 Key)。
   */
  imageryUrlTemplate?: string | null;
  /** 自定义版权归属文本。 */
  attribution?: string;
}

const DEG2RAD = Math.PI / 180;
const TILE_PX = 256;
/** Web Mercator 在赤道、zoom 0 时每像素米数。 */
const EQUATOR_M_PER_PX = 156543.03392804097;

const DEFAULT_DEM_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const DEFAULT_IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const DEFAULT_ATTRIBUTION =
  "高程: Mapzen / AWS Terrain Tiles · 影像: Esri, Maxar, Earthstar Geographics";

/**
 * 免费(无需 API Key)的真实地形提供者。
 *
 * 通过开放的 **Terrarium 高程瓦片**(AWS Open Data)解码真实海拔,
 * 拼接为网格并复用 {@link AbstractTerrainProvider} 构建地形;
 * 同时可叠加免费的 **Esri World Imagery** 卫星影像作为贴图。
 *
 * 全程使用支持 CORS 的公开瓦片服务,开箱即用、零计费。
 * 与 Google 实景三维(需 Key)互补:这是"免费真实地形"的推荐路径。
 */
export class TiledDemTerrainProvider extends AbstractTerrainProvider {
  readonly name = "tiled-dem";

  private readonly zoom: number;
  private readonly tilesPerSide: number;
  private readonly samplesPerTile: number;
  private readonly centerTileX: number;
  private readonly centerTileY: number;
  private readonly demUrlTemplate: string;
  private readonly imageryUrlTemplate: string | null;
  private readonly attributionText: string;
  private imageryTexture: THREE.Texture | null = null;

  constructor(options: TiledDemTerrainProviderOptions) {
    const zoom = options.zoom ?? 12;
    const tileRadius = options.tileRadius ?? 2;
    const tilesPerSide = tileRadius * 2 + 1;
    const latRad = options.center.lat * DEG2RAD;
    const mPerPx = (EQUATOR_M_PER_PX * Math.cos(latRad)) / 2 ** zoom;
    const blockMeters = tilesPerSide * TILE_PX * mPerPx;
    const useImagery = options.imageryUrlTemplate !== null;

    super({
      width: blockMeters,
      depth: blockMeters,
      normalizeHeights: false,
      heightScale: options.exaggeration ?? 1.5,
      colorByElevation: options.colorByElevation ?? !useImagery,
      origin: options.origin,
      wireframe: options.wireframe,
    });

    this.zoom = zoom;
    this.tilesPerSide = tilesPerSide;
    this.samplesPerTile = options.samplesPerTile ?? 64;
    this.demUrlTemplate = options.demUrlTemplate ?? DEFAULT_DEM_URL;
    this.imageryUrlTemplate = useImagery
      ? (options.imageryUrlTemplate ?? DEFAULT_IMAGERY_URL)
      : null;
    this.attributionText = options.attribution ?? DEFAULT_ATTRIBUTION;

    const n2 = 2 ** zoom;
    this.centerTileX = Math.floor(this.lonToTileX(options.center.lon, zoom));
    this.centerTileY = Math.min(
      n2 - 1,
      Math.max(0, Math.floor(this.latToTileY(options.center.lat, zoom))),
    );
  }

  /** 数据版权归属(展示给用户)。 */
  getAttribution(): string {
    return this.attributionText;
  }

  override async build(): Promise<TerrainBuildResult> {
    const result = await super.build();
    if (this.imageryTexture) {
      const material = result.mesh.material as THREE.MeshStandardMaterial;
      material.map = this.imageryTexture;
      material.color.set(0xffffff);
      material.needsUpdate = true;

      const baseDispose = result.dispose;
      const texture = this.imageryTexture;
      result.dispose = () => {
        baseDispose();
        texture.dispose();
      };
    }
    return result;
  }

  protected async sampleHeightField(): Promise<TerrainHeightField> {
    const n = this.tilesPerSide;
    const half = Math.floor(n / 2);
    const canvasSize = n * TILE_PX;

    const demCanvas = this.createCanvas(canvasSize, canvasSize);
    const dctx = demCanvas.getContext("2d", { willReadFrequently: true });
    if (!dctx) throw new Error(`[${this.name}] 无法获取 2D 画布上下文`);

    const imageryCanvas = this.imageryUrlTemplate
      ? this.createCanvas(canvasSize, canvasSize)
      : null;
    const ictx = imageryCanvas?.getContext("2d") ?? null;

    const n2 = 2 ** this.zoom;
    const jobs: Promise<void>[] = [];
    for (let ty = 0; ty < n; ty += 1) {
      for (let tx = 0; tx < n; tx += 1) {
        const tileX = (((this.centerTileX - half + tx) % n2) + n2) % n2;
        const tileY = this.centerTileY - half + ty;
        if (tileY < 0 || tileY >= n2) continue;
        const px = tx * TILE_PX;
        const py = ty * TILE_PX;

        jobs.push(
          this.loadImage(
            this.formatUrl(this.demUrlTemplate, tileX, tileY),
          )
            .then((img) => dctx.drawImage(img, px, py))
            .catch(() => {}),
        );
        if (ictx && this.imageryUrlTemplate) {
          jobs.push(
            this.loadImage(
              this.formatUrl(this.imageryUrlTemplate, tileX, tileY),
            )
              .then((img) => ictx.drawImage(img, px, py))
              .catch(() => {}),
          );
        }
      }
    }
    await Promise.all(jobs);

    // 由拼接后的高程画布按目标分辨率重采样,解码 Terrarium 高度(米)。
    const cols = n * this.samplesPerTile;
    const rows = cols;
    const pixels = dctx.getImageData(0, 0, canvasSize, canvasSize).data;
    const data = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r += 1) {
      const sy = Math.round((r / (rows - 1)) * (canvasSize - 1));
      for (let c = 0; c < cols; c += 1) {
        const sx = Math.round((c / (cols - 1)) * (canvasSize - 1));
        const p = (sy * canvasSize + sx) * 4;
        const rr = pixels[p]!;
        const gg = pixels[p + 1]!;
        const bb = pixels[p + 2]!;
        data[r * cols + c] = rr * 256 + gg + bb / 256 - 32768;
      }
    }

    if (imageryCanvas) {
      const texture = new THREE.CanvasTexture(imageryCanvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      this.imageryTexture = texture;
    }

    return { data, cols, rows };
  }

  private lonToTileX(lon: number, zoom: number): number {
    return ((lon + 180) / 360) * 2 ** zoom;
  }

  private latToTileY(lat: number, zoom: number): number {
    const latRad = lat * DEG2RAD;
    return (
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      2 ** zoom
    );
  }

  private formatUrl(template: string, x: number, y: number): string {
    return template
      .replace("{z}", String(this.zoom))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
  }

  private createCanvas(w: number, h: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`瓦片加载失败:${url}`));
      img.src = url;
    });
  }
}
