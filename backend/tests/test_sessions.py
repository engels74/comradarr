# backend/tests/test_sessions.py
"""Tests for SessionService (Phase 4 Slice B §5.4.5)."""

import asyncio
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, patch

import pytest

from tests.conftest import stub_settings

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncSession

    from comradarr.db.models.user import User


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_settings(
    *,
    idle_days: int = 7,
    absolute_days: int = 30,
) -> object:
    return stub_settings(
        overrides={
            "COMRADARR_SESSION_IDLE_DAYS": str(idle_days),
            "COMRADARR_SESSION_ABSOLUTE_DAYS": str(absolute_days),
        }
    )


def _make_audit() -> AsyncMock:
    audit = AsyncMock()
    audit.record = AsyncMock(return_value=None)
    return audit


def _make_sessionmaker(db_session: AsyncSession) -> object:
    """Return a callable that yields db_session as an async context manager.

    Wires SessionService to share the test transaction so all DB writes are
    visible within the same connection and rolled back on teardown.
    """

    @asynccontextmanager
    async def _sessionmaker() -> AsyncIterator[AsyncSession]:
        yield db_session

    return _sessionmaker


async def _create_test_user(db_session: AsyncSession) -> User:
    """Insert a minimal local user row for FK-satisfaction in session tests."""
    from comradarr.db.enums import UserRole  # noqa: PLC0415
    from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

    repo = UserRepository(db_session)
    uid = uuid.uuid4().hex[:8]
    return await repo.create_local(
        email=f"test-{uid}@example.com",
        username=f"testuser-{uid}",
        password_hash="$argon2id$v=19$stub",  # noqa: S106 — test stub, not a real credential
        role=UserRole.VIEWER,
    )


async def _drain_tasks() -> None:
    """Yield control so fire-and-forget tasks can complete before assertions."""
    await asyncio.sleep(0)
    await asyncio.sleep(0)


# ---------------------------------------------------------------------------
# Token uniqueness (no DB required)
# ---------------------------------------------------------------------------


def test_token_uniqueness_1000_iterations() -> None:
    """1000 generated tokens must all be unique (collision = catastrophic)."""
    tokens = {secrets.token_urlsafe(32) for _ in range(1000)}
    assert len(tokens) == 1000


# ---------------------------------------------------------------------------
# Fixation defense
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fixation_defense(db_session: AsyncSession) -> None:
    """Pre-login and post-login tokens must differ byte-for-byte."""
    from comradarr.core.auth import sessions as sessions_module  # noqa: PLC0415
    from comradarr.core.auth.sessions import SessionService, _hash_token  # noqa: PLC0415
    from comradarr.db.enums import AuthProvider  # noqa: PLC0415

    settings = _make_settings()
    audit = _make_audit()
    svc = SessionService(
        sessionmaker=_make_sessionmaker(db_session),  # pyright: ignore[reportArgumentType]
        settings=settings,  # pyright: ignore[reportArgumentType]
        audit=audit,  # pyright: ignore[reportArgumentType]
    )

    user = await _create_test_user(db_session)
    pre_login_token = secrets.token_urlsafe(32)
    pre_login_hash = _hash_token(pre_login_token)

    # Suppress fire-and-forget to avoid concurrent connection use in tests
    with patch.object(sessions_module, "_update_last_seen", new=AsyncMock(return_value=None)):
        post_login_token, _session = await svc.mint(
            user_id=user.id,
            auth_provider=AuthProvider.LOCAL,
            oidc_provider_name=None,
            ip="127.0.0.1",
            user_agent="test-agent",
            replace_token_hash=pre_login_hash,
        )

    assert post_login_token != pre_login_token
    assert _hash_token(post_login_token) != pre_login_hash


