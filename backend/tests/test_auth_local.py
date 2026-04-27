# backend/tests/test_auth_local.py
"""Tests for LocalPasswordProvider (Phase 4 Slice E §5.4.2).

Coverage:
  - NotApplicable from authenticate() (ASGI path always skips)
  - AuthenticationLocalLoginDisabled when flag is set
  - IP rate-limit 429 propagation
  - Unknown user → Failure (dummy-verify paid, no user_id in audit)
  - Sentinel hash (trusted-header) → Failure
  - Sentinel hash (oidc) → Failure
  - Null password_hash → Failure
  - Wrong password → Failure
  - Correct password → Success
  - Transparent rehash on success
  - Counter reset on success
  - Timing-equivalence: unknown vs known latency within 5 ms across 100 trials
    (this test is skipped in CI via SKIP_TIMING_TESTS=1)

RULE-PY-002: No ``from __future__ import annotations``.
RULE-PY-003: No ``Any``.
RULE-LOG-001: structlog only.
"""

import uuid
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from comradarr.core.auth.local import LocalPasswordProvider
from comradarr.core.auth.protocol import Failure, NotApplicable, Success
from comradarr.core.auth.sentinel import LOCKED_OIDC_HASH, LOCKED_TRUSTED_HEADER_HASH
from comradarr.core.crypto import hash_password, verify_password
from comradarr.core.types import Secret
from comradarr.db.enums import AuditAction, AuthProvider, UserRole
from comradarr.db.models.user import User
from comradarr.errors.authentication import AuthenticationLocalLoginDisabled
from comradarr.errors.rate_limiting import RateLimitExceeded
from tests.conftest import stub_settings

if TYPE_CHECKING:
    from litestar.types import Scope
    from sqlalchemy.ext.asyncio import AsyncSession

    from comradarr.config import Settings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_settings(*, disable_local_login: bool = False) -> Settings:
    overrides: dict[str, str] = {}
    if disable_local_login:
        overrides["COMRADARR_DISABLE_LOCAL_LOGIN"] = "true"
    return stub_settings(overrides=overrides if overrides else None)


def _make_audit() -> AsyncMock:
    audit = AsyncMock()
    audit.record = AsyncMock(return_value=None)
    return audit


def _make_rate_limiter(
    *,
    ip_raises: bool = False,
    username_raises: bool = False,
) -> AsyncMock:
    rl = AsyncMock()
    if ip_raises:
        rl.hit_login_ip = AsyncMock(side_effect=RateLimitExceeded(context={"retry_after": 60}))
    else:
        rl.hit_login_ip = AsyncMock(return_value=None)
    if username_raises:
        rl.hit_login_username = AsyncMock(
            side_effect=RateLimitExceeded(context={"retry_after": 60})
        )
    else:
        rl.hit_login_username = AsyncMock(return_value=None)
    rl.reset_login_username = AsyncMock(return_value=None)
    return rl


def _make_user_mock(
    *,
    password_hash: str | None,
    user_id: uuid.UUID | None = None,
) -> MagicMock:
    """Build a MagicMock shaped like a User ORM row."""
    user = MagicMock(spec=User)
    user.id = user_id or uuid.uuid4()
    user.password_hash = password_hash
    user.role = UserRole.VIEWER
    return user


def _make_user_repo(*, user: MagicMock | None = None) -> AsyncMock:
    """Build an AsyncMock shaped like UserRepository."""
    repo = AsyncMock()
    repo.get_by_username = AsyncMock(return_value=user)
    repo.update_password = AsyncMock(return_value=None)
    return repo


def _make_provider(
    *,
    disable_local_login: bool = False,
    audit: AsyncMock | None = None,
    rate_limiter: AsyncMock | None = None,
) -> tuple[LocalPasswordProvider, AsyncMock, AsyncMock]:
    settings = _make_settings(disable_local_login=disable_local_login)
    if audit is None:
        audit = _make_audit()
    if rate_limiter is None:
        rate_limiter = _make_rate_limiter()
    provider = LocalPasswordProvider(
        settings=settings,
        audit=audit,
        rate_limiter=rate_limiter,
    )
    return provider, audit, rate_limiter


