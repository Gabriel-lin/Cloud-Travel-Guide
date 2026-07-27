import logging

_HEALTH_PATH_MARKERS = (
    "/api/v1/health",
    '"GET /health ',
)


class _SkipHealthAccessFilter(logging.Filter):
    """Drop Docker/K8s probe noise from uvicorn access logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return not any(marker in message for marker in _HEALTH_PATH_MARKERS)


def configure_logging(debug: bool = False) -> None:
    level = logging.DEBUG if debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    access = logging.getLogger("uvicorn.access")
    access.setLevel(logging.INFO)
    if not any(isinstance(f, _SkipHealthAccessFilter) for f in access.filters):
        access.addFilter(_SkipHealthAccessFilter())
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.DEBUG if debug else logging.WARNING,
    )
