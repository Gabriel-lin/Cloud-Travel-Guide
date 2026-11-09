import type { Vector3 } from "three";

/** S 沿河/谷开放曲线;O 绕峰/绕湖闭合环 */
export type PathKind = "s" | "o";

export type PathFeature = "river" | "valley" | "peak" | "lake";

export type TourClassification = {
  kind: PathKind;
  feature: PathFeature;
  anchor: { x: number; z: number };
  /** S:河心线或谷地走廊(XZ);O:空 */
  spine: { x: number; z: number }[];
  /** 河岸半宽提示(米),无河为 0 */
  bank: number;
  radiusX: number;
  radiusZ: number;
  /** 椭圆朝向(弧度) */
  yaw: number;
};

export type RegionTour = {
  kind: PathKind;
  feature: PathFeature;
  walk: Vector3[];
  fly: Vector3[];
  /** 含闭合段的 XZ 弧长(米) */
  length: number;
  /** 到 walk[i] 的累计弧长,与 walk 等长 */
  cumul: number[];
};
