import { API_V1_PREFIX, del, get, post } from "@/service/base";
import type { PageQuery, PageResult } from "@/service/base";
import type { CreateSavedPayload, SavedItem } from "./types";

const RESOURCE = `${API_V1_PREFIX}/saved`;

/** 收藏夹模块接口 */
export const savedService = {
  /** GET /api/v1/saved — 收藏列表 */
  listSaved(query?: PageQuery & { type?: SavedItem["type"] }) {
    return get<PageResult<SavedItem>>(RESOURCE, { params: query });
  },

  /** POST /api/v1/saved — 添加收藏 */
  addSaved(payload: CreateSavedPayload) {
    return post<SavedItem>(RESOURCE, payload);
  },

  /** DELETE /api/v1/saved/:id — 取消收藏 */
  removeSaved(id: string) {
    return del<void>(`${RESOURCE}/${id}`);
  },
};