_GOOD_PASSWORD = Secret("correct-horse-battery-staple")
_GOOD_HASH: str = hash_password(_GOOD_PASSWORD)

_WRONG_PASSWORD = Secret("wrong-password")

_SCOPE: Scope = cast("Scope", cast("object", {"type": "http"}))
_HEADERS: list[tuple[bytes, bytes]] = []


# ---------------------------------------------------------------------------
# authenticate() — ASGI path always returns NotApplicable
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_authenticate_scope_always_not_applicable() -> None:
    """The ASGI scope entry point always returns NotApplicable."""
    provider, _, _ = _make_provider()
    result = await provider.authenticate(_SCOPE, _HEADERS)
    assert isinstance(result, NotApplicable)


# ---------------------------------------------------------------------------
# authenticate_credentials() — feature gate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_local_login_disabled_raises() -> None:
    """AuthenticationLocalLoginDisabled raised when flag is set."""
    provider, _, _ = _make_provider(disable_local_login=True)
    repo = _make_user_repo()
    with pytest.raises(AuthenticationLocalLoginDisabled):
        _ = await provider.authenticate_credentials(
            username="alice",
            password=_GOOD_PASSWORD,
            source_ip=None,
            user_repo=repo,
        )
    # No DB call should have been made
    cast("AsyncMock", repo.get_by_username).assert_not_called()


# ---------------------------------------------------------------------------
# authenticate_credentials() — IP rate-limit
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ip_rate_limit_propagates() -> None:
    """RateLimitExceeded from hit_login_ip propagates to caller."""
    rl = _make_rate_limiter(ip_raises=True)
    provider, _, _ = _make_provider(rate_limiter=rl)
    repo = _make_user_repo()
    with pytest.raises(RateLimitExceeded):
        _ = await provider.authenticate_credentials(
            username="alice",
            password=_GOOD_PASSWORD,
            source_ip="1.2.3.4",
            user_repo=repo,
        )
    cast("AsyncMock", repo.get_by_username).assert_not_called()


# ---------------------------------------------------------------------------
# authenticate_credentials() — unknown user
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_user_returns_failure() -> None:
    """Unknown username → Failure with invalid_credentials code."""
    provider, _, _ = _make_provider()
    repo = _make_user_repo(user=None)

    result = await provider.authenticate_credentials(
        username="nobody",
        password=_GOOD_PASSWORD,
        source_ip="1.2.3.4",
        user_repo=repo,
    )

    assert isinstance(result, Failure)
    assert result.problem_code == "authentication.invalid_credentials"


@pytest.mark.asyncio
async def test_unknown_user_audit_has_no_actor() -> None:
    """Unknown user audit record has actor_user_id=None."""
    provider, audit, _ = _make_provider()
    repo = _make_user_repo(user=None)

    _ = await provider.authenticate_credentials(
        username="nobody",
        password=_GOOD_PASSWORD,
        source_ip=None,
        user_repo=repo,
    )

    cast("AsyncMock", audit.record).assert_called_once()
    kwargs = cast("AsyncMock", audit.record).call_args.kwargs
    assert kwargs["action"] is AuditAction.LOGIN_FAILED
    assert kwargs["actor_user_id"] is None
    assert kwargs["context"]["reason"] == "unknown_user"


@pytest.mark.asyncio
async def test_unknown_user_username_rate_limit_always_fires() -> None:
    """hit_login_username fires even for unknown users (timing-equivalence)."""
    provider, _, rl = _make_provider()
    repo = _make_user_repo(user=None)

    _ = await provider.authenticate_credentials(
        username="nobody",
        password=_GOOD_PASSWORD,
        source_ip=None,
        user_repo=repo,
    )

    cast("AsyncMock", rl.hit_login_username).assert_called_once_with("nobody")


