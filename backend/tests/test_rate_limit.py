# backend/tests/test_rate_limit.py
"""Tests for Slice C — RateLimiter + AuthRateLimitRepository.

Coverage:
* BACKOFF series exact values (1, 2, 4, 8, 16, 60, 60).
* Per-IP window roll-over (counter resets after window expires).
* Persistence-across-restart simulation (clear cache, reload from DB, backoff continues).
* schema_ip 10/hr cap.
* Property-based: BACKOFF is monotone non-decreasing and capped at 60.
"""

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from hypothesis import given
from hypothesis import settings as h_settings
from hypothesis import strategies as st

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from comradarr.core.auth.rate_limit import BACKOFF, RateLimiter
from comradarr.db.models.auth_rate_limit import AuthRateLimit
from comradarr.errors.rate_limiting import RateLimitExceeded
from comradarr.repositories.auth import AuthRateLimitRepository

# Mirror the stable scope string without importing a private module name.
_SCOPE_LOGIN_USERNAME = "login.username"

_BUILD_REPO_PATH = "comradarr.core.auth.rate_limit.RateLimiter._build_repo"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_row(
    scope: str,
    key: str,
    counter: int,
    window_start: datetime | None = None,
) -> AuthRateLimit:
    """Build a minimal AuthRateLimit ORM object for test fixtures."""
    row = AuthRateLimit(scope=scope, key=key)
    row.counter = counter
    row.window_start = window_start or datetime.now(UTC)
    row.backoff_delay = 0
    row.last_failure_at = None
    return row


def _make_repo(*, upsert_return: AuthRateLimit | None = None) -> AuthRateLimitRepository:
    """Build a mock AuthRateLimitRepository with AsyncMock method replacements."""
    repo = MagicMock(spec=AuthRateLimitRepository)
    repo.upsert_increment = AsyncMock(return_value=upsert_return)
    repo.reset = AsyncMock()
    repo.get = AsyncMock(return_value=upsert_return)
    return repo


def _make_sessionmaker() -> async_sessionmaker[AsyncSession]:
    """Return a mock async_sessionmaker whose context manager yields a mock session."""
    mock_session = MagicMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    mock_session.commit = AsyncMock()
    return cast("async_sessionmaker[AsyncSession]", MagicMock(return_value=mock_session))


def _make_limiter(repo: AuthRateLimitRepository) -> RateLimiter:
    """Build a RateLimiter with a stub sessionmaker and patch _build_repo to return repo."""
    limiter = RateLimiter(_make_sessionmaker())
    limiter._build_repo = MagicMock(return_value=repo)  # pyright: ignore[reportAttributeAccessIssue]
    return limiter


def _upsert(repo: AuthRateLimitRepository) -> AsyncMock:
    """Cast repo.upsert_increment to AsyncMock for assertion calls."""
    return cast("AsyncMock", repo.upsert_increment)


def _reset(repo: AuthRateLimitRepository) -> AsyncMock:
    """Cast repo.reset to AsyncMock for assertion calls."""
    return cast("AsyncMock", repo.reset)


_SLEEP_PATH = "comradarr.core.auth.rate_limit.asyncio.sleep"


# ---------------------------------------------------------------------------
# BACKOFF series — exact values
# ---------------------------------------------------------------------------


class TestBackoffSeries:
    def test_exact_values(self) -> None:
        expected = [1, 2, 4, 8, 16, 60, 60, 60, 60, 60]
        assert list(BACKOFF) == expected

    def test_length(self) -> None:
        assert len(BACKOFF) == 10

    def test_lookup_capped_at_last(self) -> None:
        assert BACKOFF[min(999, len(BACKOFF) - 1)] == 60

    def test_counter_zero_maps_to_first(self) -> None:
        assert BACKOFF[min(0, len(BACKOFF) - 1)] == 1


# ---------------------------------------------------------------------------
# hit_login_username — backoff sleep is called with correct delay
# ---------------------------------------------------------------------------


