# backend/tests/test_auth_trusted_header.py
"""Tests for TrustedHeaderProvider (Phase 4 Slice F §5.4.3)."""

import uuid
from typing import TYPE_CHECKING, cast  # noqa: TC003 — cast used at runtime in _make_scope
from unittest.mock import AsyncMock, MagicMock

import pytest

from comradarr.core.auth.protocol import Failure, NotApplicable, Success
from comradarr.core.auth.trusted_header import (
    TrustedHeaderProvider,
    emit_startup_warnings,
    parse_cidr_allowlist,
)
from comradarr.db.enums import AuthProvider, ProvisioningProvider, UserRole
from tests.conftest import stub_settings

if TYPE_CHECKING:
    from litestar.types import Scope
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

    from comradarr.db.models.user import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_settings(**overrides: str) -> object:
    return stub_settings(overrides=overrides if overrides else None)


def _make_audit() -> AsyncMock:
    audit = AsyncMock()
    audit.record = AsyncMock(return_value=None)
    return audit


def _make_scope(peer_ip: str) -> Scope:
    return cast("Scope", cast("object", {"client": (peer_ip, 12345), "type": "http"}))


def _make_headers(mapping: dict[str, str]) -> list[tuple[bytes, bytes]]:
    return [(k.lower().encode(), v.encode()) for k, v in mapping.items()]


def _make_mock_sessionmaker(mock_repo: object) -> AsyncMock:
    """Build a mock sessionmaker whose context manager yields a session with mock_repo methods."""
    mock_session = MagicMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    # Inject the mock repo's methods onto the session so _build_user_repo produces them.
    mock_sessionmaker = MagicMock()
    mock_sessionmaker.return_value = mock_session
    return mock_sessionmaker


def _make_provider(
    *,
    enabled: bool = True,
    proxy_ips: list[str] | None = None,
    provision_policy: str = "auto_provision",
    username_header: str = "Remote-User",
    email_header: str = "Remote-Email",
    logout_url: str = "https://proxy.example.com/logout",
    audit: AsyncMock | None = None,
    sessionmaker: object | None = None,
) -> tuple[TrustedHeaderProvider, AsyncMock]:
    if proxy_ips is None:
        proxy_ips = ["192.168.1.0/24"]
    overrides: dict[str, str] = {
        "TRUSTED_HEADER_AUTH_ENABLED": "true" if enabled else "false",
        "TRUSTED_HEADER_AUTH_PROXY_IPS": ",".join(proxy_ips),
        "TRUSTED_HEADER_AUTH_PROVISION_POLICY": provision_policy,
        "TRUSTED_HEADER_AUTH_USERNAME_HEADER": username_header,
        "TRUSTED_HEADER_AUTH_EMAIL_HEADER": email_header,
        "TRUSTED_HEADER_AUTH_LOGOUT_URL": logout_url,
    }
    settings = stub_settings(overrides=overrides)
    allowlist = parse_cidr_allowlist(list(proxy_ips))
    if audit is None:
        audit = _make_audit()
    provider = TrustedHeaderProvider(
        settings=settings,
        audit=audit,
        allowlist=allowlist,
        sessionmaker=cast("async_sessionmaker[AsyncSession] | None", sessionmaker),
    )
    return provider, audit


async def _create_user(
    db_session: AsyncSession,
    *,
    username: str,
    email: str,
) -> User:
    from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

    repo = UserRepository(db_session)
    uid = uuid.uuid4().hex[:6]
    return await repo.create_provisioned(
        email=email or f"{uid}@example.com",
        username=username,
        provisioning_provider=ProvisioningProvider.TRUSTED_HEADER,
        role=UserRole.VIEWER,
    )


# ---------------------------------------------------------------------------
# Unit tests (no DB)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_not_applicable_when_disabled() -> None:
    """Provider returns NotApplicable when feature flag is off."""
    provider, _ = _make_provider(enabled=False)
    scope = _make_scope("192.168.1.10")
    headers = _make_headers({"Remote-User": "alice"})

    result = await provider.authenticate(scope, headers)

    assert isinstance(result, NotApplicable)