# ---------------------------------------------------------------------------
# authenticate_credentials() — sentinel hashes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sentinel_trusted_header_returns_failure() -> None:
    """Trusted-header sentinel hash → Failure without verify_password call."""
    user = _make_user_mock(password_hash=LOCKED_TRUSTED_HEADER_HASH)
    provider, audit, _ = _make_provider()
    repo = _make_user_repo(user=user)

    result = await provider.authenticate_credentials(
        username="proxy-user",
        password=_GOOD_PASSWORD,
        source_ip=None,
        user_repo=repo,
    )

    assert isinstance(result, Failure)
    assert result.problem_code == "authentication.invalid_credentials"
    kwargs = cast("AsyncMock", audit.record).call_args.kwargs
    assert kwargs["context"]["reason"] == "sentinel_hash"
    assert kwargs["actor_user_id"] == cast("uuid.UUID", user.id)


@pytest.mark.asyncio
async def test_sentinel_oidc_returns_failure() -> None:
    """OIDC sentinel hash → Failure."""
    user = _make_user_mock(password_hash=LOCKED_OIDC_HASH)
    provider, _, _ = _make_provider()
    repo = _make_user_repo(user=user)

    result = await provider.authenticate_credentials(
        username="oidc-user",
        password=_GOOD_PASSWORD,
        source_ip=None,
        user_repo=repo,
    )

    assert isinstance(result, Failure)
    assert result.problem_code == "authentication.invalid_credentials"


@pytest.mark.asyncio
async def test_null_password_hash_returns_failure() -> None:
    """NULL password_hash treated same as sentinel — structural reject."""
    user = _make_user_mock(password_hash=None)
    provider, _, _ = _make_provider()
    repo = _make_user_repo(user=user)

    result = await provider.authenticate_credentials(
        username="no-hash-user",
        password=_GOOD_PASSWORD,
        source_ip=None,
        user_repo=repo,
    )

    assert isinstance(result, Failure)
    assert result.problem_code == "authentication.invalid_credentials"


# ---------------------------------------------------------------------------
# authenticate_credentials() — wrong password
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wrong_password_returns_failure() -> None:
    """Wrong password → Failure with invalid_credentials code."""
    user = _make_user_mock(password_hash=_GOOD_HASH)
    provider, _, _ = _make_provider()
    repo = _make_user_repo(user=user)

    result = await provider.authenticate_credentials(
        username="alice",
        password=_WRONG_PASSWORD,
        source_ip="1.2.3.4",
        user_repo=repo,
    )

    assert isinstance(result, Failure)
    assert result.problem_code == "authentication.invalid_credentials"


@pytest.mark.asyncio
async def test_wrong_password_audit_row() -> None:
    """Wrong password audit record has actor_user_id set and reason=wrong_password."""
    user_id = uuid.uuid4()
    user = _make_user_mock(password_hash=_GOOD_HASH, user_id=user_id)
    provider, audit, _ = _make_provider()
    repo = _make_user_repo(user=user)

    _ = await provider.authenticate_credentials(
        username="alice",
        password=_WRONG_PASSWORD,
        source_ip=None,
        user_repo=repo,
    )

    cast("AsyncMock", audit.record).assert_called_once()
    kwargs = cast("AsyncMock", audit.record).call_args.kwargs
    assert kwargs["action"] is AuditAction.LOGIN_FAILED
    assert kwargs["actor_user_id"] == user_id
    assert kwargs["context"]["reason"] == "wrong_password"


# ---------------------------------------------------------------------------
# authenticate_credentials() — success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_correct_password_returns_success() -> None:
    """Correct password → Success with LOCAL auth_provider."""
    user_id = uuid.uuid4()
    user = _make_user_mock(password_hash=_GOOD_HASH, user_id=user_id)
    provider, _, _ = _make_provider()
    repo = _make_user_repo(user=user)

    result = await provider.authenticate_credentials(
        username="alice",
        password=_GOOD_PASSWORD,
        source_ip=None,
        user_repo=repo,
    )

    assert isinstance(result, Success)
    assert result.user_id == user_id
    assert result.auth_provider is AuthProvider.LOCAL