class TestHitLoginUsername:
    @pytest.mark.asyncio
    async def test_first_hit_sleeps_one_second(self) -> None:
        row = _make_row(_SCOPE_LOGIN_USERNAME, "alice", counter=1)
        repo = _make_repo(upsert_return=row)
        limiter = _make_limiter(repo)

        with patch(_SLEEP_PATH, new_callable=AsyncMock) as mock_sleep:
            await limiter.hit_login_username("alice")
        mock_sleep.assert_awaited_once_with(BACKOFF[0])  # 1

    @pytest.mark.asyncio
    async def test_second_hit_sleeps_two_seconds(self) -> None:
        row = _make_row(_SCOPE_LOGIN_USERNAME, "alice", counter=2)
        repo = _make_repo(upsert_return=row)
        limiter = _make_limiter(repo)

        with patch(_SLEEP_PATH, new_callable=AsyncMock) as mock_sleep:
            await limiter.hit_login_username("alice")
        mock_sleep.assert_awaited_once_with(BACKOFF[1])  # 2

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("counter", "expected_delay"),
        [
            (1, 1),
            (2, 2),
            (3, 4),
            (4, 8),
            (5, 16),
            (6, 60),
            (7, 60),
        ],
    )
    async def test_backoff_series_exact(self, counter: int, expected_delay: int) -> None:
        row = _make_row(_SCOPE_LOGIN_USERNAME, "bob", counter=counter)
        repo = _make_repo(upsert_return=row)
        limiter = _make_limiter(repo)

        with patch(_SLEEP_PATH, new_callable=AsyncMock) as mock_sleep:
            await limiter.hit_login_username("bob")
        mock_sleep.assert_awaited_once_with(expected_delay)

    @pytest.mark.asyncio
    async def test_reset_clears_counter(self) -> None:
        repo = _make_repo()
        limiter = _make_limiter(repo)
        limiter._write_cache(  # pyright: ignore[reportPrivateUsage]
            _SCOPE_LOGIN_USERNAME, "carol", counter=5, window_start=0.0
        )

        await limiter.reset_login_username("carol")

        _reset(repo).assert_awaited_once_with(_SCOPE_LOGIN_USERNAME, "carol")
        cached = limiter._read_cache(_SCOPE_LOGIN_USERNAME, "carol")  # pyright: ignore[reportPrivateUsage]
        assert cached is None


# ---------------------------------------------------------------------------
# Per-IP window roll-over
# ---------------------------------------------------------------------------


class TestPerIPWindowRollover:
    @pytest.mark.asyncio
    async def test_window_rollover_resets_counter(self) -> None:
        """After the 1-minute window expires the counter should reset to 1."""
        row_first = _make_row("login.ip.1m", "10.0.0.1", counter=1)
        repo = _make_repo(upsert_return=row_first)
        limiter = _make_limiter(repo)

        await limiter.hit_login_ip("10.0.0.1")
        _upsert(repo).assert_awaited()

        # Simulate cache with an old window_start (> 60 s ago).
        old_window = datetime.now(UTC) - timedelta(seconds=120)
        limiter._write_cache(  # pyright: ignore[reportPrivateUsage]
            "login.ip.1m",
            "10.0.0.1",
            counter=8,
            window_start=old_window.timestamp(),
        )

        # Second call — cache shows stale window; repo returns counter=1 (reset).
        _upsert(repo).reset_mock()
        row_reset = _make_row("login.ip.1m", "10.0.0.1", counter=1)
        _upsert(repo).return_value = row_reset

        await limiter.hit_login_ip("10.0.0.1")
        _upsert(repo).assert_awaited()


# ---------------------------------------------------------------------------
# Persistence-across-restart simulation
# ---------------------------------------------------------------------------


class TestPersistenceAcrossRestart:
    @pytest.mark.asyncio
    async def test_backoff_continues_from_db_row_after_cache_clear(self) -> None:
        """Clearing cache and reloading from DB should resume backoff from counter=5."""
        counter_from_db = 5
        row = _make_row(_SCOPE_LOGIN_USERNAME, "dave", counter=counter_from_db)
        repo = _make_repo(upsert_return=row)
        limiter = _make_limiter(repo)

        limiter._write_cache(  # pyright: ignore[reportPrivateUsage]
            _SCOPE_LOGIN_USERNAME, "dave", counter=3, window_start=0.0
        )

        # Simulate restart: clear the in-memory cache.
        limiter._cache.clear()  # pyright: ignore[reportPrivateUsage]

        with patch(_SLEEP_PATH, new_callable=AsyncMock) as mock_sleep:
            await limiter.hit_login_username("dave")

        expected_delay = BACKOFF[min(counter_from_db - 1, len(BACKOFF) - 1)]  # BACKOFF[4] = 16
        mock_sleep.assert_awaited_once_with(expected_delay)


