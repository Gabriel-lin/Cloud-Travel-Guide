import { API_V1_PREFIX, del, get, post, put } from "@/service/base";
import type { PageQuery, PageResult } from "@/service/base";
import type {
  CreateRoutePayload,
  RouteDetail,
  RouteItem,
  UpdateRoutePayload,
} from "./types";

const RESOURCE = `${API_V1_PREFIX}/routes`;

/** 推荐路线模块接口 */
export const routesService = {
  /** GET /api/v1/routes — 路线列表 */
  listRoutes(query?: PageQuery) {
    return get<PageResult<RouteItem>>(RESOURCE, { params: query });
  },

  /** GET /api/v1/routes/:id — 路线详情 */
  getRoute(id: string) {
    return get<RouteDetail>(`${RESOURCE}/${id}`);
  },

  /** POST /api/v1/routes — 创建路线 */
  createRoute(payload: CreateRoutePayload) {
    return post<RouteDetail>(RESOURCE, payload);
  },

  /** PUT /api/v1/routes/:id — 全量更新路线 */
  updateRoute(id: string, payload: UpdateRoutePayload) {
    return put<RouteDetail>(`${RESOURCE}/${id}`, payload);
  },

  /** DELETE /api/v1/routes/:id — 删除路线 */
  deleteRoute(id: string) {
    return del<void>(`${RESOURCE}/${id}`);
  },
};
