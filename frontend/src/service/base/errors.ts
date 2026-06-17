import type { AxiosError } from "axios";

export type ApiErrorPayload = {
  detail?: string | { msg: string; type?: string }[];
  message?: string;
  code?: string | number;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string | number;
  readonly payload?: ApiErrorPayload;
  readonly isNetworkError: boolean;
  readonly isTimeout: boolean;
  readonly isUnauthorized: boolean;

  constructor(options: {
    message: string;
    status?: number;
    code?: string | number;
    payload?: ApiErrorPayload;
    isNetworkError?: boolean;
    isTimeout?: boolean;
    isUnauthorized?: boolean;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "ApiError";
    this.status = options.status ?? 0;
    this.code = options.code;
    this.payload = options.payload;
    this.isNetworkError = options.isNetworkError ?? false;
    this.isTimeout = options.isTimeout ?? false;
    this.isUnauthorized = options.isUnauthorized ?? false;
  }
}

function extractMessage(payload: ApiErrorPayload | undefined, fallback: string) {
  if (!payload) return fallback;

  if (typeof payload.message === "string" && payload.message) {
    return payload.message;
  }

  if (typeof payload.detail === "string" && payload.detail) {
    return payload.detail;
  }

  if (Array.isArray(payload.detail) && payload.detail.length > 0) {
    return payload.detail.map((item) => item.msg).join("; ");
  }

  return fallback;
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  const axiosError = error as AxiosError<ApiErrorPayload>;

  if (axiosError?.isAxiosError) {
    const status = axiosError.response?.status ?? 0;
    const payload = axiosError.response?.data;
    const isTimeout = axiosError.code === "ECONNABORTED";
    const isNetworkError = !axiosError.response && !isTimeout;
    const isUnauthorized = status === 401;

    return new ApiError({
      message: extractMessage(payload, axiosError.message || "Request failed"),
      status,
      code: payload?.code,
      payload,
      isNetworkError,
      isTimeout,
      isUnauthorized,
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new ApiError({ message: error.message, cause: error });
  }

  return new ApiError({ message: "Unknown request error", cause: error });
}
