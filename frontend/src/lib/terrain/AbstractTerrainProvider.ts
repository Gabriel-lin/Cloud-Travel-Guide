import * as THREE from "three";

import type {
  ITerrainProvider,
  TerrainBuildResult,
  TerrainHeightField,
  TerrainProviderOptions,
} from "./types";

/** 默认高程配色带的控制点(归一化高度 → 颜色)。 */
const DEFAULT_ELEVATION_RAMP: ReadonlyArray<{ t: number; color: THREE.Color }> = [
  { t: 0.0, color: new THREE.Color(0x2b6cb0) }, // 深水
  { t: 0.15, color: new THREE.Color(0x4299e1) }, // 浅水
  { t: 0.22, color: new THREE.Color(0xe2c275) }, // 沙滩
  { t: 0.45, color: new THREE.Color(0x4e9a51) }, // 草地
  { t: 0.7, color: new THREE.Color(0x7a6b4f) }, // 岩石
  { t: 0.88, color: new THREE.Color(0x9c9690) }, // 高地
  { t: 1.0, color: new THREE.Color(0xffffff) }, // 雪顶
];

/**
 * 地形提供者抽象基类。
 *
 * 模板方法:`build()` 固化了 采样高度场 → 归一化 → 构建网格 → 顶点着色 →
 * 计算法线/包围盒 → 暴露 getHeightAt/getNormalAt 的全过程;
 * 实体类只需实现 {@link sampleHeightField}(决定"高度从哪来")。
 */
export abstract class AbstractTerrainProvider implements ITerrainProvider {
  abstract readonly name: string;

  protected readonly width: number;
  protected readonly depth: number;
  protected readonly heightScale: number;
  protected readonly origin: THREE.Vector3;
  protected readonly colorByElevation: boolean;
  protected readonly wireframe: boolean;
  protected readonly customMaterial: THREE.Material | null;
  protected readonly normalizeHeights: boolean;

  constructor(options: TerrainProviderOptions = {}) {
    this.width = options.width ?? 200;
    this.depth = options.depth ?? 200;
    this.normalizeHeights = options.normalizeHeights ?? true;
    this.heightScale = options.heightScale ?? (this.normalizeHeights ? 30 : 1);
    this.origin = options.origin?.clone() ?? new THREE.Vector3();
    this.colorByElevation = options.colorByElevation ?? true;
    this.wireframe = options.wireframe ?? false;
    this.customMaterial = options.material ?? null;
  }

  /** 实体类实现:产出归一化前的高度场(值域任意,基类会归一化)。 */
  protected abstract sampleHeightField(): Promise<TerrainHeightField>;

