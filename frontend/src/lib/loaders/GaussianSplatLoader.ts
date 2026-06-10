import * as THREE from "three";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";

import {
  AbstractModelLoader,
  type AbstractModelLoaderOptions,
  type ModelLoaderContext,
  type ModelLoaderPayload,
} from "./AbstractModelLoader";
import type { ModelFormat } from "./types";

/** 解码后的高斯泼溅原始数据（与渲染方式无关）。 */
export interface GaussianSplatData {
  /** 高斯点数量。 */
  count: number;
  /** 位置，长度 count*3。 */
  positions: Float32Array;
  /** 颜色 RGBA（0-255），长度 count*4。 */
  colors: Uint8Array;
  /** 各轴缩放（已解对数），长度 count*3。 */
  scales?: Float32Array;
  /** 旋转四元数（wxyz），长度 count*4。 */
  rotations?: Float32Array;
  /** 不透明度 [0,1]，长度 count。 */
  opacities?: Float32Array;
}

/**
 * 高斯泼溅解码器签名。
 *
 * 通过它，可为 `.ksplat`、`.spz` 等需要额外依赖的格式注入解码实现，
 * 而无需修改加载器本身——这正是"格式可扩展"的关键扩展点。
 */
export type GaussianSplatDecoder = (
  buffer: ArrayBuffer,
  context: ModelLoaderContext,
) => GaussianSplatData | Promise<GaussianSplatData>;

/** 高斯泼溅加载器配置。 */
export interface GaussianSplatLoaderOptions extends AbstractModelLoaderOptions {
  /** 点的渲染尺寸（用于基础点云预览）。默认 0.01。 */
  pointSize?: number;
  /** 自定义/额外格式解码器，按格式（扩展名）注入，可覆盖内置实现。 */
  decoders?: Partial<Record<ModelFormat, GaussianSplatDecoder>>;
}

/** 球谐 0 阶系数，用于由 f_dc 还原基础颜色。 */
const SH_C0 = 0.28209479177387814;

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * 高斯泼溅（Gaussian Splatting）模型加载器。
 *
 * 内置支持：
 * - `.splat`：antimatter15 通用二进制布局（32 字节/点）；
 * - `.ply`：3D Gaussian Splatting 的 binary_little_endian 布局（含 f_dc / scale / rot / opacity）；
 *   非高斯的标准 PLY 自动回退到 three.js {@link PLYLoader} 以点云形式呈现。
 *
 * 可扩展支持：
 * - `.ksplat`、`.spz` 等：通过 `options.decoders` 注入解码函数即可启用。
 *
 * 渲染策略：默认产出彩色 `THREE.Points` 作为通用、零额外依赖的预览；
 * 完整的椭球泼溅渲染（需排序 + 自定义着色器）可基于结果中的 `raw`（{@link GaussianSplatData}）自行实现。
 */
export class GaussianSplatLoader extends AbstractModelLoader {
  readonly name = "gaussian-splat";
  readonly extensions = ["splat", "ksplat", "spz", "ply"] as const;
  readonly mimeTypes = [
    "application/octet-stream",
    "application/ply",
  ] as const;
  override readonly category = "splat" as const;

  private readonly pointSize: number;
  private readonly decoders: Partial<Record<ModelFormat, GaussianSplatDecoder>>;

  constructor(options: GaussianSplatLoaderOptions = {}) {
    super(options);
    this.pointSize = options.pointSize ?? 0.01;
    this.decoders = {
      splat: (buffer) => this.decodeSplat(buffer),
      ply: (buffer) => this.decodePly(buffer),
      ...options.decoders,
    };
  }

  protected async loadModel(
    context: ModelLoaderContext,
  ): Promise<ModelLoaderPayload> {
    const buffer = await this.readArrayBuffer(context);
    const decoder = this.decoders[context.format];
    if (!decoder) {
      throw new Error(
        `[${this.name}] 暂未内置 "${context.format}" 解码器；` +
          `请通过 options.decoders 注入对应的 GaussianSplatDecoder。`,
      );
    }

    const data = await decoder(buffer, context);
    const points = this.buildPoints(data);

    return {
      object: points,
      category: "splat",
      raw: data,
      splatCount: data.count,
      dispose: () => {
        points.geometry.dispose();
        (points.material as THREE.Material).dispose();
      },
      extra: { pointSize: this.pointSize },
    };
  }

  /** 由解码数据构建可直接渲染的彩色点云。 */
  private buildPoints(data: GaussianSplatData): THREE.Points {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(data.positions, 3),
    );

    const colors = new Float32Array(data.count * 3);
    for (let i = 0; i < data.count; i += 1) {
      colors[i * 3] = data.colors[i * 4]! / 255;
      colors[i * 3 + 1] = data.colors[i * 4 + 1]! / 255;
      colors[i * 3 + 2] = data.colors[i * 4 + 2]! / 255;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.PointsMaterial({
      size: this.pointSize,
      sizeAttenuation: true,
      vertexColors: true,
    });

    const points = new THREE.Points(geometry, material);
    points.name = "GaussianSplatPoints";
    return points;
  }

