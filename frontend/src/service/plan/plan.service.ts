import { API_V1_PREFIX, del, get, post, put } from "@/service/base";
import type { PageQuery, PageResult } from "@/service/base";
import type {
  CreatePlanPayload,
  PlanDetail,
  PlanItem,
  UpdatePlanPayload,
} from "./types";

const RESOURCE = `${API_V1_PREFIX}/plans`;

/** 行程规划模块接口 */
export const planService = {
  /** GET /api/v1/plans — 行程列表 */
  listPlans(query?: PageQuery) {
    return get<PageResult<PlanItem>>(RESOURCE, { params: query });
  },

  /** GET /api/v1/plans/:id — 行程详情 */
  getPlan(id: string) {
    return get<PlanDetail>(`${RESOURCE}/${id}`);
  },

  /** POST /api/v1/plans — 创建行程 */
  createPlan(payload: CreatePlanPayload) {
    return post<PlanDetail>(RESOURCE, payload);
  },

  /** PUT /api/v1/plans/:id — 更新行程 */
  updatePlan(id: string, payload: UpdatePlanPayload) {
    return put<PlanDetail>(`${RESOURCE}/${id}`, payload);
  },

  /** DELETE /api/v1/plans/:id — 删除行程 */
  deletePlan(id: string) {
    return del<void>(`${RESOURCE}/${id}`);
  },
};