# ---------------------------------------------------------------------------
# Idle timeout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_idle_timeout_expired(db_session: AsyncSession) -> None:
    """A session not seen for > idle_days must return None from validate."""
    from comradarr.core.auth import sessions as sessions_module  # noqa: PLC0415
    from comradarr.core.auth.sessions import SessionService  # noqa: PLC0415
    from comradarr.db.enums import AuthProvider  # noqa: PLC0415

    settings = _make_settings(idle_days=7, absolute_days=30)
    audit = _make_audit()
    svc = SessionService(
        sessionmaker=_make_sessionmaker(db_session),  # pyright: ignore[reportArgumentType]
        settings=settings,  # pyright: ignore[reportArgumentType]
        audit=audit,  # pyright: ignore[reportArgumentType]
    )

    user = await _create_test_user(db_session)
    # Suppress fire-and-forget to avoid concurrent connection use in tests
    with patch.object(sessions_module, "_update_last_seen", new=AsyncMock(return_value=None)):
        plaintext, session_row = await svc.mint(
            user_id=user.id,
            auth_provider=AuthProvider.LOCAL,
            oidc_provider_name=None,
            ip=None,
            user_agent=None,
            replace_token_hash=None,
        )

        # Backdate last_seen_at to 8 days ago (past idle threshold)
        session_row.last_seen_at = datetime.now(UTC) - timedelta(days=8)
        await db_session.flush()

        principal = await svc.validate(plaintext)

    assert principal is None


@pytest.mark.asyncio
async def test_idle_timeout_not_expired(db_session: AsyncSession) -> None:
    """A session seen recently must still be valid."""
    from comradarr.core.auth import sessions as sessions_module  # noqa: PLC0415
    from comradarr.core.auth.sessions import SessionService  # noqa: PLC0415
    from comradarr.db.enums import AuthProvider  # noqa: PLC0415

    settings = _make_settings(idle_days=7, absolute_days=30)
    audit = _make_audit()
    svc = SessionService(
        sessionmaker=_make_sessionmaker(db_session),  # pyright: ignore[reportArgumentType]
        settings=settings,  # pyright: ignore[reportArgumentType]
        audit=audit,  # pyright: ignore[reportArgumentType]
    )

    user = await _create_test_user(db_session)
    with patch.object(sessions_module, "_update_last_seen", new=AsyncMock(return_value=None)):
        plaintext, _session = await svc.mint(
            user_id=user.id,
            auth_provider=AuthProvider.LOCAL,
            oidc_provider_name=None,
            ip=None,
            user_agent=None,
            replace_token_hash=None,
        )

        principal = await svc.validate(plaintext)

    assert principal is not None
    assert principal.user_id == user.id


# ---------------------------------------------------------------------------
# Absolute timeout
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_absolute_timeout_expired(db_session: AsyncSession) -> None:
    """A session past absolute expiry must return None from validate."""
    from comradarr.core.auth import sessions as sessions_module  # noqa: PLC0415
    from comradarr.core.auth.sessions import SessionService  # noqa: PLC0415
    from comradarr.db.enums import AuthProvider  # noqa: PLC0415

    settings = _make_settings(idle_days=7, absolute_days=30)
    audit = _make_audit()
    svc = SessionService(
        sessionmaker=_make_sessionmaker(db_session),  # pyright: ignore[reportArgumentType]
        settings=settings,  # pyright: ignore[reportArgumentType]
        audit=audit,  # pyright: ignore[reportArgumentType]
    )

    user = await _create_test_user(db_session)
    with patch.object(sessions_module, "_update_last_seen", new=AsyncMock(return_value=None)):
        plaintext, session_row = await svc.mint(
            user_id=user.id,
            auth_provider=AuthProvider.LOCAL,
            oidc_provider_name=None,
            ip=None,
            user_agent=None,
            replace_token_hash=None,
        )

        # Set expires_at to 1 second in the past
        session_row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.flush()

        principal = await svc.validate(plaintext)

    assert principal is None


# ---------------------------------------------------------------------------
# OIDC lazy-match break = expired
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_oidc_lazy_match_break_expired(db_session: AsyncSession) -> None:
    """Session with oidc_provider_name that no longer exists is treated as expired."""
    from comradarr.core.auth import sessions as sessions_module  # noqa: PLC0415
    from comradarr.core.auth.sessions import SessionService  # noqa: PLC0415
    from comradarr.db.enums import AuthProvider  # noqa: PLC0415

    settings = _make_settings()
    audit = _make_audit()
    svc = SessionService(
        sessionmaker=_make_sessionmaker(db_session),  # pyright: ignore[reportArgumentType]
        settings=settings,  # pyright: ignore[reportArgumentType]
        audit=audit,  # pyright: ignore[reportArgumentType]
    )

    user = await _create_test_user(db_session)
    with patch.object(sessions_module, "_update_last_seen", new=AsyncMock(return_value=None)):
        # Use a nonexistent provider name — DB has no such oidc_provider row
        plaintext, _session = await svc.mint(
            user_id=user.id,
            auth_provider=AuthProvider.OIDC,
            oidc_provider_name="nonexistent-provider-xyz",
            ip=None,
            user_agent=None,
            replace_token_hash=None,
        )

        principal = await svc.validate(plaintext)

    # The provider does not exist in oidc_providers table → treated as expired
    assert principal is None


