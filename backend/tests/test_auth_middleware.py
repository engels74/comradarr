# backend/tests/test_auth_middleware.py
"""Tests for auth_middleware (plan §5.4 Slice I).

All tests use pure ASGI stub scaffolding — no live DB required.

Acceptance criteria:
- cookie wins when both cookie and API-key present and cookie valid
- API-key wins when no cookie
- both invalid → anonymous principal bound (401 handled at permission stage)
- allowlist paths bypass auth entirely
- cookie present but invalid → anonymous + _cookie_was_present flag
"""

import uuid
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock

import pytest

from comradarr.api.middleware.auth import _ALLOWLIST, auth_middleware
from comradarr.core.auth.api_keys import AnonymousPrincipal, ApiKeyPrincipal
from comradarr.core.auth.sessions import SessionPrincipal
from comradarr.db.enums import AuthProvider as AuthProviderEnum

if TYPE_CHECKING:
    from litestar.types import Scope

# ---------------------------------------------------------------------------
# ASGI test helpers
# ---------------------------------------------------------------------------


class _SimpleApp:
    """Records the scope it receives so tests can inspect it."""

    captured_scope: dict[object, object]

    def __init__(self) -> None:
        self.captured_scope = {}

    async def __call__(self, scope: object, receive: object, send: object) -> None:
        self.captured_scope = cast("dict[object, object]", scope)


def _make_scope(
    path: str = "/api/protected",
    headers: list[tuple[bytes, bytes]] | None = None,
    client: tuple[str, int] | None = ("127.0.0.1", 12345),
    state_overrides: dict[str, object] | None = None,
) -> dict[str, object]:
    app_state = MagicMock()
    app_state.session_service = None
    app_state.api_key_service = None
    app_state.rate_limiter = None
    if state_overrides:
        for k, v in state_overrides.items():
            setattr(app_state, k, v)

    litestar_app = MagicMock()
    litestar_app.state = app_state

    return {
        "type": "http",
        "path": path,
        "headers": headers or [],
        "client": client,
        "app": litestar_app,
    }


def _cookie_header(token: str) -> tuple[bytes, bytes]:
    return (b"cookie", f"comradarr_session={token}".encode())


def _api_key_header(key: str) -> tuple[bytes, bytes]:
    return (b"x-api-key", key.encode())


def _make_session_principal(user_id: uuid.UUID | None = None) -> SessionPrincipal:
    return SessionPrincipal(
        user_id=user_id or uuid.uuid4(),
        session_id=uuid.uuid4(),
        auth_provider=AuthProviderEnum.LOCAL,
    )


# ---------------------------------------------------------------------------
# Allowlist bypass
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("path", list(_ALLOWLIST))
async def test_allowlist_paths_bypass_auth(path: str) -> None:
    inner = _SimpleApp()
    middleware = auth_middleware(inner)
    scope = _make_scope(path=path)
    await middleware(cast("Scope", cast("object", scope)), AsyncMock(), AsyncMock())

    assert isinstance(scope.get("user"), AnonymousPrincipal)
    # Inner app was still called (bypass, not reject)
    assert inner.captured_scope is scope


@pytest.mark.asyncio
async def test_health_subpath_is_bypassed() -> None:
    inner = _SimpleApp()
    middleware = auth_middleware(inner)
    scope = _make_scope(path="/api/health")
    await middleware(cast("Scope", cast("object", scope)), AsyncMock(), AsyncMock())
    assert isinstance(scope.get("user"), AnonymousPrincipal)


# ---------------------------------------------------------------------------
# Cookie path wins when valid
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cookie_path_sets_session_principal() -> None:
    principal = _make_session_principal()
    session_service = MagicMock()
    session_service.validate = AsyncMock(return_value=principal)

    inner = _SimpleApp()
    middleware = auth_middleware(inner)
    scope = _make_scope(
        headers=[_cookie_header("valid-token")],
        state_overrides={"session_service": session_service},
    )
    await middleware(cast("Scope", cast("object", scope)), AsyncMock(), AsyncMock())

    assert scope.get("user") is principal
    session_service.validate.assert_awaited_once_with("valid-token")


@pytest.mark.asyncio
async def test_cookie_wins_over_api_key_when_both_present() -> None:
    """Cookie-first: valid cookie wins even when API-key header is also present."""
    user_id = uuid.uuid4()
    principal = _make_session_principal(user_id)
    session_service = MagicMock()
    session_service.validate = AsyncMock(return_value=principal)

    inner = _SimpleApp()
    middleware = auth_middleware(inner)
    scope = _make_scope(
        headers=[
            _cookie_header("valid-token"),
            _api_key_header("cmrr_live_somerandombytes"),
        ],
        state_overrides={"session_service": session_service},
    )
    await middleware(cast("Scope", cast("object", scope)), AsyncMock(), AsyncMock())

    assert scope.get("user") is principal
    assert isinstance(scope.get("user"), SessionPrincipal)


