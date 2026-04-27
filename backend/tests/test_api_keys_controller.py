# backend/tests/test_api_keys_controller.py
"""Unit tests for ApiKeysController (Phase 4 Slice J §5.4).

All tests use MagicMock/AsyncMock stubs — no live DB required.
Exercises: issue, list, revoke; admin-only gate; DB-backed role check (FIX-X);
ownership check on revoke (FIX-Y).
"""

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from comradarr.api.controllers.api_keys import (
    ApiKeyDTO,
    ApiKeyListResponse,
    IssuedKeyResponse,
    _check_admin_role,
    _require_admin,
    _to_dto,
)
from comradarr.core.auth.sessions import SessionPrincipal
from comradarr.db.enums import AuthProvider as AuthProviderEnum
from comradarr.db.enums import UserRole
from comradarr.errors.authorization import AuthorizationForbidden

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_principal(
    user_id: uuid.UUID | None = None,
    auth_provider: AuthProviderEnum = AuthProviderEnum.LOCAL,
) -> SessionPrincipal:
    return SessionPrincipal(
        user_id=user_id or uuid.uuid4(),
        session_id=uuid.uuid4(),
        auth_provider=auth_provider,
        oidc_provider_name=None,
    )


def _make_db_sessionmaker(*, user_role: UserRole = UserRole.ADMIN) -> MagicMock:
    """Build a mock db_sessionmaker that yields a session returning a user with given role."""
    fake_user = MagicMock()
    fake_user.role = user_role

    fake_repo = AsyncMock()
    fake_repo.get_by_id = AsyncMock(return_value=fake_user)

    fake_session = MagicMock()
    fake_session.__aenter__ = AsyncMock(return_value=fake_session)
    fake_session.__aexit__ = AsyncMock(return_value=False)
    fake_session.get = AsyncMock(return_value=None)  # default: no key found

    return MagicMock(return_value=fake_session)


def _make_request(
    *,
    scope_user: object = None,
    api_key_service: AsyncMock | None = None,
    user_role: UserRole = UserRole.ADMIN,
    client_host: str = "127.0.0.1",
) -> MagicMock:
    req = MagicMock()
    req.scope = {"user": scope_user}
    req.headers = MagicMock()
    req.headers.get = MagicMock(return_value=None)
    req.client = MagicMock()
    req.client.host = client_host

    state = MagicMock()
    state.api_key_service = api_key_service or AsyncMock()
    state.db_sessionmaker = _make_db_sessionmaker(user_role=user_role)
    req.app = MagicMock()
    req.app.state = state
    return req


def _make_api_key(
    *,
    key_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    name: str = "test-key",
    prefix: str = "cmrr_live_abc",
    last_four: str = "1234",
    created_at: datetime | None = None,
    expires_at: datetime | None = None,
    last_used_at: datetime | None = None,
) -> MagicMock:
    key = MagicMock()
    key.id = key_id or uuid.uuid4()
    key.user_id = user_id or uuid.uuid4()
    key.name = name
    key.prefix = prefix
    key.last_four = last_four
    key.created_at = created_at or datetime(2025, 1, 1, 0, 0, 0)
    key.expires_at = expires_at
    key.last_used_at = last_used_at
    return key


# ---------------------------------------------------------------------------
# _require_admin
# ---------------------------------------------------------------------------


def test_require_admin_returns_principal_for_local_auth() -> None:
    principal = _make_principal(auth_provider=AuthProviderEnum.LOCAL)
    req = _make_request(scope_user=principal)
    result = _require_admin(req)
    assert result is principal


def test_require_admin_raises_if_no_user_in_scope() -> None:
    req = _make_request(scope_user=None)
    with pytest.raises(AuthorizationForbidden):
        _require_admin(req)


def test_require_admin_raises_if_api_key_auth() -> None:
    principal = _make_principal(auth_provider=AuthProviderEnum.API_KEY)
    req = _make_request(scope_user=principal)
    with pytest.raises(AuthorizationForbidden):
        _require_admin(req)


# ---------------------------------------------------------------------------
# _check_admin_role (now async + DB-backed — FIX-X)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_admin_role_passes_for_admin() -> None:
    principal = _make_principal()
    req = _make_request(scope_user=principal, user_role=UserRole.ADMIN)
    with patch("comradarr.repositories.auth.UserRepository") as mock_repo:
        fake_user = MagicMock()
        fake_user.role = UserRole.ADMIN
        mock_repo.return_value.get_by_id = AsyncMock(return_value=fake_user)
        await _check_admin_role(req, principal)


