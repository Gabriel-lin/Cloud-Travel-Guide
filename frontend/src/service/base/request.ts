import type { AxiosResponse } from "axios";

import { httpClient } from "./client";
import { setupInterceptors } from "./interceptors";
import type { ServiceRequestConfig } from "./types";

setupInterceptors(httpClient);

async function unwrap<T>(promise: Promise<AxiosResponse<T>>): Promise<T> {
  const response = await promise;
  return response.data;
}

export function get<T = unknown>(
  url: string,
  config?: ServiceRequestConfig,
): Promise<T> {
  return unwrap(httpClient.get<T>(url, config));
}

export function post<T = unknown, D = unknown>(
  url: string,
  data?: D,
  config?: ServiceRequestConfig,
): Promise<T> {
  return unwrap(httpClient.post<T>(url, data, config));
}

export function put<T = unknown, D = unknown>(
  url: string,
  data?: D,
  config?: ServiceRequestConfig,
): Promise<T> {
  return unwrap(httpClient.put<T>(url, data, config));
}

export function patch<T = unknown, D = unknown>(
  url: string,
  data?: D,
  config?: ServiceRequestConfig,
): Promise<T> {
  return unwrap(httpClient.patch<T>(url, data, config));
}

export function del<T = unknown>(
  url: string,
  config?: ServiceRequestConfig,
): Promise<T> {
  return unwrap(httpClient.delete<T>(url, config));
}

export { httpClient };
