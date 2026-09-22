import type { TreeSpeciesId } from "../veg/species";
import { BIRD_SPECIES_IDS, type BirdSpeciesId } from "../world/birdSpecies";
import { FISH_SPECIES_IDS, type FishSpeciesId } from "../world/fishSpecies";

import type { PickableCatalogEntry } from "./types";

const FOREST_SPECIES: TreeSpeciesId[] = [
  "broadleaf",
  "willow",
  "conifer",
  "alpineFir",
  "saxaul",
];

const FISH_TITLE: Record<FishSpeciesId, string> = {
  "grass-carp": "routes.pickables.fish.grassCarp",
  "black-carp": "routes.pickables.fish.blackCarp",
  "silver-carp": "routes.pickables.fish.silverCarp",
  "bighead-carp": "routes.pickables.fish.bigheadCarp",
  "common-carp": "routes.pickables.fish.commonCarp",
  crucian: "routes.pickables.fish.crucian",
  bass: "routes.pickables.fish.bass",
  koi: "routes.pickables.fish.koi",
  bream: "routes.pickables.fish.bream",
  skygazer: "routes.pickables.fish.skygazer",
  mandarin: "routes.pickables.fish.mandarin",
  "yellow-catfish": "routes.pickables.fish.yellowCatfish",
};

function birdTitleKey(id: BirdSpeciesId): string {
  const camel = id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  return `routes.pickables.birds.${camel}`;
}

function birdEntry(id: BirdSpeciesId): PickableCatalogEntry {
  return {
    id: `bird:${id}`,
    kind: "bird",
    enabled: true,
    titleKey: birdTitleKey(id),
    match: { birdSpeciesId: id },
  };
}

function fishEntry(id: FishSpeciesId): PickableCatalogEntry {
  return {
    id: `fish:${id}`,
    kind: "fish",
    enabled: true,
    titleKey: FISH_TITLE[id],
    match: { fishSpeciesId: id },
  };
}

/**
 * 默认可拾取目录。
 *
 * 后续扩展:改 enabled、补 model.src,或往数组追加条目即可;
 * 地标建筑按站点配置,不放在此表。
 */
export const PICKABLE_CATALOG: readonly PickableCatalogEntry[] = [
  {
    id: "forest",
    kind: "forest",
    enabled: true,
    titleKey: "routes.pickables.forest",
    match: { treeSpecies: FOREST_SPECIES },
  },
  {
    id: "bamboo",
    kind: "bamboo",
    enabled: true,
    titleKey: "routes.pickables.bamboo",
    match: { treeSpecies: ["bamboo"] },
  },
  {
    id: "shrub",
    kind: "shrub",
    enabled: true,
    titleKey: "routes.pickables.shrub",
  },
  {
    id: "firefly",
    kind: "firefly",
    enabled: true,
    titleKey: "routes.pickables.firefly",
  },
  ...BIRD_SPECIES_IDS.map(birdEntry),
  ...FISH_SPECIES_IDS.map(fishEntry),
];

const BY_ID = new Map(PICKABLE_CATALOG.map((e) => [e.id, e]));

export function getCatalogEntry(id: string): PickableCatalogEntry | undefined {
  return BY_ID.get(id);
}

export function catalogForTreeSpecies(
  species: TreeSpeciesId,
): PickableCatalogEntry | undefined {
  for (const entry of PICKABLE_CATALOG) {
    if (!entry.enabled) continue;
    if (entry.match?.treeSpecies?.includes(species)) return entry;
  }
  return undefined;
}

export function catalogForBird(
  speciesId: BirdSpeciesId,
): PickableCatalogEntry | undefined {
  const entry = BY_ID.get(`bird:${speciesId}`);
  return entry?.enabled ? entry : undefined;
}

export function catalogForFish(
  speciesId: FishSpeciesId,
): PickableCatalogEntry | undefined {
  const entry = BY_ID.get(`fish:${speciesId}`);
  return entry?.enabled ? entry : undefined;
}

export function catalogFirefly(): PickableCatalogEntry | undefined {
  const entry = BY_ID.get("firefly");
  return entry?.enabled ? entry : undefined;
}

export function catalogShrub(): PickableCatalogEntry | undefined {
  const entry = BY_ID.get("shrub");
  return entry?.enabled ? entry : undefined;
}
