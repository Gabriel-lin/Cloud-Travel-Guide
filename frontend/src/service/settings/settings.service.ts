import { API_V1_PREFIX, get, put } from "@/service/base";
import type { RemoteSettings, UpdateRemoteSettingsPayload } from "./types";

const RESOURCE = `${API_V1_PREFIX}/settings`;

/** 应用设置模块接口（云端同步） */
export const settingsService = {
  /** GET /api/v1/settings — 获取云端设置 */
  getSettings() {
    return get<RemoteSettings>(RESOURCE);
  },

  /** PUT /api/v1/settings — 更新云端设置 */
  updateSettings(payload: UpdateRemoteSettingsPayload) {
    return put<RemoteSettings>(RESOURCE, payload);
  },
};
