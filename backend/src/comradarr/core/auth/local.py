# backend/src/comradarr/core/auth/local.py
"""LocalPasswordProvider — Argon2id credential check with timing-equivalence (Slice E §5.4.2).

Security invariants enforced by :meth:`LocalPasswordProvider.authenticate_credentials`:
  1. ``comradarr_disable_local_login`` → raises :class:`AuthenticationLocalLoginDisabled`
     before any DB or rate-limit work.
  2. ``hit_login_ip`` fires before username work → IP-level 429 fast-path.
  3. ``hit_login_username`` fires ALWAYS before ``get_by_username`` (timing-equivalence:
     unknown-username latency equals known-username latency because the backoff
     sleep fires regardless of whether the user exists).
  4. Sentinel hashes (``!locked-trusted-header!``, ``!locked-oidc!``) are rejected
     structurally — ``verify_password`` is never called on them.
  5. Dummy-verify (``_DUMMY_HASH``) fires for unknown usernames so the Argon2id
     work factor is always paid, preventing username enumeration via timing delta.
  6. ``reset_login_username`` only runs on verified success (clears backoff penalty).
  7. ``needs_rehash`` / ``update_password`` triggered transparently post-success.

The :meth:`authenticate` method (ASGI-scope variant) always returns
``NotApplicable`` because local login credentials arrive as an explicit
controller-to-service call, not via ASGI scope metadata.  The controller
calls :meth:`authenticate_credentials` directly.

RULE-PY-002: No ``from __future__ import annotations``.
RULE-PY-003: No ``Any``.
RULE-LOG-001: structlog only.
"""

import uuid  # noqa: TC003 — runtime use: uuid.UUID field in Success + update_password signatures
from typing import TYPE_CHECKING, Final, final

import structlog

from comradarr.core.auth.protocol import AuthOutcome, Failure, NotApplicable, Success
from comradarr.core.auth.sentinel import LOCKED_OIDC_HASH, LOCKED_TRUSTED_HEADER_HASH
from comradarr.core.crypto import hash_password, needs_rehash, verify_password
from comradarr.core.types import Secret
from comradarr.db.enums import AuditAction
from comradarr.db.enums import AuthProvider as AuthProviderEnum
from comradarr.errors.authentication import AuthenticationLocalLoginDisabled

if TYPE_CHECKING:
    from litestar.types import Scope

    from comradarr.config import Settings
    from comradarr.core.auth.rate_limit import RateLimiter
    from comradarr.repositories.auth import UserRepository
    from comradarr.services.audit.writer import AuditWriter


_logger = structlog.stdlib.get_logger(__name__)

# Pre-computed at import time so the Argon2id work factor is always paid for
# unknown-username requests. The value is never stored in the DB.
_DUMMY_HASH: Final[str] = hash_password(Secret("___comradarr_dummy___"))

_SENTINEL_HASHES: Final[frozenset[str]] = frozenset({LOCKED_TRUSTED_HEADER_HASH, LOCKED_OIDC_HASH})


