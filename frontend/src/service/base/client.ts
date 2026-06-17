import axios, { type AxiosInstance } from "axios";

import {
  API_BASE_URL,
  DEFAULT_TIMEOUT_MS,
} from "./constants";

export function createHttpClient(): AxiosInstance {
  return axios.create({
    baseURL: API_BASE_URL,
    timeout: DEFAULT_TIMEOUT_MS,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    // 仅将 2xx 视为成功
    validateStatus: (status) => status >= 200 && status < 300,
    // 跨域场景携带 cookie（若后端启用 session）
    withCredentials: false,
  });
}

export const httpClient = createHttpClient();
