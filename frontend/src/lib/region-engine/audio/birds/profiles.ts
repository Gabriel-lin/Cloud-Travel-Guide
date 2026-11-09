import type { BirdSpeciesId } from "../../world/birdSpecies";
import type { VocalKind } from "../types";

export type BirdAcousticProfile = {
  id: BirdSpeciesId;
  scientific: string;
  english: string;
  /** 反比距离模型参考距离(米) */
  refDistance: number;
  maxDistance: number;
  rolloff: number;
  /** 线性增益 0..1.4 */
  gain: number;
  /** 近距事件间隔(秒) */
  cadence: [number, number];
  /** 单群同时发声上限 */
  polyphony: number;
  nocturnal: boolean;
  /** 各鸣声型基础权重;0 表示该种几乎不使用 */
  vocals: Record<VocalKind, number>;
};

export const BIRD_PROFILES: Record<BirdSpeciesId, BirdAcousticProfile> = {
  sparrow: {
    id: "sparrow",
    scientific: "Passer domesticus",
    english: "House Sparrow",
    refDistance: 10,
    maxDistance: 90,
    rolloff: 1.15,
    gain: 0.42,
    cadence: [1.6, 4.2],
    polyphony: 3,
    nocturnal: false,
    vocals: { song: 0.55, call: 1, flight: 0.22, alarm: 0.28, nocturnal: 0 },
  },
  swallow: {
    id: "swallow",
    scientific: "Hirundo rustica",
    english: "Barn Swallow",
    refDistance: 14,
    maxDistance: 120,
    rolloff: 1.05,
    gain: 0.38,
    cadence: [1.2, 3.4],
    polyphony: 3,
    nocturnal: false,
    vocals: { song: 0.45, call: 0.7, flight: 1, alarm: 0.18, nocturnal: 0 },
  },
  pigeon: {
    id: "pigeon",
    scientific: "Columba livia",
    english: "Rock Dove",
    refDistance: 12,
    maxDistance: 110,
    rolloff: 1.1,
    gain: 0.5,
    cadence: [3.5, 8.5],
    polyphony: 2,
    nocturnal: false,
    vocals: { song: 1, call: 0.55, flight: 0.35, alarm: 0.15, nocturnal: 0 },
  },
  magpie: {
    id: "magpie",
    scientific: "Pica pica",
    english: "Eurasian Magpie",
    refDistance: 16,
    maxDistance: 140,
    rolloff: 1.0,
    gain: 0.52,
    cadence: [2.4, 6.5],
    polyphony: 2,
    nocturnal: false,
    vocals: { song: 0.35, call: 1, flight: 0.15, alarm: 0.55, nocturnal: 0 },
  },
  crow: {
    id: "crow",
    scientific: "Corvus corone",
    english: "Carrion Crow",
    refDistance: 22,
    maxDistance: 220,
    rolloff: 0.9,
    gain: 0.62,
    cadence: [3.0, 8.0],
    polyphony: 2,
    nocturnal: false,
    vocals: { song: 0.12, call: 1, flight: 0.28, alarm: 0.4, nocturnal: 0 },
  },
  mallard: {
    id: "mallard",
    scientific: "Anas platyrhynchos",
    english: "Mallard",
    refDistance: 18,
    maxDistance: 160,
    rolloff: 1.0,
    gain: 0.58,
    cadence: [2.2, 6.0],
    polyphony: 2,
    nocturnal: false,
    vocals: { song: 0.08, call: 1, flight: 0.55, alarm: 0.22, nocturnal: 0 },
  },
  egret: {
    id: "egret",
    scientific: "Egretta garzetta",
    english: "Little Egret",
    refDistance: 16,
    maxDistance: 140,
    rolloff: 1.05,
    gain: 0.4,
    cadence: [6.0, 16],
    polyphony: 1,
    nocturnal: false,
    vocals: { song: 0.05, call: 1, flight: 0.35, alarm: 0.3, nocturnal: 0 },
  },
  gull: {
    id: "gull",
    scientific: "Larus argentatus",
    english: "European Herring Gull",
    refDistance: 24,
    maxDistance: 260,
    rolloff: 0.85,
    gain: 0.7,
    cadence: [1.8, 5.0],
    polyphony: 3,
    nocturnal: false,
    vocals: { song: 0.1, call: 1, flight: 0.85, alarm: 0.35, nocturnal: 0 },
  },
  goose: {
    id: "goose",
    scientific: "Anser cygnoides",
    english: "Swan Goose",
    refDistance: 28,
    maxDistance: 320,
    rolloff: 0.8,
    gain: 0.78,
    cadence: [1.4, 4.0],
    polyphony: 3,
    nocturnal: false,
    vocals: { song: 0.05, call: 0.7, flight: 1, alarm: 0.2, nocturnal: 0 },
  },
  kestrel: {
    id: "kestrel",
    scientific: "Falco tinnunculus",
    english: "Common Kestrel",
    refDistance: 18,
    maxDistance: 180,
    rolloff: 1.0,
    gain: 0.44,
    cadence: [8.0, 22],
    polyphony: 1,
    nocturnal: false,
    vocals: { song: 0.08, call: 1, flight: 0.4, alarm: 0.35, nocturnal: 0 },
  },
  "eagle-owl": {
    id: "eagle-owl",
    scientific: "Bubo bubo",
    english: "Eurasian Eagle-Owl",
    refDistance: 36,
    maxDistance: 420,
    rolloff: 0.75,
    gain: 0.72,
    cadence: [12, 32],
    polyphony: 1,
    nocturnal: true,
    vocals: { song: 0.25, call: 0.35, flight: 0.05, alarm: 0.12, nocturnal: 1 },
  },
  "snowy-owl": {
    id: "snowy-owl",
    scientific: "Bubo scandiacus",
    english: "Snowy Owl",
    refDistance: 32,
    maxDistance: 380,
    rolloff: 0.78,
    gain: 0.6,
    cadence: [14, 36],
    polyphony: 1,
    nocturnal: true,
    vocals: { song: 0.2, call: 0.4, flight: 0.08, alarm: 0.1, nocturnal: 1 },
  },
};