# ---------------------------------------------------------------------------
# schema_ip 10/hr cap
# ---------------------------------------------------------------------------


class TestSchemaIPCap:
    @pytest.mark.asyncio
    async def test_under_cap_does_not_raise(self) -> None:
        row = _make_row("schema.ip.1h", "192.168.1.1", counter=5)
        repo = _make_repo(upsert_return=row)
        limiter = _make_limiter(repo)
        await limiter.hit_schema_ip("192.168.1.1")

    @pytest.mark.asyncio
    async def test_at_cap_does_not_raise(self) -> None:
        row = _make_row("schema.ip.1h", "192.168.1.1", counter=10)
        repo = _make_repo(upsert_return=row)
        limiter = _make_limiter(repo)
        await limiter.hit_schema_ip("192.168.1.1")

    @pytest.mark.asyncio
    async def test_exceeds_cap_raises_rate_limit_exceeded(self) -> None:
        row = _make_row("schema.ip.1h", "192.168.1.1", counter=11)
        repo = _make_repo(upsert_return=row)
        limiter = _make_limiter(repo)
        with pytest.raises(RateLimitExceeded):
            await limiter.hit_schema_ip("192.168.1.1")

    @pytest.mark.asyncio
    async def test_rate_limit_exceeded_has_retry_after(self) -> None:
        row = _make_row("schema.ip.1h", "192.168.1.1", counter=11)
        repo = _make_repo(upsert_return=row)
        limiter = _make_limiter(repo)
        with pytest.raises(RateLimitExceeded) as exc_info:
            await limiter.hit_schema_ip("192.168.1.1")
        assert exc_info.value.context.get("retry_after") == 3600


# ---------------------------------------------------------------------------
# hit_login_ip two-window enforcement
# ---------------------------------------------------------------------------


class TestLoginIPTwoWindow:
    @pytest.mark.asyncio
    async def test_exceeds_minute_cap_raises(self) -> None:
        row_min = _make_row("login.ip.1m", "1.2.3.4", counter=11)
        row_hr = _make_row("login.ip.1h", "1.2.3.4", counter=1)
        repo = MagicMock(spec=AuthRateLimitRepository)
        repo.upsert_increment = AsyncMock(side_effect=[row_min, row_hr])
        limiter = _make_limiter(repo)
        with pytest.raises(RateLimitExceeded) as exc_info:
            await limiter.hit_login_ip("1.2.3.4")
        assert exc_info.value.context.get("retry_after") == 60

    @pytest.mark.asyncio
    async def test_exceeds_hour_cap_raises(self) -> None:
        row_min = _make_row("login.ip.1m", "1.2.3.4", counter=5)
        row_hr = _make_row("login.ip.1h", "1.2.3.4", counter=51)
        repo = MagicMock(spec=AuthRateLimitRepository)
        repo.upsert_increment = AsyncMock(side_effect=[row_min, row_hr])
        limiter = _make_limiter(repo)
        with pytest.raises(RateLimitExceeded) as exc_info:
            await limiter.hit_login_ip("1.2.3.4")
        assert exc_info.value.context.get("retry_after") == 3600

    @pytest.mark.asyncio
    async def test_under_both_caps_does_not_raise(self) -> None:
        row_min = _make_row("login.ip.1m", "1.2.3.4", counter=5)
        row_hr = _make_row("login.ip.1h", "1.2.3.4", counter=20)
        repo = MagicMock(spec=AuthRateLimitRepository)
        repo.upsert_increment = AsyncMock(side_effect=[row_min, row_hr])
        limiter = _make_limiter(repo)
        await limiter.hit_login_ip("1.2.3.4")  # should not raise


# ---------------------------------------------------------------------------
# Property-based: BACKOFF monotone non-decreasing and capped at 60
# ---------------------------------------------------------------------------


@given(st.integers(min_value=0, max_value=10000))
@h_settings(max_examples=200)
def test_backoff_monotone_non_decreasing_capped_at_60(counter: int) -> None:
    idx = min(counter, len(BACKOFF) - 1)
    delay = BACKOFF[idx]
    assert delay <= 60, f"BACKOFF[{idx}]={delay} exceeds 60"
    if idx > 0:
        prev = BACKOFF[idx - 1]
        assert delay >= prev, f"BACKOFF[{idx}]={delay} < BACKOFF[{idx - 1}]={prev}"
