/** 与拾取目录、FishSchools SPECIES.id 对齐的稳定鱼种 id。 */
export const FISH_SPECIES_IDS = [
  "grass-carp",
  "black-carp",
  "silver-carp",
  "bighead-carp",
  "common-carp",
  "crucian",
  "bass",
  "koi",
  "bream",
  "skygazer",
  "mandarin",
  "yellow-catfish",
] as const;

export type FishSpeciesId = (typeof FISH_SPECIES_IDS)[number];
