# pyright: reportAny=false, reportExplicitAny=false, reportUnreachable=false
"""Correlation-id middleware (RECIPE-STRUCTLOG).

Reads ``x-request-id`` from the inbound request, generates a fresh
:func:`uuid.uuid7` when absent, binds it onto the structlog contextvars as
``request_id`` (so every log line carries the id without callers having to
pass it through), and propagates the same id back via the response
``x-request-id`` header. The contextvars are cleared in ``finally`` so a
worker that is reused for the next request does not leak the prior id —
the structlog contextvars store is process-global, so a missing teardown is
a cross-request data leak.

The ``reportUnreachable`` suppression is interop with
:mod:`litestar.types`: ``Scope`` is a discriminated union and basedpyright
narrows ``scope["type"] != "http"`` aggressively, marking the post-narrow
HTTP path as unreachable. The narrow is correct at runtime (lifespan +
websocket scopes never enter the HTTP path).
"""

from typing import TYPE_CHECKING
from uuid import uuid7

import structlog

if TYPE_CHECKING:
    from litestar.types import ASGIApp, Message, Receive, Scope, Send

_REQUEST_ID_HEADER = b"x-request-id"


def correlation_id_middleware(app: ASGIApp) -> ASGIApp:
    """Wrap an ASGI app so every request has a stable ``request_id``."""

    async def middleware(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await app(scope, receive, send)
            return

        rid: str | None = None
        headers: list[tuple[bytes, bytes]] = list(scope.get("headers", []))
        for name, value in headers:
            if name.lower() == _REQUEST_ID_HEADER:
                try:
                    rid = value.decode("ascii")
                except UnicodeDecodeError:
                    rid = None
                break
        if rid is None:
            rid = str(uuid7())

        rid_bytes = rid.encode("ascii")

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers: list[tuple[bytes, bytes]] = list(message.get("headers", []))
                response_headers.append((_REQUEST_ID_HEADER, rid_bytes))
                message = {**message, "headers": response_headers}
            await send(message)

        structlog.contextvars.bind_contextvars(request_id=rid)
        try:
            await app(scope, receive, send_with_header)
        finally:
            structlog.contextvars.unbind_contextvars("request_id")

    return middleware
