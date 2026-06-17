export type SavedItemType = "place" | "route" | "plan";

export type SavedItem = {
  id: string;
  type: SavedItemType;
  refId: string;
  title: string;
  summary?: string;
  savedAt: string;
};

export type CreateSavedPayload = {
  type: SavedItemType;
  refId: string;
};