@pytest.mark.asyncio
async def test_not_applicable_when_peer_not_in_allowlist() -> None:
    """Peer IP outside CIDR allowlist → NotApplicable (no header read)."""
    provider, _ = _make_provider(proxy_ips=["10.0.0.0/8"])
    scope = _make_scope("192.168.1.10")  # not in 10.0.0.0/8
    headers = _make_headers({"Remote-User": "alice"})

    result = await provider.authenticate(scope, headers)

    assert isinstance(result, NotApplicable)


@pytest.mark.asyncio
async def test_not_applicable_when_no_client_in_scope() -> None:
    """Missing scope['client'] → NotApplicable."""
    provider, _ = _make_provider()
    scope = cast("Scope", cast("object", {"type": "http"}))
    headers = _make_headers({"Remote-User": "alice"})

    result = await provider.authenticate(scope, headers)

    assert isinstance(result, NotApplicable)


@pytest.mark.asyncio
async def test_not_applicable_when_username_header_missing() -> None:
    """Trusted peer but no username header → NotApplicable."""
    provider, _ = _make_provider()
    scope = _make_scope("192.168.1.10")
    headers: list[tuple[bytes, bytes]] = []

    result = await provider.authenticate(scope, headers)

    assert isinstance(result, NotApplicable)


# ---------------------------------------------------------------------------
# Integration tests (real DB)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_strict_match_unknown_user(db_engine: AsyncEngine) -> None:
    """strict_match policy → Failure for unknown username."""
    from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: PLC0415

    sm = async_sessionmaker(db_engine, expire_on_commit=False)
    provider, audit = _make_provider(provision_policy="strict_match", sessionmaker=sm)
    scope = _make_scope("192.168.1.5")
    headers = _make_headers({"Remote-User": "nobody"})

    result = await provider.authenticate(scope, headers)

    assert isinstance(result, Failure)
    assert result.problem_code == "authentication.unknown_user"
    audit.record.assert_not_called()


@pytest.mark.asyncio
async def test_auto_provision_creates_user(db_engine: AsyncEngine) -> None:
    """auto_provision creates a new user row and returns Success."""
    from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: PLC0415

    sm = async_sessionmaker(db_engine, expire_on_commit=False)
    provider, _ = _make_provider(provision_policy="auto_provision", sessionmaker=sm)
    scope = _make_scope("192.168.1.5")
    username = f"newuser-{uuid.uuid4().hex[:6]}"
    headers = _make_headers(
        {"Remote-User": username, "Remote-Email": f"{username}@corp.example.com"}
    )

    result = await provider.authenticate(scope, headers)

    assert isinstance(result, Success)
    assert result.auth_provider is AuthProvider.TRUSTED_HEADER
    assert result.freshly_provisioned is True

    # Verify user was actually created
    from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

    async with sm() as verify_session:
        repo = UserRepository(verify_session)
        created = await repo.get_by_username(username)
    assert created is not None
    assert created.provisioning_provider is ProvisioningProvider.TRUSTED_HEADER


@pytest.mark.asyncio
async def test_existing_user_resolves_without_provision(db_engine: AsyncEngine) -> None:
    """Known username resolves to Success without creating a new row."""
    from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: PLC0415

    sm = async_sessionmaker(db_engine, expire_on_commit=False)
    username = f"existing-{uuid.uuid4().hex[:6]}"

    # Create the user first using a separate session
    async with sm() as setup_session:
        existing = await _create_user(
            setup_session, username=username, email=f"{username}@example.com"
        )
        await setup_session.commit()

    provider, _ = _make_provider(sessionmaker=sm)
    scope = _make_scope("192.168.1.5")
    headers = _make_headers({"Remote-User": username})

    result = await provider.authenticate(scope, headers)

    assert isinstance(result, Success)
    assert result.user_id == existing.id
    assert result.freshly_provisioned is False


