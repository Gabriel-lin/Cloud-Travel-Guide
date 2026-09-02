/** 鸟群栖息地(与选点/选种共用)。 */
export type Habitat =
  | "urban"
  | "farmland"
  | "forest"
  | "meadow"
  | "wetland"
  | "water"
  | "coast"
  | "alpine";

/**
 * 稳定种 id:场景选种、叫声目录、资产路径共用。
 * 中文名仍只出现在 BirdFlocks 的展示字段。
 */
export type BirdSpeciesId =
  | "sparrow"
  | "swallow"
  | "pigeon"
  | "magpie"
  | "crow"
  | "mallard"
  | "egret"
  | "gull"
  | "goose"
  | "kestrel"
  | "eagle-owl"
  | "snowy-owl";

export const BIRD_SPECIES_IDS: readonly BirdSpeciesId[] = [
  "sparrow",
  "swallow",
  "pigeon",
  "magpie",
  "crow",
  "mallard",
  "egret",
  "gull",
  "goose",
  "kestrel",
  "eagle-owl",
  "snowy-owl",
] as const;
