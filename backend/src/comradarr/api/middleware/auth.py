# pyright: reportUnreachable=false, reportUnknownMemberType=false
# backend/src/comradarr/api/middleware/auth.py
"""Authentication middleware (plan §5.4 Slice I).

Resolution order (cookie-first — matches test acceptance criterion):
  1. Allowlist bypass — skip auth entirely for public paths.
  2. Cookie path — ``comradarr_session`` cookie → ``SessionService.validate``.
  3. API-key path — ``X-Api-Key`` or ``Authorization: Bearer cmrr_live_...``.
  4. Anonymous — ``AnonymousPrincipal`` bound; handlers requiring auth will
     raise at the permission-check stage.

Binds ``scope["user"]`` to one of:
  - :class:`~comradarr.core.auth.sessions.SessionPrincipal`
  - :class:`~comradarr.core.auth.api_keys.ApiKeyPrincipal`
  - :class:`~comradarr.core.auth.api_keys.AnonymousPrincipal`

Also binds structlog contextvars ``correlation_id``, ``auth_provider``,
``user_id``, ``session_id`` (RULE-LOG-001).

RULE-PY-002: No ``from __future__ import annotations`` (PEP 649 default).
RULE-PY-003: No ``Any``.
RULE-LOG-001: structlog module-scoped logger + contextvars.
RULE-ASYNC-001: All I/O paths are async.
"""

from typing import TYPE_CHECKING

import structlog

from comradarr.core.auth.api_keys import AnonymousPrincipal, ApiKeyPrincipal, parse

if TYPE_CHECKING:
    from litestar.types import ASGIApp, Receive, Scope, Send
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from comradarr.core.auth.api_keys import ApiKeyService
    from comradarr.core.auth.rate_limit import RateLimiter
    from comradarr.core.auth.sessions import SessionPrincipal, SessionService

_logger = structlog.stdlib.get_logger(__name__)

# Phase 4 temporary allowlist — Phase 5 will override with the setup-gate
# middleware's canonical list. Paths are prefix-matched (startswith).
_ALLOWLIST: tuple[str, ...] = (
    "/api/health",
    "/api/auth/login",
    "/api/auth/oidc/",
    "/api/setup/",
    "/static/",
    "/_app/",
    "/setup",
)

_COOKIE_NAME = b"comradarr_session"
_API_KEY_HEADER = b"x-api-key"
_AUTH_HEADER = b"authorization"


def _path_is_allowlisted(path: str) -> bool:
    return any(path.startswith(prefix) for prefix in _ALLOWLIST)


def _extract_cookie(headers: list[tuple[bytes, bytes]]) -> str | None:
    """Extract ``comradarr_session`` cookie value from raw ASGI headers."""
    for name, value in headers:
        if name.lower() != b"cookie":
            continue
        for part in value.split(b";"):
            part = part.strip()
            if part.startswith(_COOKIE_NAME + b"="):
                token = part[len(_COOKIE_NAME) + 1 :]
                try:
                    return token.decode("ascii")
                except UnicodeDecodeError:
                    return None
    return None


def _extract_api_key_header(headers: list[tuple[bytes, bytes]]) -> str | None:
    """Return the first ``X-Api-Key`` or ``Authorization`` header value, or ``None``."""
    for name, value in headers:
        lower = name.lower()
        if lower == _API_KEY_HEADER:
            try:
                return value.decode("ascii")
            except UnicodeDecodeError:
                return None
        if lower == _AUTH_HEADER:
            try:
                return value.decode("ascii")
            except UnicodeDecodeError:
                return None
    return None


def _source_ip(scope: Scope) -> str | None:
    client = scope.get("client")
    if client is None:
        return None
    host, _port = client
    return host


def auth_middleware(app: ASGIApp) -> ASGIApp:
    """ASGI middleware that resolves the request principal before routing."""

    async def middleware(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        if _path_is_allowlisted(path):
            scope["user"] = AnonymousPrincipal()
            await app(scope, receive, send)
            return

        headers: list[tuple[bytes, bytes]] = list(scope.get("headers", []))

        # Services are mounted at lifespan by Slice K; absent in unit tests
        # that inject stubs directly into scope["app"].state.
        litestar_app = scope.get("app")
        app_state = getattr(litestar_app, "state", None)
        session_service: SessionService | None = getattr(app_state, "session_service", None)
        api_key_service: ApiKeyService | None = getattr(app_state, "api_key_service", None)
        rate_limiter: RateLimiter | None = getattr(app_state, "rate_limiter", None)
        db_sessionmaker: async_sessionmaker[AsyncSession] | None = getattr(
            app_state, "db_sessionmaker", None
        )

        source_ip = _source_ip(scope)
        principal: SessionPrincipal | ApiKeyPrincipal | AnonymousPrincipal

        # --- Cookie path (tried first) ---
        cookie_token = _extract_cookie(headers)
        if cookie_token is not None and session_service is not None:
            session_principal = await session_service.validate(cookie_token)
            if session_principal is not None:
                principal = session_principal
                structlog.contextvars.bind_contextvars(
                    auth_provider=session_principal.auth_provider.value,
                    user_id=str(session_principal.user_id),
                    session_id=str(session_principal.session_id),
                )
                scope["user"] = principal
                await app(scope, receive, send)
                return
            # Cookie present but invalid → remember so permission layer can
            # choose "session_expired" rather than "invalid_credentials".
            scope["_cookie_was_present"] = True

        # --- API-key path ---
        api_key_header = _extract_api_key_header(headers)
        if api_key_header is not None and api_key_service is not None:
            key_hash = parse(api_key_header)
            if key_hash is not None:
                if rate_limiter is not None:
                    api_key = await api_key_service.validate(key_hash, source_ip, rate_limiter)
                else:
                    api_key = await api_key_service.validate(
                        key_hash,
                        source_ip,
                        rate_limiter,  # type: ignore[arg-type]
                    )
                if api_key is not None:
                    owner_role = "viewer"
                    if db_sessionmaker is not None:
                        from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

                        async with db_sessionmaker() as db_session:
                            user_row = await UserRepository(db_session).get_by_id(api_key.user_id)
                        if user_row is not None:
                            role = user_row.role
                            owner_role = role.value if hasattr(role, "value") else str(role)
                    permissions = await api_key_service.resolve_permissions(api_key, owner_role)
                    principal = ApiKeyPrincipal(
                        user_id=api_key.user_id,
                        api_key_id=api_key.id,
                        permissions=frozenset(permissions),
                    )
                    structlog.contextvars.bind_contextvars(
                        auth_provider="api_key",
                        user_id=str(api_key.user_id),
                    )
                    scope["user"] = principal
                    await app(scope, receive, send)
                    return

        # --- Anonymous ---
        scope["user"] = AnonymousPrincipal()
        await app(scope, receive, send)

    return middleware