@pytest.mark.asyncio
async def test_check_admin_role_raises_for_viewer() -> None:
    principal = _make_principal()
    req = _make_request(scope_user=principal, user_role=UserRole.VIEWER)
    with patch("comradarr.repositories.auth.UserRepository") as mock_repo:
        fake_user = MagicMock()
        fake_user.role = UserRole.VIEWER
        mock_repo.return_value.get_by_id = AsyncMock(return_value=fake_user)
        with pytest.raises(AuthorizationForbidden):
            await _check_admin_role(req, principal)


@pytest.mark.asyncio
async def test_check_admin_role_raises_if_user_not_found() -> None:
    principal = _make_principal()
    req = _make_request(scope_user=principal)
    with patch("comradarr.repositories.auth.UserRepository") as mock_repo:
        mock_repo.return_value.get_by_id = AsyncMock(return_value=None)
        with pytest.raises(AuthorizationForbidden):
            await _check_admin_role(req, principal)


# ---------------------------------------------------------------------------
# _to_dto
# ---------------------------------------------------------------------------


def test_to_dto_adds_utc_when_naive() -> None:
    key = _make_api_key(created_at=datetime(2025, 6, 1, 12, 0, 0))
    dto = _to_dto(key)  # type: ignore[arg-type]
    assert dto.created_at.tzinfo is UTC


def test_to_dto_preserves_aware_created_at() -> None:
    aware = datetime(2025, 6, 1, 12, 0, 0, tzinfo=UTC)
    key = _make_api_key(created_at=aware)
    dto = _to_dto(key)  # type: ignore[arg-type]
    assert dto.created_at == aware


def test_to_dto_maps_fields() -> None:
    kid = uuid.uuid4()
    key = _make_api_key(key_id=kid, name="my-key", prefix="cmrr_live_abc", last_four="5678")
    dto = _to_dto(key)  # type: ignore[arg-type]
    assert isinstance(dto, ApiKeyDTO)
    assert dto.id == kid
    assert dto.name == "my-key"
    assert dto.prefix == "cmrr_live_abc"
    assert dto.last_four == "5678"


# ---------------------------------------------------------------------------
# ApiKeysController.issue_key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_issue_key_returns_plaintext_and_dto() -> None:
    from comradarr.api.controllers.api_keys import ApiKeysController, IssueKeyRequest

    uid = uuid.uuid4()
    principal = _make_principal(user_id=uid)
    fake_key = _make_api_key(user_id=uid)
    api_key_svc = AsyncMock()
    api_key_svc.issue = AsyncMock(return_value=("cmrr_live_plaintext", fake_key))

    req = _make_request(scope_user=principal, api_key_service=api_key_svc)

    ctrl = MagicMock()
    data = IssueKeyRequest(name="ci-key", scopes=["read"])

    with patch("comradarr.repositories.auth.UserRepository") as mock_repo:
        fake_user = MagicMock()
        fake_user.role = UserRole.ADMIN
        mock_repo.return_value.get_by_id = AsyncMock(return_value=fake_user)
        result = await ApiKeysController.issue_key.fn(ctrl, req, data)

    assert isinstance(result, IssuedKeyResponse)
    assert result.plaintext == "cmrr_live_plaintext"
    assert isinstance(result.key, ApiKeyDTO)
    api_key_svc.issue.assert_awaited_once()


@pytest.mark.asyncio
async def test_issue_key_raises_for_api_key_auth() -> None:
    from comradarr.api.controllers.api_keys import ApiKeysController, IssueKeyRequest

    principal = _make_principal(auth_provider=AuthProviderEnum.API_KEY)
    req = _make_request(scope_user=principal)

    ctrl = MagicMock()
    data = IssueKeyRequest(name="k")
    with pytest.raises(AuthorizationForbidden):
        await ApiKeysController.issue_key.fn(ctrl, req, data)


# ---------------------------------------------------------------------------
# ApiKeysController.list_keys
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_keys_returns_all_owned_keys() -> None:
    from comradarr.api.controllers.api_keys import ApiKeysController

    uid = uuid.uuid4()
    principal = _make_principal(user_id=uid)
    fake_keys = [_make_api_key(name=f"key-{i}", user_id=uid) for i in range(3)]

    fake_repo = AsyncMock()
    fake_repo.list_for_user = AsyncMock(return_value=fake_keys)

    req = _make_request(scope_user=principal)

    ctrl = MagicMock()

    with (
        patch("comradarr.repositories.auth.UserRepository") as mock_user_repo,
        patch("comradarr.repositories.auth.ApiKeyRepository", return_value=fake_repo),
    ):
        fake_user = MagicMock()
        fake_user.role = UserRole.ADMIN
        mock_user_repo.return_value.get_by_id = AsyncMock(return_value=fake_user)
        result = await ApiKeysController.list_keys.fn(ctrl, req)

    assert isinstance(result, ApiKeyListResponse)
    assert len(result.keys) == 3