  async build(): Promise<TerrainBuildResult> {
    const field = await this.sampleHeightField();
    const { cols, rows } = field;
    if (cols < 2 || rows < 2) {
      throw new Error(`[${this.name}] 高度场分辨率过低:${cols}x${rows}`);
    }

    const raw = field.data;
    let rawMin = Infinity;
    let rawMax = -Infinity;
    for (let i = 0; i < raw.length; i += 1) {
      const v = raw[i]!;
      if (v < rawMin) rawMin = v;
      if (v > rawMax) rawMax = v;
    }
    const rawRange = rawMax - rawMin;

    // heightField[i] * heightScale = 本地世界高度(getHeightAt 与顶点共用同一映射)。
    const heightField = this.normalizeHeights ? this.normalize(raw) : raw;

    const positions = new Float32Array(cols * rows * 3);
    const uvs = new Float32Array(cols * rows * 2);
    const colors = this.colorByElevation
      ? new Float32Array(cols * rows * 3)
      : null;

    const halfW = this.width / 2;
    const halfD = this.depth / 2;
    const color = new THREE.Color();

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const i = r * cols + c;
        positions[i * 3] = -halfW + (c / (cols - 1)) * this.width;
        positions[i * 3 + 1] = heightField[i]! * this.heightScale;
        positions[i * 3 + 2] = -halfD + (r / (rows - 1)) * this.depth;
        uvs[i * 2] = c / (cols - 1);
        uvs[i * 2 + 1] = 1 - r / (rows - 1);
        if (colors) {
          const t = rawRange > 1e-8 ? (raw[i]! - rawMin) / rawRange : 0;
          this.sampleRamp(t, color);
          colors[i * 3] = color.r;
          colors[i * 3 + 1] = color.g;
          colors[i * 3 + 2] = color.b;
        }
      }
    }

    const indices = this.buildIndices(cols, rows);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    if (colors) {
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material =
      this.customMaterial ??
      new THREE.MeshStandardMaterial({
        vertexColors: this.colorByElevation,
        color: this.colorByElevation ? 0xffffff : 0x6b7c5a,
        roughness: 0.95,
        metalness: 0.0,
        flatShading: false,
        wireframe: this.wireframe,
      });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${this.name}-terrain`;
    mesh.position.copy(this.origin);
    mesh.receiveShadow = true;

    const boundingBox = new THREE.Box3().setFromObject(mesh);
    const minHeight = (this.normalizeHeights ? 0 : rawMin) * this.heightScale + this.origin.y;
    const maxHeight =
      (this.normalizeHeights ? 1 : rawMax) * this.heightScale + this.origin.y;

    return {
      object: mesh,
      mesh,
      boundingBox,
      size: { width: this.width, depth: this.depth, minHeight, maxHeight },
      getHeightAt: (x, z) => this.sampleHeight(heightField, cols, rows, x, z),
      getNormalAt: (x, z, target) =>
        this.sampleNormal(heightField, cols, rows, x, z, target),
      dispose: () => {
        geometry.dispose();
        if (!this.customMaterial) material.dispose();
      },
    };
  }

  dispose(): void {
    // 默认无状态;持有外部资源的实体类可覆写。
  }

  /** 将任意值域的高度场线性归一化到 [0,1]。 */
  protected normalize(data: Float32Array): Float32Array {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < data.length; i += 1) {
      const v = data[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = max - min;
    if (range <= 1e-8) return new Float32Array(data.length);
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 1) out[i] = (data[i]! - min) / range;
    return out;
  }

  private buildIndices(cols: number, rows: number): THREE.BufferAttribute {
    const quadCount = (cols - 1) * (rows - 1);
    const array =
      cols * rows > 65535
        ? new Uint32Array(quadCount * 6)
        : new Uint16Array(quadCount * 6);
    let offset = 0;
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        array[offset++] = a;
        array[offset++] = d;
        array[offset++] = b;
        array[offset++] = b;
        array[offset++] = d;
        array[offset++] = e;
      }
    }
    return new THREE.BufferAttribute(array, 1);
  }

  private sampleRamp(t: number, target: THREE.Color): THREE.Color {
    const ramp = DEFAULT_ELEVATION_RAMP;
    if (t <= ramp[0]!.t) return target.copy(ramp[0]!.color);
    const last = ramp[ramp.length - 1]!;
    if (t >= last.t) return target.copy(last.color);
    for (let i = 1; i < ramp.length; i += 1) {
      const hi = ramp[i]!;
      if (t <= hi.t) {
        const lo = ramp[i - 1]!;
        const k = (t - lo.t) / (hi.t - lo.t);
        return target.copy(lo.color).lerp(hi.color, k);
      }
    }
    return target.copy(last.color);
  }

  /** 将世界坐标映射到高度场的分数栅格坐标 (col, row)。 */
  private toGridCoords(
    cols: number,
    rows: number,
    x: number,
    z: number,
  ): { gc: number; gr: number } {
    const lx = x - this.origin.x;
    const lz = z - this.origin.z;
    const u = (lx + this.width / 2) / this.width;
    const v = (lz + this.depth / 2) / this.depth;
    const gc = Math.min(Math.max(u, 0), 1) * (cols - 1);
    const gr = Math.min(Math.max(v, 0), 1) * (rows - 1);
    return { gc, gr };
  }

  /** 双线性插值采样高度(返回世界 Y)。 */
  protected sampleHeight(
    field: Float32Array,
    cols: number,
    rows: number,
    x: number,
    z: number,
  ): number {
    const { gc, gr } = this.toGridCoords(cols, rows, x, z);
    const c0 = Math.floor(gc);
    const r0 = Math.floor(gr);
    const c1 = Math.min(c0 + 1, cols - 1);
    const r1 = Math.min(r0 + 1, rows - 1);
    const tx = gc - c0;
    const tz = gr - r0;

    const h00 = field[r0 * cols + c0]!;
    const h10 = field[r0 * cols + c1]!;
    const h01 = field[r1 * cols + c0]!;
    const h11 = field[r1 * cols + c1]!;
    const top = h00 + (h10 - h00) * tx;
    const bottom = h01 + (h11 - h01) * tx;
    const h = top + (bottom - top) * tz;
    return h * this.heightScale + this.origin.y;
  }

  /** 通过中心差分估计地表法线。 */
  protected sampleNormal(
    field: Float32Array,
    cols: number,
    rows: number,
    x: number,
    z: number,
    target = new THREE.Vector3(),
  ): THREE.Vector3 {
    const dx = this.width / (cols - 1);
    const dz = this.depth / (rows - 1);
    const hL = this.sampleHeight(field, cols, rows, x - dx, z);
    const hR = this.sampleHeight(field, cols, rows, x + dx, z);
    const hD = this.sampleHeight(field, cols, rows, x, z - dz);
    const hU = this.sampleHeight(field, cols, rows, x, z + dz);
    return target.set(-(hR - hL) / (2 * dx), 1, -(hU - hD) / (2 * dz)).normalize();
  }
}
