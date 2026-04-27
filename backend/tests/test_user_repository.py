# backend/tests/test_user_repository.py
"""Tests for Slice D — UserRepository writes + oidc_subject migration."""

import uuid
from typing import TYPE_CHECKING, cast

import pytest
import pytest_asyncio
from sqlalchemy.sql import text

from comradarr.core.auth.sentinel import LOCKED_OIDC_HASH, LOCKED_TRUSTED_HEADER_HASH
from comradarr.db.enums import ProvisioningProvider, UserRole
from comradarr.repositories.auth import UserRepository

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def repo(db_session: AsyncSession) -> UserRepository:
    return UserRepository(db_session)


# ---------------------------------------------------------------------------
# Migration: partial unique index exists in pg_indexes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_oidc_subject_partial_index_exists(db_session: AsyncSession) -> None:
    """Acceptance gate: ``ix_users_oidc_subject_where_oidc`` must be a partial
    unique index scoped to OIDC rows (visible in pg_indexes.indexdef)."""
    _q = (
        "SELECT indexdef FROM pg_indexes"
        " WHERE schemaname = current_schema()"
        " AND tablename = 'users'"
        " AND indexname = 'ix_users_oidc_subject_where_oidc'"
    )
    result = await db_session.execute(text(_q))
    row = result.one_or_none()
    assert row is not None, "Partial unique index 'ix_users_oidc_subject_where_oidc' not found"
    indexdef: str = cast("str", row[0])
    assert "WHERE" in indexdef.upper(), f"Index is not partial (no WHERE clause): {indexdef}"
    assert "provisioning_provider" in indexdef, (
        f"Index WHERE clause does not reference provisioning_provider: {indexdef}"
    )


# ---------------------------------------------------------------------------
# create_local
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_local_roundtrip(repo: UserRepository) -> None:
    """create_local inserts a row and returns a User with the supplied fields."""
    user = await repo.create_local(
        email="local@example.com",
        username="localuser",
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fake",  # noqa: S106 — test stub hash, not a real credential
        role=UserRole.VIEWER,
    )
    assert user.id is not None
    assert user.email == "local@example.com"
    assert user.username == "localuser"
    assert user.provisioning_provider is ProvisioningProvider.LOCAL
    assert user.role is UserRole.VIEWER
    assert user.oidc_subject is None


@pytest.mark.asyncio
async def test_create_local_unique_email_enforced(repo: UserRepository) -> None:
    """Duplicate email raises an integrity error."""
    from sqlalchemy.exc import IntegrityError

    _ = await repo.create_local(
        email="dup@example.com",
        username="firstuser",
        password_hash="hash1",  # noqa: S106 — test stub hash, not a real credential
        role=UserRole.VIEWER,
    )
    with pytest.raises(IntegrityError):
        _ = await repo.create_local(
            email="dup@example.com",
            username="seconduser",
            password_hash="hash2",  # noqa: S106 — test stub hash, not a real credential
            role=UserRole.VIEWER,
        )


# ---------------------------------------------------------------------------
# create_provisioned
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_provisioned_trusted_header(repo: UserRepository) -> None:
    """create_provisioned with TRUSTED_HEADER writes the locked sentinel."""
    user = await repo.create_provisioned(
        email="th@example.com",
        username="thuser",
        provisioning_provider=ProvisioningProvider.TRUSTED_HEADER,
        role=UserRole.OPERATOR,
    )
    assert user.provisioning_provider is ProvisioningProvider.TRUSTED_HEADER
    assert user.password_hash == LOCKED_TRUSTED_HEADER_HASH
    assert user.oidc_subject is None


@pytest.mark.asyncio
async def test_create_provisioned_oidc(repo: UserRepository) -> None:
    """create_provisioned with OIDC writes the OIDC locked sentinel."""
    user = await repo.create_provisioned(
        email="oidc@example.com",
        username="oidcuser",
        provisioning_provider=ProvisioningProvider.OIDC,
        role=UserRole.VIEWER,
    )
    assert user.provisioning_provider is ProvisioningProvider.OIDC
    assert user.password_hash == LOCKED_OIDC_HASH


