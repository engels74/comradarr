# backend/src/comradarr/core/auth/rate_limit.py
"""RateLimiter — per-scope per-key counters backed by ``auth_rate_limits``.

Design contract (PRD §15):

* Every ``hit_*`` call upserts the ``auth_rate_limits`` row via
  :meth:`AuthRateLimitRepository.upsert_increment` (write-through).
* An in-memory hot cache (``dict[tuple[str,str], _CachedCounter]``) absorbs
  read pressure; TTL = ``max(60, window_seconds)``.
* ``hit_login_username`` sleeps the BACKOFF delay *before* the caller
  performs the user lookup so the timing is indistinguishable between a
  known and unknown username (timing-equivalence invariant for Slice E).
* ``hit_login_ip`` enforces two windows (1 min / 1 hr); raises
  :class:`RateLimitExceeded` on cap so middleware can emit 429 + Retry-After.
* Cache TTL is capped at 60 s so a direct DB reset (admin action) becomes
  visible within one TTL cycle.
"""

import asyncio
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Final

import structlog

from comradarr.errors.rate_limiting import RateLimitExceeded

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from comradarr.repositories.auth import AuthRateLimitRepository

_logger = structlog.stdlib.get_logger(__name__)

# Backoff table (seconds). Lookup: BACKOFF[min(counter, len(BACKOFF) - 1)].
BACKOFF: Final[tuple[int, ...]] = (1, 2, 4, 8, 16, 60, 60, 60, 60, 60)

# Scope identifiers (stable strings — used as DB PK component).
_SCOPE_LOGIN_USERNAME: Final = "login.username"
_SCOPE_LOGIN_IP_MIN: Final = "login.ip.1m"
_SCOPE_LOGIN_IP_HOUR: Final = "login.ip.1h"
_SCOPE_SCHEMA_IP: Final = "schema.ip.1h"
_SCOPE_BOOTSTRAP_IP: Final = "bootstrap.ip.1h"  # Phase 5 consumer
_SCOPE_API_KEY_IP: Final = "api_key.ip.1h"

# Window lengths (seconds) per scope.
_WINDOW: Final[dict[str, int]] = {
    _SCOPE_LOGIN_USERNAME: 3600,
    _SCOPE_LOGIN_IP_MIN: 60,
    _SCOPE_LOGIN_IP_HOUR: 3600,
    _SCOPE_SCHEMA_IP: 3600,
    _SCOPE_BOOTSTRAP_IP: 3600,
    _SCOPE_API_KEY_IP: 3600,
}

# Per-scope hit caps (None = no hard cap, backoff-only).
_CAP: Final[dict[str, int | None]] = {
    _SCOPE_LOGIN_USERNAME: None,
    _SCOPE_LOGIN_IP_MIN: 10,
    _SCOPE_LOGIN_IP_HOUR: 50,
    _SCOPE_SCHEMA_IP: 10,
    _SCOPE_BOOTSTRAP_IP: 10,
    _SCOPE_API_KEY_IP: 10,
}

_CACHE_MAX_TTL: Final = 60  # seconds


@dataclass
class _CachedCounter:
    counter: int
    window_start: float  # monotonic epoch seconds
    expires_at: float  # monotonic epoch seconds