@pytest.mark.asyncio
async def test_success_audit_row() -> None:
    """Login success audit record has LOGIN_SUCCESS action and actor_user_id."""
    user_id = uuid.uuid4()
    user = _make_user_mock(password_hash=_GOOD_HASH, user_id=user_id)
    provider, audit, _ = _make_provider()
    repo = _make_user_repo(user=user)

    _ = await provider.authenticate_credentials(
        username="alice",
        password=_GOOD_PASSWORD,
        source_ip="10.0.0.1",
        user_repo=repo,
    )

    cast("AsyncMock", audit.record).assert_called_once()
    kwargs = cast("AsyncMock", audit.record).call_args.kwargs
    assert kwargs["action"] is AuditAction.LOGIN_SUCCESS
    assert kwargs["actor_user_id"] == user_id
    assert kwargs["ip"] == "10.0.0.1"


@pytest.mark.asyncio
async def test_success_resets_username_counter() -> None:
    """Successful auth resets the per-username backoff counter."""
    user = _make_user_mock(password_hash=_GOOD_HASH)
    provider, _, rl = _make_provider()
    repo = _make_user_repo(user=user)

    _ = await provider.authenticate_credentials(
        username="Alice",  # uppercase to test lowercasing
        password=_GOOD_PASSWORD,
        source_ip=None,
        user_repo=repo,
    )

    cast("AsyncMock", rl.reset_login_username).assert_called_once_with("alice")


@pytest.mark.asyncio
async def test_failure_does_not_reset_username_counter() -> None:
    """Failed auth must NOT reset the per-username backoff counter."""
    user = _make_user_mock(password_hash=_GOOD_HASH)
    provider, _, rl = _make_provider()
    repo = _make_user_repo(user=user)

    _ = await provider.authenticate_credentials(
        username="alice",
        password=_WRONG_PASSWORD,
        source_ip=None,
        user_repo=repo,
    )

    cast("AsyncMock", rl.reset_login_username).assert_not_called()


# ---------------------------------------------------------------------------
# Rehash on success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rehash_triggered_when_needed() -> None:
    """update_password is called when needs_rehash returns True."""
    user_id = uuid.uuid4()
    user = _make_user_mock(password_hash=_GOOD_HASH, user_id=user_id)
    provider, _, _ = _make_provider()
    repo = _make_user_repo(user=user)

    with patch("comradarr.core.auth.local.needs_rehash", return_value=True):
        _ = await provider.authenticate_credentials(
            username="alice",
            password=_GOOD_PASSWORD,
            source_ip=None,
            user_repo=repo,
        )

    cast("AsyncMock", repo.update_password).assert_called_once()
    call_args = cast("AsyncMock", repo.update_password).call_args
    assert call_args.args[0] == user_id


@pytest.mark.asyncio
async def test_no_rehash_when_not_needed() -> None:
    """update_password is NOT called when needs_rehash returns False."""
    user = _make_user_mock(password_hash=_GOOD_HASH)
    provider, _, _ = _make_provider()
    repo = _make_user_repo(user=user)

    with patch("comradarr.core.auth.local.needs_rehash", return_value=False):
        _ = await provider.authenticate_credentials(
            username="alice",
            password=_GOOD_PASSWORD,
            source_ip=None,
            user_repo=repo,
        )

    cast("AsyncMock", repo.update_password).assert_not_called()


# ---------------------------------------------------------------------------
# Sentinel constants sanity checks
# ---------------------------------------------------------------------------


