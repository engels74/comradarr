# backend/tests/test_auth_controller.py
"""Unit tests for AuthController (Phase 4 Slice J §5.4).

All tests use MagicMock/AsyncMock stubs — no live DB or Litestar app required.
Exercises: login success/failure, logout, me, revoke-all-other.
OIDC start/callback are smoke-tested at the helper level only since OIDCService
is wired in Slice K.
"""

import hashlib
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from comradarr.api.controllers.auth import (
    MeResponse,
    _build_cookie,
    _extract_session_cookie,
    _hash_token,
)
from comradarr.core.auth.protocol import Failure, Success
from comradarr.core.auth.sessions import SessionPrincipal
from comradarr.db.enums import AuthProvider as AuthProviderEnum
from comradarr.db.enums import UserRole

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_settings(*, insecure: bool = True) -> MagicMock:
    s = MagicMock()
    s.comradarr_insecure_cookies = insecure
    s.trusted_header_auth_logout_url = None
    return s


def _make_principal(
    user_id: uuid.UUID | None = None,
    session_id: uuid.UUID | None = None,
    auth_provider: AuthProviderEnum = AuthProviderEnum.LOCAL,
) -> SessionPrincipal:
    return SessionPrincipal(
        user_id=user_id or uuid.uuid4(),
        session_id=session_id or uuid.uuid4(),
        auth_provider=auth_provider,
        oidc_provider_name=None,
    )


def _make_request(
    *,
    cookies: dict[str, str] | None = None,
    scope_user: object = None,
    settings: MagicMock | None = None,
    session_service: AsyncMock | None = None,
    local_provider: AsyncMock | None = None,
    headers: dict[str, str] | None = None,
    client_host: str = "127.0.0.1",
) -> MagicMock:
    req = MagicMock()
    req.cookies = cookies or {}
    req.scope = {"user": scope_user}
    req.headers = MagicMock()
    req.headers.get = MagicMock(return_value=(headers or {}).get("user-agent"))
    req.client = MagicMock()
    req.client.host = client_host

    state = MagicMock()
    state.settings = settings or _make_settings()
    state.session_service = session_service or AsyncMock()
    state.local_provider = local_provider or AsyncMock()
    req.app = MagicMock()
    req.app.state = state
    return req


# ---------------------------------------------------------------------------
# _hash_token
# ---------------------------------------------------------------------------


def test_hash_token_returns_sha256_bytes() -> None:
    token = "abc123"  # noqa: S105
    result = _hash_token(token)
    expected = hashlib.sha256(token.encode()).digest()
    assert result == expected


def test_hash_token_different_inputs_differ() -> None:
    assert _hash_token("a") != _hash_token("b")


# ---------------------------------------------------------------------------
# _build_cookie
# ---------------------------------------------------------------------------


def test_build_cookie_sets_value() -> None:
    settings = _make_settings(insecure=True)
    cookie = _build_cookie("tok123", settings=settings)
    assert cookie.value == "tok123"


def test_build_cookie_clear_empties_value_and_max_age() -> None:
    settings = _make_settings(insecure=True)
    cookie = _build_cookie("", settings=settings, clear=True)
    assert cookie.value == ""
    assert cookie.max_age == 0


def test_build_cookie_secure_flag_respects_insecure_setting() -> None:
    settings_secure = _make_settings(insecure=False)
    settings_insecure = _make_settings(insecure=True)
    assert _build_cookie("x", settings=settings_secure).secure is True
    assert _build_cookie("x", settings=settings_insecure).secure is False


# ---------------------------------------------------------------------------
# _extract_session_cookie
# ---------------------------------------------------------------------------


def test_extract_session_cookie_returns_value() -> None:
    req = _make_request(cookies={"comradarr_session": "mytoken"})
    assert _extract_session_cookie(req) == "mytoken"


def test_extract_session_cookie_missing_returns_none() -> None:
    req = _make_request(cookies={})
    assert _extract_session_cookie(req) is None


# ---------------------------------------------------------------------------
# me endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_me_returns_principal_fields() -> None:
    from comradarr.api.controllers.auth import AuthController

    uid = uuid.uuid4()
    sid = uuid.uuid4()
    principal = _make_principal(user_id=uid, session_id=sid)
    req = _make_request(scope_user=principal)

    ctrl = MagicMock()
    result = await AuthController.me.fn(ctrl, req)

    assert isinstance(result, MeResponse)
    assert result.user_id == uid
    assert result.session_id == sid
    assert result.auth_provider == AuthProviderEnum.LOCAL


@pytest.mark.asyncio
async def test_me_raises_session_expired_when_no_principal() -> None:
    from comradarr.api.controllers.auth import AuthController
    from comradarr.errors.authentication import AuthenticationSessionExpired

    req = _make_request(scope_user=None)
    ctrl = MagicMock()
    with pytest.raises(AuthenticationSessionExpired):
        await AuthController.me.fn(ctrl, req)


