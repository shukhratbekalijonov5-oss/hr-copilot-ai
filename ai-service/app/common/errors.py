"""Domain errors and their HTTP mapping.

API responses carry a stable ``code`` and a short human message. A Python
traceback is never returned to a caller: it can quote document text and reveals
internal structure.
"""

from __future__ import annotations

from fastapi import status


class AiServiceError(Exception):
    """Base class for errors that map to a defined HTTP response."""

    code = "ai_service_error"
    http_status = status.HTTP_500_INTERNAL_SERVER_ERROR

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class UnsupportedFileTypeError(AiServiceError):
    code = "unsupported_file_type"
    http_status = status.HTTP_400_BAD_REQUEST


class CorruptDocumentError(AiServiceError):
    code = "corrupt_document"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY


class EmptyDocumentError(AiServiceError):
    code = "empty_document"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY


class FileTooLargeError(AiServiceError):
    code = "file_too_large"
    http_status = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE


class VectorStoreUnavailableError(AiServiceError):
    code = "vector_store_unavailable"
    http_status = status.HTTP_503_SERVICE_UNAVAILABLE


class ModelUnavailableError(AiServiceError):
    code = "model_unavailable"
    http_status = status.HTTP_503_SERVICE_UNAVAILABLE


class GenerationUnavailableError(AiServiceError):
    """No LLM provider configured, or the provider failed.

    Deliberately a 503 with a specific code: the caller must be able to tell
    "generation is off" apart from "something broke", so it can keep offering
    retrieval, search and evidence mapping — none of which need an LLM.
    """

    code = "generation_unavailable"
    http_status = status.HTTP_503_SERVICE_UNAVAILABLE


_URL_PATTERN = __import__("re").compile(r"\b[a-zA-Z][a-zA-Z0-9+.-]*://[^\s\"\']+")


def redact(message: str, max_length: int = 300) -> str:
    """Strips URLs out of a message before it leaves the process.

    Driver errors routinely embed the connection URL they failed on, and that
    URL can carry credentials (``http://user:password@host``) or a signed-URL
    signature. Health output and API errors are read by clients, so any URL is
    replaced wholesale rather than trying to parse the credential out of it.
    """
    return _URL_PATTERN.sub("<redacted-url>", message)[:max_length]
