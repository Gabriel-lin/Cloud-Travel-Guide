import type { TreeSpeciesId } from "../veg/species";
import type { BirdSpeciesId } from "../world/birdSpecies";
import type { FishSpeciesId } from "../world/fishSpecies";

/** 可拾取实体大类。 */
export type PickableKind =
  | "forest"
  | "bamboo"
  | "shrub"
  | "firefly"
  | "bird"
  | "fish"
  | "landmark";

/** 卡片内 glTF 预览配置(路径可空,后续接入查看器)。 */
export type PickableModel = {
  src?: string;
  clip?: string;
  camera?: "front" | "orbit";
};

export type PickableMatch = {
  treeSpecies?: TreeSpeciesId[];
  birdSpeciesId?: BirdSpeciesId;
  fishSpeciesId?: FishSpeciesId;
};

/** 全局可拾取目录条目;关掉 enabled 即不参与命中。 */
export type PickableCatalogEntry = {
  id: string;
  kind: PickableKind;
  enabled: boolean;
  titleKey: string;
  match?: PickableMatch;
  model?: PickableModel;
};

/** 当前选中的场景实体(驱动右侧检查卡片)。 */
export type PickedEntity = {
  catalogId: string;
  kind: PickableKind;
  titleKey: string;
  model?: PickableModel;
  instanceKey: string;
};

/** 挂在拾取代理 mesh.userData 上。 */
export type PickProxyData = {
  pick: true;
  catalogId: string;
  kind: PickableKind;
  titleKey: string;
  model?: PickableModel;
  instanceKey: string;
};

export function isPickProxyData(v: unknown): v is PickProxyData {
  return Boolean(v && typeof v === "object" && (v as PickProxyData).pick === true);
}
