import type { PerspectiveCamera } from "three";

import type { AudioRuntime } from "./AudioRuntime";
import type { SoundSystem } from "./SoundSystem";

export type AudioBusId = "master" | "birds" | "ambience" | "ui";

/** 鸣声功能型:对应不同行为/环境,不是单纯的随机换轨。 */
export type VocalKind = "song" | "call" | "flight" | "alarm" | "nocturnal";

export type SoundFrameContext = {
  camera: PerspectiveCamera;
  dt: number;
  /** 与 EnvState.time 对齐的世界秒 */
  time: number;
  nightK: number;
  wind: number;
  underwater: boolean;
  waterDepth: number;
};

export type SpatialPlayRequest = {
  buffer: AudioBuffer;
  x: number;
  y: number;
  z: number;
  gain: number;
  refDistance: number;
  maxDistance: number;
  rolloff: number;
  bus: AudioBusId;
  /** 从 buffer 起点的偏移(秒) */
  offset?: number;
  duration?: number;
  /** 越大越不易被抢占 */
  priority?: number;
};

export interface SoundHost {
  readonly runtime: AudioRuntime;
  attach(system: SoundSystem): void;
  detach(system: SoundSystem): void;
}