class RateLimiter:
    """Stateful rate-limiter backed by ``auth_rate_limits`` with an in-memory cache."""

    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession]) -> None:
        self._sessionmaker = sessionmaker
        self._cache: dict[tuple[str, str], _CachedCounter] = {}

    def _build_repo(self, db_session: AsyncSession) -> AuthRateLimitRepository:
        from comradarr.repositories.auth import AuthRateLimitRepository  # noqa: PLC0415

        return AuthRateLimitRepository(db_session)

    # ------------------------------------------------------------------
    # Public hit methods
    # ------------------------------------------------------------------

    async def hit_login_username(self, username_lowercased: str) -> None:
        """Increment the per-username login counter and sleep the backoff delay.

        Must be called only on FAILED authentication attempts (after the
        outcome is determined), not before lookup. The first legitimate login
        for a username pays no backoff; subsequent failures accumulate delay.
        Timing-equivalence between known and unknown usernames is preserved by
        the caller's dummy-verify step, not by pre-lookup sleep.
        """
        counter = await self._increment(_SCOPE_LOGIN_USERNAME, username_lowercased)
        delay = BACKOFF[min(counter - 1, len(BACKOFF) - 1)]
        await asyncio.sleep(delay)

    async def reset_login_username(self, username_lowercased: str) -> None:
        """Clear the per-username counter on a successful authentication."""
        await self._reset(_SCOPE_LOGIN_USERNAME, username_lowercased)

    async def hit_login_ip(self, ip: str) -> None:
        """Enforce the two-window (1 min / 1 hr) login-IP rate limit.

        Raises :class:`RateLimitExceeded` with ``retry_after`` context when
        either window cap is exceeded.
        """
        now = datetime.now(UTC)

        # 1-minute window — cap 10
        counter_min = await self._increment_windowed(_SCOPE_LOGIN_IP_MIN, ip, 60, now)
        cap_min = _CAP[_SCOPE_LOGIN_IP_MIN]
        if cap_min is not None and counter_min > cap_min:
            _logger.warning(
                "auth.rate_limit.tripped",
                scope=_SCOPE_LOGIN_IP_MIN,
                key=ip,
                counter=counter_min,
                cap=cap_min,
            )
            raise RateLimitExceeded(context={"retry_after": 60})

        # 1-hour window — cap 50
        counter_hr = await self._increment_windowed(_SCOPE_LOGIN_IP_HOUR, ip, 3600, now)
        cap_hr = _CAP[_SCOPE_LOGIN_IP_HOUR]
        if cap_hr is not None and counter_hr > cap_hr:
            _logger.warning(
                "auth.rate_limit.tripped",
                scope=_SCOPE_LOGIN_IP_HOUR,
                key=ip,
                counter=counter_hr,
                cap=cap_hr,
            )
            raise RateLimitExceeded(context={"retry_after": 3600})

    async def hit_schema_ip(self, ip: str) -> None:
        """Enforce 10/hr cap on schema-endpoint access per IP."""
        now = datetime.now(UTC)
        counter = await self._increment_windowed(_SCOPE_SCHEMA_IP, ip, 3600, now)
        cap = _CAP[_SCOPE_SCHEMA_IP]
        if cap is not None and counter > cap:
            _logger.warning(
                "auth.rate_limit.tripped",
                scope=_SCOPE_SCHEMA_IP,
                key=ip,
                counter=counter,
                cap=cap,
            )
            raise RateLimitExceeded(context={"retry_after": 3600})

    async def hit_bootstrap_ip(self, ip: str) -> None:
        """Phase 5 reserved — bootstrap endpoint IP rate limit (10/hr cap)."""
        now = datetime.now(UTC)
        counter = await self._increment_windowed(_SCOPE_BOOTSTRAP_IP, ip, 3600, now)
        cap = _CAP[_SCOPE_BOOTSTRAP_IP]
        if cap is not None and counter > cap:
            _logger.warning(
                "auth.rate_limit.tripped",
                scope=_SCOPE_BOOTSTRAP_IP,
                key=ip,
                counter=counter,
                cap=cap,
            )
            raise RateLimitExceeded(context={"retry_after": 3600})

    async def hit_api_key_ip(self, ip: str) -> None:
        """Enforce 10/hr cap on API-key creation attempts per IP."""
        now = datetime.now(UTC)
        counter = await self._increment_windowed(_SCOPE_API_KEY_IP, ip, 3600, now)
        cap = _CAP[_SCOPE_API_KEY_IP]
        if cap is not None and counter > cap:
            _logger.warning(
                "auth.rate_limit.tripped",
                scope=_SCOPE_API_KEY_IP,
                key=ip,
                counter=counter,
                cap=cap,
            )
            raise RateLimitExceeded(context={"retry_after": 3600})

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _cache_ttl(self, scope: str) -> float:
        """Return the cache TTL for a scope: max(60, window_length)."""
        window = _WINDOW.get(scope, _CACHE_MAX_TTL)
        return float(max(_CACHE_MAX_TTL, window))

    def _read_cache(self, scope: str, key: str) -> _CachedCounter | None:
        entry = self._cache.get((scope, key))
        if entry is None:
            return None
        if time.monotonic() >= entry.expires_at:
            del self._cache[(scope, key)]
            return None
        return entry

    def _write_cache(self, scope: str, key: str, counter: int, window_start: float) -> None:
        ttl = self._cache_ttl(scope)
        self._cache[(scope, key)] = _CachedCounter(
            counter=counter,
            window_start=window_start,
            expires_at=time.monotonic() + ttl,
        )

    def invalidate_cache(self, scope: str, key: str) -> None:
        """Remove a cache entry (used by reset and tests)."""
        _ = self._cache.pop((scope, key), None)

    async def _increment(self, scope: str, key: str) -> int:
        """Increment and persist; return the new counter value."""
        now = datetime.now(UTC)
        async with self._sessionmaker() as db_session:
            row = await self._build_repo(db_session).upsert_increment(scope, key, now)
            await db_session.commit()
        self._write_cache(scope, key, row.counter, row.window_start.timestamp())
        return row.counter

    async def _increment_windowed(
        self, scope: str, key: str, window_seconds: int, now: datetime
    ) -> int:
        """Increment within a rolling window; reset counter when window expires."""
        cached = self._read_cache(scope, key)
        if cached is not None:
            elapsed = now.timestamp() - cached.window_start
            if elapsed >= window_seconds:
                # Window expired in cache; delegate to DB for authoritative reset
                _ = self._cache.pop((scope, key), None)

        async with self._sessionmaker() as db_session:
            row = await self._build_repo(db_session).upsert_increment(
                scope, key, now, window_seconds=window_seconds
            )
            await db_session.commit()
        self._write_cache(scope, key, row.counter, row.window_start.timestamp())
        return row.counter

    async def _reset(self, scope: str, key: str) -> None:
        """Reset counter in DB and evict cache entry."""
        async with self._sessionmaker() as db_session:
            await self._build_repo(db_session).reset(scope, key)
            await db_session.commit()
        self.invalidate_cache(scope, key)