# ---------------------------------------------------------------------------
# Rotation kills old + revokes others
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rotation_kills_old_and_revokes_others(db_session: AsyncSession) -> None:
    """rotate() must delete the current session and revoke all other user sessions."""
    from comradarr.core.auth import sessions as sessions_module  # noqa: PLC0415
    from comradarr.core.auth.sessions import SessionService, _hash_token  # noqa: PLC0415
    from comradarr.db.enums import AuditAction, AuthProvider  # noqa: PLC0415

    settings = _make_settings()
    audit = _make_audit()
    svc = SessionService(
        sessionmaker=_make_sessionmaker(db_session),  # pyright: ignore[reportArgumentType]
        settings=settings,  # pyright: ignore[reportArgumentType]
        audit=audit,  # pyright: ignore[reportArgumentType]
    )

    user = await _create_test_user(db_session)

    with patch.object(sessions_module, "_update_last_seen", new=AsyncMock(return_value=None)):
        # Mint three sessions: current + two others
        current_token, _s1 = await svc.mint(
            user_id=user.id,
            auth_provider=AuthProvider.LOCAL,
            oidc_provider_name=None,
            ip=None,
            user_agent=None,
            replace_token_hash=None,
        )
        other_token1, _s2 = await svc.mint(
            user_id=user.id,
            auth_provider=AuthProvider.LOCAL,
            oidc_provider_name=None,
            ip=None,
            user_agent=None,
            replace_token_hash=None,
        )
        other_token2, _s3 = await svc.mint(
            user_id=user.id,
            auth_provider=AuthProvider.LOCAL,
            oidc_provider_name=None,
            ip=None,
            user_agent=None,
            replace_token_hash=None,
        )

        current_hash = _hash_token(current_token)
        new_token = await svc.rotate(
            current_token_hash=current_hash,
            user_id=user.id,
            auth_provider=AuthProvider.LOCAL,
            oidc_provider_name=None,
            ip=None,
            user_agent=None,
        )

        # Old token must be invalid
        assert await svc.validate(current_token) is None

        # Other tokens must be invalid (revoked)
        assert await svc.validate(other_token1) is None
        assert await svc.validate(other_token2) is None

        # New token must be valid
        assert await svc.validate(new_token) is not None

    # SESSION_REVOKED audit must have been emitted for the two other sessions
    revoke_calls = [
        call
        for call in audit.record.call_args_list
        if call.kwargs.get("action") == AuditAction.SESSION_REVOKED
    ]
    assert len(revoke_calls) == 2


# ---------------------------------------------------------------------------
# Fire-and-forget failure swallow
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_fire_and_forget_swallows_failure(db_session: AsyncSession) -> None:
    """last_seen_at update failure must not propagate to the caller."""
    from comradarr.core.auth import sessions as sessions_module  # noqa: PLC0415
    from comradarr.core.auth.sessions import SessionService  # noqa: PLC0415
    from comradarr.db.enums import AuthProvider  # noqa: PLC0415

    settings = _make_settings()
    audit = _make_audit()
    svc = SessionService(
        sessionmaker=_make_sessionmaker(db_session),  # pyright: ignore[reportArgumentType]
        settings=settings,  # pyright: ignore[reportArgumentType]
        audit=audit,  # pyright: ignore[reportArgumentType]
    )

    user = await _create_test_user(db_session)

    # First mint with suppressed fire-and-forget
    with patch.object(sessions_module, "_update_last_seen", new=AsyncMock(return_value=None)):
        plaintext, _session = await svc.mint(
            user_id=user.id,
            auth_provider=AuthProvider.LOCAL,
            oidc_provider_name=None,
            ip=None,
            user_agent=None,
            replace_token_hash=None,
        )

    # Now validate with a failing fire-and-forget — must not raise
    async def _failing_updater(*args: object, **kwargs: object) -> None:
        raise RuntimeError("DB dead")

    with patch.object(sessions_module, "_update_last_seen", side_effect=_failing_updater):
        principal = await svc.validate(plaintext)

    # Drain pending tasks so the test loop doesn't leak
    await _drain_tasks()

    assert principal is not None
    assert principal.user_id == user.id
