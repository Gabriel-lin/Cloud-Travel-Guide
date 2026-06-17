import { API_V1_PREFIX, get } from "@/service/base";
import type { PageResult } from "@/service/base";
import type { ExplorePlace, ExploreSearchQuery } from "./types";

const RESOURCE = `${API_V1_PREFIX}/explore`;

/** 探索（地球浏览）模块接口 */
export const exploreService = {
  /** GET /api/v1/explore/places — 地点搜索 */
  searchPlaces(query?: ExploreSearchQuery) {
    return get<PageResult<ExplorePlace>>(`${RESOURCE}/places`, { params: query });
  },

  /** GET /api/v1/explore/places/:id — 地点详情 */
  getPlace(id: string) {
    return get<ExplorePlace>(`${RESOURCE}/places/${id}`);
  },
};
