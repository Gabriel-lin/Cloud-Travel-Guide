export type ExplorePlace = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  category?: string;
  thumbnailUrl?: string;
};

export type ExploreSearchQuery = {
  q?: string;
  lat?: number;
  lon?: number;
  radiusKm?: number;
  page?: number;
  pageSize?: number;
};
