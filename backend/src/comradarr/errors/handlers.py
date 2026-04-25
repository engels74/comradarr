# pyright: reportAny=false, reportExplicitAny=false
"""RFC 9457 ``application/problem+json`` translation layer.

Two exception handlers Litestar registers via ``exception_handlers={...}``:

* :func:`comradarr_error_handler` — translates every :class:`ComradarrError`
  subclass into a Problem Details response with the canonical
  ``urn:comradarr:<code>`` ``type`` URI and the per-domain extension members
  (``errors`` for :class:`ValidationError`, ``retryable`` for
  :class:`ConnectorError`, ``context`` for any error carrying domain context).
* :func:`unhandled_exception_handler` — fallback for anything not derived from
  :class:`ComradarrError`. Logs the full traceback via structlog and returns
  the same Problem Details envelope with ``code='internal.unexpected'`` and a
  generic ``detail`` so server internals never leak.

The ``instance`` field carries the correlation id bound by
``correlation_id_middleware`` (RECIPE-STRUCTLOG); when no id is bound (e.g.
test harness without the middleware), the field is omitted.
"""

from typing import TYPE_CHECKING

import structlog
from litestar import Response
from litestar.status_codes import HTTP_500_INTERNAL_SERVER_ERROR

from comradarr.errors.connector import ConnectorError
from comradarr.errors.internal import InternalUnexpected
from comradarr.errors.validation import ValidationError

if TYPE_CHECKING:
    from comradarr.errors.base import ComradarrError

_PROBLEM_JSON = "application/problem+json"
_TYPE_PREFIX = "urn:comradarr:"

_logger = structlog.stdlib.get_logger(__name__)


def _humanize_title(class_name: str) -> str:
    """Insert spaces between CamelCase words so ``ValidationError`` → "Validation Error"."""
    out: list[str] = []
    for i, ch in enumerate(class_name):
        if i > 0 and ch.isupper() and not class_name[i - 1].isupper():
            out.append(" ")
        out.append(ch)
    return "".join(out)


def _current_request_id() -> str | None:
    """Read the correlation id bound by ``correlation_id_middleware``."""
    rid = structlog.contextvars.get_contextvars().get("request_id")
    return rid if isinstance(rid, str) else None


def _build_envelope(exc: ComradarrError) -> dict[str, object]:
    """Construct the RFC 9457 body dict for a :class:`ComradarrError`."""
    envelope: dict[str, object] = {
        "type": _TYPE_PREFIX + exc.code,
        "title": _humanize_title(type(exc).__name__),
        "status": exc.status_code,
        "detail": str(exc),
    }
    rid = _current_request_id()
    if rid is not None:
        envelope["instance"] = rid
    if exc.context:
        envelope["context"] = dict(exc.context)
    if isinstance(exc, ValidationError):
        envelope["errors"] = [dict(e) for e in exc.errors]
    if isinstance(exc, ConnectorError):
        envelope["retryable"] = exc.retryable
    return envelope


def comradarr_error_handler(_request: object, exc: ComradarrError) -> Response[dict[str, object]]:
    """Render any :class:`ComradarrError` subclass as ``application/problem+json``."""
    return Response(
        content=_build_envelope(exc),
        status_code=exc.status_code,
        media_type=_PROBLEM_JSON,
    )


def unhandled_exception_handler(_request: object, exc: Exception) -> Response[dict[str, object]]:
    """Fallback handler — logs the exception and returns ``internal.unexpected``."""
    _logger.exception("unhandled_exception", error_type=type(exc).__name__)
    fallback = InternalUnexpected()
    envelope = _build_envelope(fallback)
    return Response(
        content=envelope,
        status_code=HTTP_500_INTERNAL_SERVER_ERROR,
        media_type=_PROBLEM_JSON,
    )
