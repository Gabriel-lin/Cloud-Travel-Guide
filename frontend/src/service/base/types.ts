import type {
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";

/** 扩展 axios 请求配置 */
export interface ServiceRequestConfig extends AxiosRequestConfig {
  /** 跳过自动附加 Authorization */
  skipAuth?: boolean;
  /** 跳过全局错误日志 */
  skipErrorLog?: boolean;
}

export type ServiceResponse<T = unknown> = AxiosResponse<T>;

export type RequestInterceptor = (
  config: InternalAxiosRequestConfig,
) =>
  | InternalAxiosRequestConfig
  | Promise<InternalAxiosRequestConfig>;

export type ResponseInterceptor = (
  response: AxiosResponse,
) => AxiosResponse | Promise<AxiosResponse>;

export type ErrorInterceptor = (error: unknown) => Promise<never>;

/** 分页查询通用参数 */
export type PageQuery = {
  page?: number;
  pageSize?: number;
};

/** 分页列表通用响应 */
export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