@pytest.mark.asyncio
async def test_create_provisioned_local_raises(repo: UserRepository) -> None:
    """create_provisioned must reject LOCAL provider."""
    with pytest.raises(ValueError, match="create_local"):
        _ = await repo.create_provisioned(
            email="bad@example.com",
            username="baduser",
            provisioning_provider=ProvisioningProvider.LOCAL,
            role=UserRole.VIEWER,
        )


# ---------------------------------------------------------------------------
# update_password
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_password(repo: UserRepository) -> None:
    """update_password replaces the hash on an existing row."""
    user = await repo.create_local(
        email="pwchange@example.com",
        username="pwuser",
        password_hash="old_hash",  # noqa: S106 — test stub hash, not a real credential
        role=UserRole.VIEWER,
    )
    await repo.update_password(user.id, "new_hash")  # noqa: S106 — test stub hash, not a real credential
    refreshed = await repo.get_by_id(user.id)
    assert refreshed is not None
    assert refreshed.password_hash == "new_hash"  # noqa: S105 — test stub hash, not a real credential


# ---------------------------------------------------------------------------
# set_last_login
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_last_login(repo: UserRepository, db_session: AsyncSession) -> None:
    """set_last_login populates last_login_at without raising."""
    user = await repo.create_local(
        email="login@example.com",
        username="loginuser",
        password_hash="hash",  # noqa: S106 — test stub hash, not a real credential
        role=UserRole.VIEWER,
    )
    assert user.last_login_at is None
    await repo.set_last_login(user.id, "127.0.0.1")
    # refresh() re-queries the DB for the updated row (async-safe, no lazy load).
    await db_session.refresh(user)
    assert user.last_login_at is not None


@pytest.mark.asyncio
async def test_set_last_login_bad_id_no_raise(repo: UserRepository) -> None:
    """set_last_login is best-effort: a non-existent user_id must not raise."""
    await repo.set_last_login(uuid.uuid4(), "10.0.0.1")


# ---------------------------------------------------------------------------
# set_oidc_subject
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_oidc_subject(repo: UserRepository, db_session: AsyncSession) -> None:
    """set_oidc_subject writes the OIDC sub claim to the row."""
    user = await repo.create_provisioned(
        email="oidclink@example.com",
        username="oidclinkuser",
        provisioning_provider=ProvisioningProvider.OIDC,
        role=UserRole.VIEWER,
    )
    assert user.oidc_subject is None
    await repo.set_oidc_subject(user.id, "sub|abc123")
    # refresh() re-queries the DB for the updated row (async-safe, no lazy load).
    await db_session.refresh(user)
    assert user.oidc_subject == "sub|abc123"


@pytest.mark.asyncio
async def test_oidc_subject_partial_unique_enforced(
    db_session: AsyncSession,
) -> None:
    """Two OIDC rows with the same oidc_subject violate the partial unique index."""
    from sqlalchemy.exc import IntegrityError

    repo = UserRepository(db_session)
    user1 = await repo.create_provisioned(
        email="oidc1@example.com",
        username="oidcusr1",
        provisioning_provider=ProvisioningProvider.OIDC,
        role=UserRole.VIEWER,
    )
    user2 = await repo.create_provisioned(
        email="oidc2@example.com",
        username="oidcusr2",
        provisioning_provider=ProvisioningProvider.OIDC,
        role=UserRole.VIEWER,
    )
    await repo.set_oidc_subject(user1.id, "sub|shared")
    with pytest.raises(IntegrityError):
        await repo.set_oidc_subject(user2.id, "sub|shared")


@pytest.mark.asyncio
async def test_oidc_subject_null_not_unique_constrained(
    db_session: AsyncSession,
) -> None:
    """Multiple OIDC rows with NULL oidc_subject must NOT trigger the unique index."""
    repo = UserRepository(db_session)
    _ = await repo.create_provisioned(
        email="oidcnull1@example.com",
        username="oidcnull1",
        provisioning_provider=ProvisioningProvider.OIDC,
        role=UserRole.VIEWER,
    )
    _ = await repo.create_provisioned(
        email="oidcnull2@example.com",
        username="oidcnull2",
        provisioning_provider=ProvisioningProvider.OIDC,
        role=UserRole.VIEWER,
    )
    # Both rows have NULL oidc_subject — no IntegrityError expected.
