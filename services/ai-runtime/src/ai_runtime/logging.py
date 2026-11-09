"""Structured JSON logging with correlation IDs bound per request."""

import logging
import sys

import structlog

_REDACTED_KEYS = frozenset({"authorization", "api_key", "apikey", "password", "secret", "token", "cookie"})


def _redact(_: object, __: str, event: structlog.typing.EventDict) -> structlog.typing.EventDict:
    for key in list(event):
        if key.lower() in _REDACTED_KEYS:
            event[key] = "[REDACTED]"
    return event


def configure_logging(level: str, service: str) -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            _redact,
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelNamesMapping()[level]),
        cache_logger_on_first_use=True,
    )
    structlog.contextvars.bind_contextvars(service=service)
