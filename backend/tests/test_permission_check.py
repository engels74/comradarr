# backend/tests/test_permission_check.py
"""Tests for requires_permission Guard factory (plan §5.4 Slice I).

All tests use stub ASGIConnection objects — no live DB required.

Acceptance criteria:
- anonymous-on-auth-required → 401 AuthenticationInvalidCredentials
- cookie-was-present + anonymous → 401 AuthenticationSessionExpired
- viewer-on-admin-route → 403 AuthorizationPermissionRequired
- api-key principal with required permission → passes
- api-key principal missing required permission → 403
"""

import uuid
from unittest.mock import MagicMock

import pytest

from comradarr.api.middleware.permission import requires_permission
from comradarr.core.auth.api_keys import AnonymousPrincipal, ApiKeyPrincipal
from comradarr.core.auth.sessions import SessionPrincipal
from comradarr.db.enums import AuthProvider as AuthProviderEnum
from comradarr.errors.authentication import (
    AuthenticationInvalidCredentials,
    AuthenticationSessionExpired,
)
from comradarr.errors.authorization import AuthorizationPermissionRequired

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_connection(
    user: object,
    cookie_was_present: bool = False,
    db_sessionmaker: object = None,
) -> object:
    """Build a minimal stub ASGIConnection with ``scope["user"]`` set."""
    state = MagicMock()
    state.db_sessionmaker = db_sessionmaker

    litestar_app = MagicMock()
    litestar_app.state = state

    scope: dict[str, object] = {
        "user": user,
        "app": litestar_app,
    }
    if cookie_was_present:
        scope["_cookie_was_present"] = True

    conn = MagicMock()
    conn.scope = scope
    return conn


def _make_api_key_principal(permissions: set[str]) -> ApiKeyPrincipal:
    return ApiKeyPrincipal(
        user_id=uuid.uuid4(),
        api_key_id=uuid.uuid4(),
        permissions=frozenset(permissions),
    )


def _make_session_principal() -> SessionPrincipal:
    return SessionPrincipal(
        user_id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        auth_provider=AuthProviderEnum.LOCAL,
    )


# ---------------------------------------------------------------------------
# Anonymous principal tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_anonymous_raises_invalid_credentials() -> None:
    guard = requires_permission("admin.read")
    conn = _make_connection(AnonymousPrincipal())
    with pytest.raises(AuthenticationInvalidCredentials):
        await guard(conn, MagicMock())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_anonymous_with_cookie_raises_session_expired() -> None:
    guard = requires_permission("admin.read")
    conn = _make_connection(AnonymousPrincipal(), cookie_was_present=True)
    with pytest.raises(AuthenticationSessionExpired):
        await guard(conn, MagicMock())  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# ApiKeyPrincipal tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_api_key_with_required_permission_passes() -> None:
    guard = requires_permission("media.read")
    conn = _make_connection(_make_api_key_principal({"media.read", "media.write"}))
    # Should not raise
    await guard(conn, MagicMock())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_api_key_missing_permission_raises_forbidden() -> None:
    guard = requires_permission("admin.write")
    conn = _make_connection(_make_api_key_principal({"media.read"}))
    with pytest.raises(AuthorizationPermissionRequired) as exc_info:
        await guard(conn, MagicMock())  # type: ignore[arg-type]
    assert exc_info.value.context.get("required") == "admin.write"


@pytest.mark.asyncio
async def test_api_key_empty_permissions_raises_forbidden() -> None:
    guard = requires_permission("any.permission")
    conn = _make_connection(_make_api_key_principal(set()))
    with pytest.raises(AuthorizationPermissionRequired):
        await guard(conn, MagicMock())  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# SessionPrincipal tests (no DB sessionmaker → passthrough for unit tests)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_session_principal_without_sessionmaker_raises_forbidden() -> None:
    """Without a DB sessionmaker, the guard default-denies (no silent authz bypass)."""
    guard = requires_permission("admin.read")
    conn = _make_connection(_make_session_principal(), db_sessionmaker=None)
    with pytest.raises(AuthorizationPermissionRequired):
        await guard(conn, MagicMock())  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Unrecognised principal
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_principal_raises_invalid_credentials() -> None:
    guard = requires_permission("any.permission")

    class _WeirdPrincipal:
        pass

    conn = _make_connection(_WeirdPrincipal())
    with pytest.raises(AuthenticationInvalidCredentials):
        await guard(conn, MagicMock())  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Contextual error detail
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_permission_error_context_contains_required_name() -> None:
    perm = "settings.manage"
    guard = requires_permission(perm)
    conn = _make_connection(_make_api_key_principal(set()))
    with pytest.raises(AuthorizationPermissionRequired) as exc_info:
        await guard(conn, MagicMock())  # type: ignore[arg-type]
    assert exc_info.value.context["required"] == perm
