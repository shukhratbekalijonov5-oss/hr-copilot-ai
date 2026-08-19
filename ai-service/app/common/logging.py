"""Structured JSON logging.

Resume documents contain personal data, so log records carry *identifiers and
counts*, never document text, candidate emails or phone numbers. The internal
service token and any signed URL are likewise never logged.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from typing import Any

# Set per request by RequestContextMiddleware so every log line inside a request
# can be correlated without threading an argument through every function.
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_RESERVED = {
    "args", "asctime", "created", "exc_info", "exc_text", "filename",
    "funcName", "levelname", "levelno", "lineno", "module", "msecs",
    "message", "msg", "name", "pathname", "process", "processName",
    "relativeCreated", "stack_info", "thread", "threadName", "taskName",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        request_id = request_id_var.get()
        if request_id:
            payload["requestId"] = request_id

        # Structured fields passed via logger.info(..., extra={...}).
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value

        if record.exc_info:
            # Type and message only — a full traceback can quote document text.
            exc_type, exc_value, _ = record.exc_info
            payload["errorType"] = exc_type.__name__ if exc_type else "Unknown"
            payload["errorMessage"] = str(exc_value)[:300] if exc_value else ""

        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())

    # The Google SDK warns about automatic function calling on every
    # generate_content call. This service passes no tools, so the warning can
    # never apply; silence it rather than let it bury real log lines.
    logging.getLogger("google_genai.models").setLevel(logging.ERROR)

    # uvicorn duplicates access logs in its own format; route them through ours.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = [handler]
        logger.propagate = False


def get_logger(name: str) -> logging.LoggerAdapter | logging.Logger:
    return logging.getLogger(name)
