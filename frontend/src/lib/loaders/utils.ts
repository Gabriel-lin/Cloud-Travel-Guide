import * as THREE from "three";

import type {
  LoadProgress,
  ModelCategory,
  ModelFormat,
  ModelMetadata,
} from "./types";

/** 从 URL 或文件名中提取小写、不含点号的扩展名。 */
export function extractExtension(input: string | undefined | null): string | null {
  if (!input) return null;
  // 去掉查询串与哈希，再取最后一个路径片段。
  const clean = input.split(/[?#]/, 1)[0]!;
  const file = clean.substring(clean.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  if (dot < 0 || dot === file.length - 1) return null;
  return file.substring(dot + 1).toLowerCase();
}

/** 将各类二进制视图统一转换为 ArrayBuffer。 */
export function toArrayBuffer(data: ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}

/**
 * 通过魔数（magic number）嗅探二进制数据的格式。
 *
 * 仅覆盖能可靠识别的格式：glb（"glTF"）与 ply（"ply"）。
 * 其余格式（如 .splat 无文件头）需依赖扩展名或显式声明。
 */
export function sniffFormat(buffer: ArrayBuffer): ModelFormat | null {
  if (buffer.byteLength < 4) return null;
  const head = new Uint8Array(buffer, 0, Math.min(20, buffer.byteLength));
  const ascii = (start: number, len: number): string =>
    String.fromCharCode(...head.subarray(start, start + len));

  // glTF 二进制：magic == 0x46546C67 ("glTF")
  if (ascii(0, 4) === "glTF") return "glb";
  // PLY：以 "ply" 起始
  if (ascii(0, 3) === "ply") return "ply";
  // glTF JSON：以 '{' 起始且包含 "asset"
  const first = head[0];
  if (first === 0x7b /* { */) {
    const text = ascii(0, Math.min(20, head.length));
    if (text.includes("asset") || text.includes("\"scene")) return "gltf";
  }
  return null;
}

/** 由 ProgressEvent 构造统一的进度对象。 */
export function toLoadProgress(event: ProgressEvent): LoadProgress {
  const { loaded, total, lengthComputable } = event;
  return {
    loaded,
    total,
    lengthComputable,
    ratio: lengthComputable && total > 0 ? loaded / total : undefined,
  };
}

/** 若取消信号已触发则抛出 DOMException("AbortError")。 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Model loading aborted", "AbortError");
  }
}

/**
 * 将一个会自然完成的 Promise 与取消信号竞速。
 * 信号触发时立即以 AbortError 拒绝（底层请求可能仍在后台结束，但结果被丢弃）。
 */
export function withAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(new DOMException("Model loading aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(new DOMException("Model loading aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** 释放材质上引用的全部贴图，并释放材质本身。 */
function disposeMaterial(material: THREE.Material): void {
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value && (value as THREE.Texture).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}

/** 深度遍历对象树，释放几何体、材质与贴图占用的 GPU 资源。 */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    const withGeometry = node as Partial<THREE.Mesh>;
    withGeometry.geometry?.dispose?.();

    const material = (node as Partial<THREE.Mesh>).material;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

/** 遍历对象树，计算网格 / 顶点 / 材质等统计信息。 */
export function computeMetadata(
  root: THREE.Object3D,
  format: ModelFormat,
  category: ModelCategory,
  extra?: Record<string, unknown>,
): ModelMetadata {
  let objectCount = 0;
  let meshCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  root.traverse((node) => {
    objectCount += 1;

    const geometry = (node as Partial<THREE.Mesh>).geometry;
    const position = geometry?.getAttribute?.("position");
    if (position) {
      vertexCount += position.count;
      const isMesh = (node as THREE.Mesh).isMesh === true;
      if (isMesh) {
        meshCount += 1;
        const index = geometry?.getIndex?.();
        triangleCount += index ? index.count / 3 : position.count / 3;
      }
    }

    const material = (node as Partial<THREE.Mesh>).material;
    const collect = (mat: THREE.Material) => {
      materials.add(mat);
      for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
        if (value && (value as THREE.Texture).isTexture) {
          textures.add(value as THREE.Texture);
        }
      }
    };
    if (Array.isArray(material)) material.forEach(collect);
    else if (material) collect(material);
  });

  const boundingBox = new THREE.Box3();
  boundingBox.setFromObject(root);
  const hasBox = Number.isFinite(boundingBox.min.x) && !boundingBox.isEmpty();
  const boundingSphere = hasBox
    ? boundingBox.getBoundingSphere(new THREE.Sphere())
    : null;

  return {
    format,
    category,
    objectCount,
    meshCount,
    vertexCount,
    triangleCount: Math.round(triangleCount),
    materialCount: materials.size,
    textureCount: textures.size,
    animationCount: 0,
    boundingBox: hasBox ? boundingBox : null,
    boundingSphere,
    extra,
  };
}