  /**
   * 解码 antimatter15 `.splat` 二进制格式。
   * 每个点 32 字节：position(12) + scale(12) + rgba(4) + rotation(4)。
   */
  private decodeSplat(buffer: ArrayBuffer): GaussianSplatData {
    const ROW = 32;
    const count = Math.floor(buffer.byteLength / ROW);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count * 3);
    const colors = new Uint8Array(count * 4);
    const rotations = new Float32Array(count * 4);
    const opacities = new Float32Array(count);

    for (let i = 0; i < count; i += 1) {
      const base = i * ROW;
      positions[i * 3] = view.getFloat32(base, true);
      positions[i * 3 + 1] = view.getFloat32(base + 4, true);
      positions[i * 3 + 2] = view.getFloat32(base + 8, true);

      scales[i * 3] = view.getFloat32(base + 12, true);
      scales[i * 3 + 1] = view.getFloat32(base + 16, true);
      scales[i * 3 + 2] = view.getFloat32(base + 20, true);

      colors[i * 4] = bytes[base + 24]!;
      colors[i * 4 + 1] = bytes[base + 25]!;
      colors[i * 4 + 2] = bytes[base + 26]!;
      colors[i * 4 + 3] = bytes[base + 27]!;
      opacities[i] = bytes[base + 27]! / 255;

      rotations[i * 4] = (bytes[base + 28]! - 128) / 128;
      rotations[i * 4 + 1] = (bytes[base + 29]! - 128) / 128;
      rotations[i * 4 + 2] = (bytes[base + 30]! - 128) / 128;
      rotations[i * 4 + 3] = (bytes[base + 31]! - 128) / 128;
    }

    return { count, positions, colors, scales, rotations, opacities };
  }

  /**
   * 解码 PLY：优先按 3D Gaussian Splatting 布局解析；
   * 若非高斯（无 f_dc_* 属性），回退到 three.js PLYLoader 作为标准点云。
   */
  private decodePly(buffer: ArrayBuffer): GaussianSplatData {
    const gaussian = this.tryDecodeGaussianPly(buffer);
    if (gaussian) return gaussian;
    return this.decodeStandardPly(buffer);
  }

  /** 解析高斯 PLY（仅支持 binary_little_endian）。非高斯返回 null。 */
  private tryDecodeGaussianPly(buffer: ArrayBuffer): GaussianSplatData | null {
    const header = readPlyHeader(buffer);
    if (!header) return null;
    if (header.format !== "binary_little_endian") return null;
    if (!header.properties.has("f_dc_0")) return null;

    const { count, stride, properties, dataOffset } = header;
    const view = new DataView(buffer, dataOffset);

    const positions = new Float32Array(count * 3);
    const colors = new Uint8Array(count * 4);
    const scales = new Float32Array(count * 3);
    const rotations = new Float32Array(count * 4);
    const opacities = new Float32Array(count);

    const read = (row: number, name: string): number => {
      const prop = properties.get(name);
      if (!prop) return 0;
      return readPlyValue(view, row * stride + prop.offset, prop.type);
    };

    const hasOpacity = properties.has("opacity");
    const hasScale = properties.has("scale_0");
    const hasRot = properties.has("rot_0");

    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = read(i, "x");
      positions[i * 3 + 1] = read(i, "y");
      positions[i * 3 + 2] = read(i, "z");

      const r = clamp01(0.5 + SH_C0 * read(i, "f_dc_0"));
      const g = clamp01(0.5 + SH_C0 * read(i, "f_dc_1"));
      const b = clamp01(0.5 + SH_C0 * read(i, "f_dc_2"));
      const a = hasOpacity ? sigmoid(read(i, "opacity")) : 1;
      colors[i * 4] = Math.round(r * 255);
      colors[i * 4 + 1] = Math.round(g * 255);
      colors[i * 4 + 2] = Math.round(b * 255);
      colors[i * 4 + 3] = Math.round(a * 255);
      opacities[i] = a;

      if (hasScale) {
        scales[i * 3] = Math.exp(read(i, "scale_0"));
        scales[i * 3 + 1] = Math.exp(read(i, "scale_1"));
        scales[i * 3 + 2] = Math.exp(read(i, "scale_2"));
      }
      if (hasRot) {
        const w = read(i, "rot_0");
        const x = read(i, "rot_1");
        const y = read(i, "rot_2");
        const z = read(i, "rot_3");
        const len = Math.hypot(w, x, y, z) || 1;
        rotations[i * 4] = w / len;
        rotations[i * 4 + 1] = x / len;
        rotations[i * 4 + 2] = y / len;
        rotations[i * 4 + 3] = z / len;
      }
    }

    return {
      count,
      positions,
      colors,
      scales: hasScale ? scales : undefined,
      rotations: hasRot ? rotations : undefined,
      opacities: hasOpacity ? opacities : undefined,
    };
  }

  /** 标准 PLY 点云：借助 three.js PLYLoader 解析几何与顶点色。 */
  private decodeStandardPly(buffer: ArrayBuffer): GaussianSplatData {
    const geometry = new PLYLoader().parse(buffer);
    const position = geometry.getAttribute("position");
    const count = position ? position.count : 0;
    const positions = new Float32Array(count * 3);
    if (position) {
      for (let i = 0; i < count; i += 1) {
        positions[i * 3] = position.getX(i);
        positions[i * 3 + 1] = position.getY(i);
        positions[i * 3 + 2] = position.getZ(i);
      }
    }

    const colorAttr = geometry.getAttribute("color");
    const colors = new Uint8Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      if (colorAttr) {
        colors[i * 4] = Math.round(colorAttr.getX(i) * 255);
        colors[i * 4 + 1] = Math.round(colorAttr.getY(i) * 255);
        colors[i * 4 + 2] = Math.round(colorAttr.getZ(i) * 255);
      } else {
        colors[i * 4] = colors[i * 4 + 1] = colors[i * 4 + 2] = 255;
      }
      colors[i * 4 + 3] = 255;
    }

    geometry.dispose();
    return { count, positions, colors };
  }
}