# ---------------------------------------------------------------------------
# API-key path wins when no cookie
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_api_key_path_sets_api_key_principal() -> None:
    user_id = uuid.uuid4()
    api_key_id = uuid.uuid4()

    from comradarr.db.models.api_key import ApiKey

    api_key_row = MagicMock(spec=ApiKey)
    api_key_row.id = api_key_id
    api_key_row.user_id = user_id

    api_key_service = MagicMock()
    api_key_service.validate = AsyncMock(return_value=api_key_row)
    api_key_service.resolve_permissions = AsyncMock(return_value={"read", "write"})

    inner = _SimpleApp()
    middleware = auth_middleware(inner)
    scope = _make_scope(
        headers=[_api_key_header("cmrr_live_aaabbbccc")],
        state_overrides={"api_key_service": api_key_service},
    )
    await middleware(cast("Scope", cast("object", scope)), AsyncMock(), AsyncMock())

    user = scope.get("user")
    assert isinstance(user, ApiKeyPrincipal)
    assert user.user_id == user_id
    assert user.api_key_id == api_key_id
    assert "read" in user.permissions


@pytest.mark.asyncio
async def test_bearer_api_key_is_accepted() -> None:
    """Authorization: Bearer cmrr_live_... should also resolve via API-key path."""
    user_id = uuid.uuid4()

    from comradarr.db.models.api_key import ApiKey

    api_key_row = MagicMock(spec=ApiKey)
    api_key_row.id = uuid.uuid4()
    api_key_row.user_id = user_id

    api_key_service = MagicMock()
    api_key_service.validate = AsyncMock(return_value=api_key_row)
    api_key_service.resolve_permissions = AsyncMock(return_value=set())

    inner = _SimpleApp()
    middleware = auth_middleware(inner)
    scope = _make_scope(
        headers=[(b"authorization", b"Bearer cmrr_live_abc123xyz")],
        state_overrides={"api_key_service": api_key_service},
    )
    await middleware(cast("Scope", cast("object", scope)), AsyncMock(), AsyncMock())

    assert isinstance(scope.get("user"), ApiKeyPrincipal)


# ---------------------------------------------------------------------------
# Both invalid → anonymous
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invalid_cookie_and_no_api_key_yields_anonymous() -> None:
    session_service = MagicMock()
    session_service.validate = AsyncMock(return_value=None)

    inner = _SimpleApp()
    middleware = auth_middleware(inner)
    scope = _make_scope(
        headers=[_cookie_header("bad-token")],
        state_overrides={"session_service": session_service},
    )
    await middleware(cast("Scope", cast("object", scope)), AsyncMock(), AsyncMock())

    assert isinstance(scope.get("user"), AnonymousPrincipal)
    # Cookie was present but invalid → flag is set for permission layer
    assert scope.get("_cookie_was_present") is True


@pytest.mark.asyncio
async def test_no_credentials_yields_anonymous() -> None:
    inner = _SimpleApp()
    middleware = auth_middleware(inner)
    scope = _make_scope()
    await middleware(cast("Scope", cast("object", scope)), AsyncMock(), AsyncMock())

    assert isinstance(scope.get("user"), AnonymousPrincipal)
    assert scope.get("_cookie_was_present") is None


@pytest.mark.asyncio
async def test_api_key_miss_yields_anonymous() -> None:
    """Structurally valid API-key prefix but not in DB → anonymous."""
    api_key_service = MagicMock()
    api_key_service.validate = AsyncMock(return_value=None)

    inner = _SimpleApp()
    middleware = auth_middleware(inner)
    scope = _make_scope(
        headers=[_api_key_header("cmrr_live_unknownkey")],
        state_overrides={"api_key_service": api_key_service},
    )
    await middleware(cast("Scope", cast("object", scope)), AsyncMock(), AsyncMock())

    assert isinstance(scope.get("user"), AnonymousPrincipal)


# ---------------------------------------------------------------------------
# Non-HTTP scope passthrough
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_http_scope_is_passed_through() -> None:
    inner = _SimpleApp()
    middleware = auth_middleware(inner)
    scope: dict[str, object] = {"type": "lifespan"}
    await middleware(cast("Scope", cast("object", scope)), AsyncMock(), AsyncMock())
    # No "user" key injected; inner app was called
    assert "user" not in scope
    assert inner.captured_scope is scope
