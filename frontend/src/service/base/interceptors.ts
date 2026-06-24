import type {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

import { toApiError } from "./errors";
import { getAccessToken, clearAccessToken } from "./token";
import type { ServiceRequestConfig } from "./types";

function createRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function attachAuthHeader(config: InternalAxiosRequestConfig) {
  const serviceConfig = config as ServiceRequestConfig;

  if (serviceConfig.skipAuth) {
    return config;
  }

  const token = getAccessToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }

  return config;
}

function attachTraceHeaders(config: InternalAxiosRequestConfig) {
  config.headers.set("X-Request-Id", createRequestId());
  return config;
}

function onRequest(config: InternalAxiosRequestConfig) {
  attachTraceHeaders(config);
  return attachAuthHeader(config);
}

function onResponseFulfilled(response: AxiosResponse) {
  return response;
}

function onResponseRejected(error: AxiosError) {
  const apiError = toApiError(error);
  const serviceConfig = error.config as ServiceRequestConfig | undefined;

  if (apiError.isUnauthorized) {
    clearAccessToken();
  }

  const isExpectedClientError =
    apiError.status >= 400 && apiError.status < 500;
  const shouldLog =
    !serviceConfig?.skipErrorLog &&
    !isExpectedClientError &&
    (apiError.isNetworkError || apiError.isTimeout || apiError.status >= 500);

  if (shouldLog) {
    console.error("[service] request failed:", {
      url: error.config?.url,
      method: error.config?.method,
      status: apiError.status,
      message: apiError.message,
    });
  }

  return Promise.reject(apiError);
}

export function setupInterceptors(client: AxiosInstance) {
  client.interceptors.request.use(onRequest);
  client.interceptors.response.use(onResponseFulfilled, onResponseRejected);
}