/** PLY 属性的数值类型。 */
type PlyType =
  | "char"
  | "uchar"
  | "short"
  | "ushort"
  | "int"
  | "uint"
  | "float"
  | "double";

interface PlyProperty {
  type: PlyType;
  offset: number;
}

interface PlyHeader {
  format: "ascii" | "binary_little_endian" | "binary_big_endian";
  count: number;
  stride: number;
  properties: Map<string, PlyProperty>;
  dataOffset: number;
}

const PLY_TYPE_SIZE: Record<PlyType, number> = {
  char: 1,
  uchar: 1,
  short: 2,
  ushort: 2,
  int: 4,
  uint: 4,
  float: 4,
  double: 8,
};

const PLY_TYPE_ALIASES: Record<string, PlyType> = {
  int8: "char",
  uint8: "uchar",
  int16: "short",
  uint16: "ushort",
  int32: "int",
  uint32: "uint",
  float32: "float",
  float64: "double",
  char: "char",
  uchar: "uchar",
  short: "short",
  ushort: "ushort",
  int: "int",
  uint: "uint",
  float: "float",
  double: "double",
};

/** 解析 PLY 头部（仅取首个 vertex 元素的属性表）。 */
function readPlyHeader(buffer: ArrayBuffer): PlyHeader | null {
  const headerBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1 << 16));
  const text = new TextDecoder("ascii").decode(headerBytes);
  if (!text.startsWith("ply")) return null;

  const endToken = "end_header\n";
  const endIndex = text.indexOf(endToken);
  if (endIndex < 0) return null;
  const dataOffset = endIndex + endToken.length;

  const lines = text.substring(0, endIndex).split(/\r?\n/);
  let format: PlyHeader["format"] | null = null;
  let count = 0;
  let inVertex = false;
  let stride = 0;
  const properties = new Map<string, PlyProperty>();

  for (const line of lines) {
    const tokens = line.trim().split(/\s+/);
    const [keyword] = tokens;
    if (keyword === "format") {
      format = tokens[1] as PlyHeader["format"];
    } else if (keyword === "element") {
      inVertex = tokens[1] === "vertex";
      if (inVertex) count = Number(tokens[2]);
    } else if (keyword === "property" && inVertex) {
      // 仅支持标量属性（高斯 PLY 均为标量）。
      if (tokens[1] === "list") continue;
      const type = PLY_TYPE_ALIASES[tokens[1]!];
      const propName = tokens[2];
      if (!type || !propName) continue;
      properties.set(propName, { type, offset: stride });
      stride += PLY_TYPE_SIZE[type];
    }
  }

  if (!format || count <= 0 || properties.size === 0) return null;
  return { format, count, stride, properties, dataOffset };
}

/** 按类型从 DataView 读取单个数值（小端）。 */
function readPlyValue(view: DataView, offset: number, type: PlyType): number {
  switch (type) {
    case "char":
      return view.getInt8(offset);
    case "uchar":
      return view.getUint8(offset);
    case "short":
      return view.getInt16(offset, true);
    case "ushort":
      return view.getUint16(offset, true);
    case "int":
      return view.getInt32(offset, true);
    case "uint":
      return view.getUint32(offset, true);
    case "float":
      return view.getFloat32(offset, true);
    case "double":
      return view.getFloat64(offset, true);
    default:
      return 0;
  }
}