@pytest.mark.asyncio
async def test_dual_actor_audit_row_shape(db_engine: AsyncEngine) -> None:
    """LOGIN_SUCCESS audit includes trusted_proxy_ip and username_header_value."""
    from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: PLC0415

    sm = async_sessionmaker(db_engine, expire_on_commit=False)
    username = f"audited-{uuid.uuid4().hex[:6]}"

    async with sm() as setup_session:
        _ = await _create_user(setup_session, username=username, email=f"{username}@example.com")
        await setup_session.commit()

    audit = _make_audit()
    provider, _ = _make_provider(audit=audit, sessionmaker=sm)
    scope = _make_scope("192.168.1.42")
    headers = _make_headers({"Remote-User": username})

    result = await provider.authenticate(scope, headers)

    assert isinstance(result, Success)
    audit.record.assert_called_once()
    call_kwargs = audit.record.call_args.kwargs
    assert call_kwargs["action"].value == "login.success"
    ctx = call_kwargs["context"]
    assert ctx["trusted_proxy_ip"] == "192.168.1.42"
    assert ctx["username_header_value"] == username
    assert call_kwargs["ip"] == "192.168.1.42"


# ---------------------------------------------------------------------------
# Startup warning helpers
# ---------------------------------------------------------------------------


def test_world_readable_warning_fires_empty_proxy_ips() -> None:
    """Empty proxy_ips list triggers world-readable warning."""
    import structlog.testing  # noqa: PLC0415

    settings = stub_settings(
        overrides={
            "TRUSTED_HEADER_AUTH_ENABLED": "true",
            "TRUSTED_HEADER_AUTH_PROXY_IPS": "",
        }
    )
    with structlog.testing.capture_logs() as logs:
        emit_startup_warnings(settings)

    assert any("world_readable_proxy_ips" in e.get("event", "") for e in logs)


def test_world_readable_warning_fires_open_cidr() -> None:
    """0.0.0.0/0 triggers world-readable warning."""
    import structlog.testing  # noqa: PLC0415

    settings = stub_settings(
        overrides={
            "TRUSTED_HEADER_AUTH_ENABLED": "true",
            "TRUSTED_HEADER_AUTH_PROXY_IPS": "0.0.0.0/0",
        }
    )
    with structlog.testing.capture_logs() as logs:
        emit_startup_warnings(settings)

    assert any("world_readable_proxy_ips" in e.get("event", "") for e in logs)


def test_logout_url_warning_fires() -> None:
    """Missing logout URL triggers warning when feature is enabled."""
    import structlog.testing  # noqa: PLC0415

    settings = stub_settings(
        overrides={
            "TRUSTED_HEADER_AUTH_ENABLED": "true",
            "TRUSTED_HEADER_AUTH_PROXY_IPS": "10.0.0.0/8",
            "TRUSTED_HEADER_AUTH_LOGOUT_URL": "",
        }
    )
    with structlog.testing.capture_logs() as logs:
        emit_startup_warnings(settings)

    assert any("logout_url_missing" in e.get("event", "") for e in logs)


def test_no_warnings_when_disabled() -> None:
    """emit_startup_warnings is a no-op when feature is disabled."""
    import structlog.testing  # noqa: PLC0415

    settings = stub_settings(
        overrides={
            "TRUSTED_HEADER_AUTH_ENABLED": "false",
            "TRUSTED_HEADER_AUTH_PROXY_IPS": "",
        }
    )
    with structlog.testing.capture_logs() as logs:
        emit_startup_warnings(settings)

    assert logs == []


# ---------------------------------------------------------------------------
# Typed confirmation server validator (config field present)
# ---------------------------------------------------------------------------


def test_typed_confirmation_field_present() -> None:
    """typed_confirmation setting is loadable from env."""
    settings = stub_settings(
        overrides={
            "TRUSTED_HEADER_AUTH_TYPED_CONFIRMATION": "i-understand-the-risks",
        }
    )
    assert settings.trusted_header_auth_typed_confirmation == "i-understand-the-risks"


def test_typed_confirmation_defaults_empty() -> None:
    """typed_confirmation defaults to empty string (disabled)."""
    settings = stub_settings()
    assert settings.trusted_header_auth_typed_confirmation == ""