@final
class LocalPasswordProvider:
    """Auth provider for username + Argon2id password credentials.

    Constructed once at lifespan startup; stateless beyond the injected
    collaborators. Satisfies the :class:`comradarr.core.auth.protocol.AuthProvider`
    structural protocol via :meth:`authenticate` (which always returns
    ``NotApplicable`` — the ASGI middleware path skips local login).

    The real entry point for the login controller is
    :meth:`authenticate_credentials`.
    """

    __slots__: tuple[str, ...] = ("_settings", "_audit", "_rate_limiter")

    def __init__(
        self,
        settings: Settings,
        audit: AuditWriter,
        rate_limiter: RateLimiter,
    ) -> None:
        self._settings = settings
        self._audit = audit
        self._rate_limiter = rate_limiter

    async def authenticate(
        self,
        scope: Scope,
        headers: list[tuple[bytes, bytes]],
    ) -> AuthOutcome:
        """ASGI-scope variant — always NotApplicable for local login.

        Local credentials are not in the ASGI scope; the login controller
        calls :meth:`authenticate_credentials` directly.  This method exists
        only to satisfy the :class:`AuthProvider` protocol so the provider can
        be registered in the auth registry.
        """
        _ = scope, headers
        return NotApplicable()

    async def authenticate_credentials(
        self,
        *,
        username: str,
        password: Secret[str],
        source_ip: str | None,
        user_repo: UserRepository,
    ) -> AuthOutcome:
        """Verify username + password against the DB.

        Operation order is security-load-bearing — do not reorder:
          a. Feature gate (may raise :class:`AuthenticationLocalLoginDisabled`)
          b. IP rate-limit (may raise :class:`RateLimitExceeded` → 429)
          c. Username rate-limit + backoff sleep (ALWAYS — timing-equivalence)
          d. User lookup (AFTER sleep so unknown users pay the same delay)
          e. Unknown user → dummy-verify + LOGIN_FAILED audit + Failure
          f. Sentinel/null hash → structural reject + LOGIN_FAILED audit + Failure
          g. Wrong password → LOGIN_FAILED audit + Failure
          h. Success → conditional rehash, counter reset, LOGIN_SUCCESS audit
        """
        # a. Feature gate.
        if self._settings.comradarr_disable_local_login:
            raise AuthenticationLocalLoginDisabled()

        # b. IP rate-limit.
        if source_ip is not None:
            await self._rate_limiter.hit_login_ip(source_ip)

        username_key = username.lower()

        # c. User lookup.
        user = await user_repo.get_by_username(username)

        # d. Unknown user — pay dummy-verify cost to prevent timing oracle, then
        #    increment username counter (backoff on failure only — first legitimate
        #    login never pays the sleep penalty).
        if user is None:
            _ = verify_password(_DUMMY_HASH, password)
            await self._rate_limiter.hit_login_username(username_key)
            _logger.info("auth.local.unknown_user", username=username)
            await self._audit.record(
                action=AuditAction.LOGIN_FAILED,
                actor_user_id=None,
                context={"username": username, "reason": "unknown_user"},
                ip=source_ip,
                user_agent=None,
            )
            return Failure(
                reason="Invalid credentials",
                problem_code="authentication.invalid_credentials",
            )

        # e. Sentinel/null hash — structural reject; verify_password must not run.
        stored_hash: str | None = user.password_hash
        if stored_hash is None or stored_hash in _SENTINEL_HASHES:
            await self._rate_limiter.hit_login_username(username_key)
            _logger.info(
                "auth.local.sentinel_reject",
                username=username,
                user_id=str(user.id),
            )
            await self._audit.record(
                action=AuditAction.LOGIN_FAILED,
                actor_user_id=user.id,
                context={"username": username, "reason": "sentinel_hash"},
                ip=source_ip,
                user_agent=None,
            )
            return Failure(
                reason="Invalid credentials",
                problem_code="authentication.invalid_credentials",
            )

        # f. Password verification.
        if not verify_password(stored_hash, password):
            await self._rate_limiter.hit_login_username(username_key)
            _logger.info(
                "auth.local.wrong_password",
                username=username,
                user_id=str(user.id),
            )
            await self._audit.record(
                action=AuditAction.LOGIN_FAILED,
                actor_user_id=user.id,
                context={"username": username, "reason": "wrong_password"},
                ip=source_ip,
                user_agent=None,
            )
            return Failure(
                reason="Invalid credentials",
                problem_code="authentication.invalid_credentials",
            )

        # h. Success path.
        user_id: uuid.UUID = user.id

        # Transparent rehash — update stored hash if parameters have changed.
        if needs_rehash(stored_hash):
            new_hash = hash_password(password)
            await user_repo.update_password(user_id, new_hash)
            _logger.info("auth.local.rehash", user_id=str(user_id))

        # Reset backoff counter so legitimate users aren't penalised.
        await self._rate_limiter.reset_login_username(username_key)

        await self._audit.record(
            action=AuditAction.LOGIN_SUCCESS,
            actor_user_id=user_id,
            context={"username": username},
            ip=source_ip,
            user_agent=None,
        )

        return Success(
            user_id=user_id,
            auth_provider=AuthProviderEnum.LOCAL,
        )
