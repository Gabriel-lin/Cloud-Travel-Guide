import { API_V1_PREFIX, get, put } from "@/service/base";
import type { UpdateProfilePayload, UserProfile } from "./types";

const RESOURCE = `${API_V1_PREFIX}/profile`;

/** 个人资料业务接口 */
export const profileService = {
  /** GET /api/v1/profile — 获取当前用户资料 */
  getProfile() {
    return get<UserProfile>(RESOURCE);
  },

  /** PUT /api/v1/profile — 更新用户资料 */
  updateProfile(payload: UpdateProfilePayload) {
    return put<UserProfile>(RESOURCE, payload);
  },
};