# ---------------------------------------------------------------------------
# ApiKeysController.revoke_key
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_key_calls_service_revoke() -> None:
    from comradarr.api.controllers.api_keys import ApiKeysController

    uid = uuid.uuid4()
    key_id = uuid.uuid4()
    principal = _make_principal(user_id=uid)
    api_key_svc = AsyncMock()
    api_key_svc.revoke = AsyncMock()

    # Mock ApiKey with matching user_id for ownership check
    fake_api_key = MagicMock()
    fake_api_key.user_id = uid

    req = _make_request(scope_user=principal, api_key_service=api_key_svc)
    # Wire db_session.get to return the owned key
    req.app.state.db_sessionmaker.return_value.__aenter__.return_value.get = AsyncMock(
        return_value=fake_api_key
    )

    ctrl = MagicMock()

    with patch("comradarr.repositories.auth.UserRepository") as mock_repo:
        fake_user = MagicMock()
        fake_user.role = UserRole.ADMIN
        mock_repo.return_value.get_by_id = AsyncMock(return_value=fake_user)
        response = await ApiKeysController.revoke_key.fn(ctrl, req, key_id)

    api_key_svc.revoke.assert_awaited_once()
    call_kwargs = api_key_svc.revoke.call_args.kwargs
    assert call_kwargs["api_key_id"] == key_id
    assert call_kwargs["actor_user_id"] == uid
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_revoke_key_raises_if_key_not_owned() -> None:
    """FIX-Y: revoke_key must raise when key belongs to a different user (IDOR prevention)."""
    from comradarr.api.controllers.api_keys import ApiKeysController

    uid = uuid.uuid4()
    other_uid = uuid.uuid4()
    key_id = uuid.uuid4()
    principal = _make_principal(user_id=uid)
    api_key_svc = AsyncMock()

    # Key owned by a different user
    fake_api_key = MagicMock()
    fake_api_key.user_id = other_uid

    req = _make_request(scope_user=principal, api_key_service=api_key_svc)
    req.app.state.db_sessionmaker.return_value.__aenter__.return_value.get = AsyncMock(
        return_value=fake_api_key
    )

    ctrl = MagicMock()

    with patch("comradarr.repositories.auth.UserRepository") as mock_repo:
        fake_user = MagicMock()
        fake_user.role = UserRole.ADMIN
        mock_repo.return_value.get_by_id = AsyncMock(return_value=fake_user)
        with pytest.raises(AuthorizationForbidden):
            await ApiKeysController.revoke_key.fn(ctrl, req, key_id)


@pytest.mark.asyncio
async def test_revoke_key_raises_if_key_not_found() -> None:
    """FIX-Y: revoke_key must raise 403 when key does not exist."""
    from comradarr.api.controllers.api_keys import ApiKeysController

    uid = uuid.uuid4()
    key_id = uuid.uuid4()
    principal = _make_principal(user_id=uid)

    req = _make_request(scope_user=principal)
    req.app.state.db_sessionmaker.return_value.__aenter__.return_value.get = AsyncMock(
        return_value=None
    )

    ctrl = MagicMock()

    with patch("comradarr.repositories.auth.UserRepository") as mock_repo:
        fake_user = MagicMock()
        fake_user.role = UserRole.ADMIN
        mock_repo.return_value.get_by_id = AsyncMock(return_value=fake_user)
        with pytest.raises(AuthorizationForbidden):
            await ApiKeysController.revoke_key.fn(ctrl, req, key_id)


@pytest.mark.asyncio
async def test_revoke_key_raises_for_non_admin() -> None:
    from comradarr.api.controllers.api_keys import ApiKeysController

    principal = _make_principal(auth_provider=AuthProviderEnum.API_KEY)
    req = _make_request(scope_user=principal)

    ctrl = MagicMock()
    with pytest.raises(AuthorizationForbidden):
        await ApiKeysController.revoke_key.fn(ctrl, req, uuid.uuid4())
