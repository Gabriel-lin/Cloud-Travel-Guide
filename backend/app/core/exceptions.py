from typing import Any


class AppError(Exception):
    """应用层可预期业务异常, 由全局 handler 映射为 HTTP 响应。"""

    def __init__(
        self,
        message: str,
        *,
        status_code: int = 400,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details or {}


class UnauthorizedError(AppError):
    def __init__(self, message: str = "Could not validate credentials", **kwargs: Any) -> None:
        super().__init__(message, status_code=401, code="unauthorized", **kwargs)


class ForbiddenError(AppError):
    def __init__(self, message: str = "Forbidden", **kwargs: Any) -> None:
        super().__init__(message, status_code=403, code="forbidden", **kwargs)


class NotFoundError(AppError):
    def __init__(self, message: str = "Resource not found", **kwargs: Any) -> None:
        super().__init__(message, status_code=404, code="not_found", **kwargs)


class ConflictError(AppError):
    def __init__(self, message: str = "Conflict", **kwargs: Any) -> None:
        super().__init__(message, status_code=409, code="conflict", **kwargs)


class BadRequestError(AppError):
    def __init__(self, message: str = "Bad request", **kwargs: Any) -> None:
        super().__init__(message, status_code=400, code="bad_request", **kwargs)


class ServiceUnavailableError(AppError):
    def __init__(self, message: str = "Service unavailable", **kwargs: Any) -> None:
        super().__init__(message, status_code=503, code="service_unavailable", **kwargs)