# ---------------------------------------------------------------------------
# login endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_success_returns_response_with_cookie() -> None:
    from comradarr.api.controllers.auth import AuthController, LoginRequest

    uid = uuid.uuid4()
    sid = uuid.uuid4()

    local_provider = AsyncMock()
    local_provider.authenticate_credentials = AsyncMock(
        return_value=Success(user_id=uid, auth_provider=AuthProviderEnum.LOCAL)
    )

    session_svc = AsyncMock()
    session_svc.mint = AsyncMock(return_value=("plain_tok", MagicMock(id=sid)))

    # Fake user object from DB
    fake_user = MagicMock()
    fake_user.id = uid
    fake_user.username = "admin"
    fake_user.role = UserRole.ADMIN

    fake_repo = AsyncMock()
    fake_repo.get_by_username = AsyncMock(return_value=fake_user)

    # Fake sessionmaker context manager
    fake_cm = MagicMock()
    fake_cm.__aenter__ = AsyncMock(return_value=MagicMock())
    fake_cm.__aexit__ = AsyncMock(return_value=False)

    req = _make_request(local_provider=local_provider, session_service=session_svc)
    req.app.state.db_sessionmaker = MagicMock(return_value=fake_cm)

    ctrl = MagicMock()
    data = LoginRequest(username="admin", password="secret")  # noqa: S106

    with patch("comradarr.repositories.auth.UserRepository", return_value=fake_repo):
        response = await AuthController.login.fn(ctrl, req, data)

    assert any(c.key == "comradarr_session" for c in response.cookies)


@pytest.mark.asyncio
async def test_login_failure_raises_invalid_credentials() -> None:
    from comradarr.api.controllers.auth import AuthController, LoginRequest
    from comradarr.errors.authentication import AuthenticationInvalidCredentials

    local_provider = AsyncMock()
    local_provider.authenticate_credentials = AsyncMock(
        return_value=Failure(reason="wrong", problem_code="x")
    )

    fake_cm = MagicMock()
    fake_cm.__aenter__ = AsyncMock(return_value=MagicMock())
    fake_cm.__aexit__ = AsyncMock(return_value=False)

    fake_repo = AsyncMock()

    req = _make_request(local_provider=local_provider)
    req.app.state.db_sessionmaker = MagicMock(return_value=fake_cm)

    ctrl = MagicMock()
    data = LoginRequest(username="bad", password="pass")  # noqa: S106

    with (
        patch("comradarr.repositories.auth.UserRepository", return_value=fake_repo),
        pytest.raises(AuthenticationInvalidCredentials),
    ):
        await AuthController.login.fn(ctrl, req, data)


# ---------------------------------------------------------------------------
# logout endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_logout_revokes_session_and_clears_cookie() -> None:
    from comradarr.api.controllers.auth import AuthController

    token = "existing_token"  # noqa: S105
    session_svc = AsyncMock()
    session_svc.revoke = AsyncMock()

    req = _make_request(
        cookies={"comradarr_session": token},
        session_service=session_svc,
    )

    ctrl = MagicMock()
    response = await AuthController.logout.fn(ctrl, req)

    session_svc.revoke.assert_awaited_once()
    assert any(c.key == "comradarr_session" and c.max_age == 0 for c in response.cookies)


@pytest.mark.asyncio
async def test_logout_no_cookie_still_succeeds() -> None:
    from comradarr.api.controllers.auth import AuthController

    session_svc = AsyncMock()
    session_svc.revoke = AsyncMock()
    req = _make_request(cookies={}, session_service=session_svc)

    ctrl = MagicMock()
    response = await AuthController.logout.fn(ctrl, req)

    session_svc.revoke.assert_not_awaited()
    assert response is not None


# ---------------------------------------------------------------------------
# revoke_all_other endpoint
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_all_other_calls_service() -> None:
    from comradarr.api.controllers.auth import AuthController

    uid = uuid.uuid4()
    principal = _make_principal(user_id=uid)
    token = "curr_tok"  # noqa: S105
    session_svc = AsyncMock()
    session_svc.revoke_all_other = AsyncMock()

    req = _make_request(
        scope_user=principal,
        cookies={"comradarr_session": token},
        session_service=session_svc,
    )

    ctrl = MagicMock()
    await AuthController.revoke_all_other.fn(ctrl, req)

    expected_hash = hashlib.sha256(token.encode()).digest()
    session_svc.revoke_all_other.assert_awaited_once_with(uid, expected_hash)


@pytest.mark.asyncio
async def test_revoke_all_other_raises_if_no_principal() -> None:
    from comradarr.api.controllers.auth import AuthController
    from comradarr.errors.authentication import AuthenticationSessionExpired

    req = _make_request(scope_user=None, cookies={"comradarr_session": "x"})
    ctrl = MagicMock()
    with pytest.raises(AuthenticationSessionExpired):
        await AuthController.revoke_all_other.fn(ctrl, req)


@pytest.mark.asyncio
async def test_revoke_all_other_raises_if_no_cookie() -> None:
    from comradarr.api.controllers.auth import AuthController
    from comradarr.errors.authentication import AuthenticationSessionExpired

    principal = _make_principal()
    req = _make_request(scope_user=principal, cookies={})
    ctrl = MagicMock()
    with pytest.raises(AuthenticationSessionExpired):
        await AuthController.revoke_all_other.fn(ctrl, req)