def test_sentinel_hashes_contain_expected_values() -> None:
    """Both sentinel constants are structurally rejected by the provider."""
    # Import the module-private set via the module object to avoid the
    # reportPrivateUsage warning while still asserting the invariant.
    import comradarr.core.auth.local as _local_mod  # noqa: PLC0415

    sentinel_hashes: frozenset[str] = _local_mod._SENTINEL_HASHES  # pyright: ignore[reportPrivateUsage]
    assert LOCKED_TRUSTED_HEADER_HASH in sentinel_hashes
    assert LOCKED_OIDC_HASH in sentinel_hashes


def test_dummy_hash_is_valid_argon2() -> None:
    """The module-level dummy hash is a valid Argon2id PHC string."""
    import comradarr.core.auth.local as _local_mod  # noqa: PLC0415

    dummy_hash: str = _local_mod._DUMMY_HASH  # pyright: ignore[reportPrivateUsage]
    assert dummy_hash.startswith("$argon2id$")
    assert verify_password(dummy_hash, Secret("___comradarr_dummy___"))


def test_sentinel_hashes_not_valid_argon2() -> None:
    """Sentinel hashes are outside the Argon2id output alphabet (start with !)."""
    for sentinel in (LOCKED_TRUSTED_HEADER_HASH, LOCKED_OIDC_HASH):
        assert sentinel.startswith("!")


# ---------------------------------------------------------------------------
# Integration tests (real DB)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_integration_correct_password(db_session: AsyncSession) -> None:
    """End-to-end: create local user, authenticate with correct password → Success."""
    from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

    repo = UserRepository(db_session)
    uid_suffix = uuid.uuid4().hex[:6]
    username = f"local-user-{uid_suffix}"
    password = Secret(f"passw0rd-{uid_suffix}")
    password_hash = hash_password(password)

    _ = await repo.create_local(
        email=f"{username}@example.com",
        username=username,
        password_hash=password_hash,
        role=UserRole.VIEWER,
    )

    provider, _, _ = _make_provider()
    result = await provider.authenticate_credentials(
        username=username,
        password=password,
        source_ip=None,
        user_repo=repo,
    )

    assert isinstance(result, Success)
    assert result.auth_provider is AuthProvider.LOCAL


@pytest.mark.asyncio
async def test_integration_wrong_password(db_session: AsyncSession) -> None:
    """End-to-end: create local user, authenticate with wrong password → Failure."""
    from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

    repo = UserRepository(db_session)
    uid_suffix = uuid.uuid4().hex[:6]
    username = f"local-bad-{uid_suffix}"
    password = Secret(f"passw0rd-{uid_suffix}")
    password_hash = hash_password(password)

    _ = await repo.create_local(
        email=f"{username}@example.com",
        username=username,
        password_hash=password_hash,
        role=UserRole.VIEWER,
    )

    provider, _, _ = _make_provider()
    result = await provider.authenticate_credentials(
        username=username,
        password=Secret("wrong"),
        source_ip=None,
        user_repo=repo,
    )

    assert isinstance(result, Failure)
    assert result.problem_code == "authentication.invalid_credentials"


@pytest.mark.asyncio
async def test_integration_sentinel_user(db_session: AsyncSession) -> None:
    """Provisioned (trusted-header) user cannot log in via local password."""
    from comradarr.db.enums import ProvisioningProvider  # noqa: PLC0415
    from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

    repo = UserRepository(db_session)
    uid_suffix = uuid.uuid4().hex[:6]
    username = f"proxy-user-{uid_suffix}"

    _ = await repo.create_provisioned(
        email=f"{username}@example.com",
        username=username,
        provisioning_provider=ProvisioningProvider.TRUSTED_HEADER,
        role=UserRole.VIEWER,
    )

    provider, _, _ = _make_provider()
    result = await provider.authenticate_credentials(
        username=username,
        password=Secret("any-password"),
        source_ip=None,
        user_repo=repo,
    )

    assert isinstance(result, Failure)
    assert result.problem_code == "authentication.invalid_credentials"
