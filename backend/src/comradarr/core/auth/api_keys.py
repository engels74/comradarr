# backend/src/comradarr/core/auth/api_keys.py
"""API key issuance, parsing, validation, and permission resolution (plan §5.4.6).

Token flow:
  random_part = secrets.token_urlsafe(32)   # URL-safe base64, ~43 chars
  plaintext   = API_KEY_PREFIX + random_part # returned exactly once
  key_hash    = sha256(random_part.encode()).digest()  # 32 bytes, stored in DB

Only the hash is persisted. The plaintext is irrecoverable after issuance.
``parse`` validates structure before any DB access so structural rejects
never hit the database.

``API_KEY_PREFIX`` is the ONLY sanctioned source of the prefix string —
never rebuild it by string concatenation from parts elsewhere.

RULE-PY-002: No ``from __future__ import annotations`` (PEP 649 default).
RULE-PY-003: No ``Any``.
RULE-LOG-001: structlog only, no f-strings in log calls.
RULE-AUTHZ-MATCH-001: exact-string match on prefix.
"""

import hashlib
import secrets
import uuid  # noqa: TC003 — runtime use: uuid.UUID parameter in issue/revoke signatures
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Final, final

import msgspec
import structlog

from comradarr.db.enums import AuditAction
from comradarr.db.models.api_key import ApiKey
from comradarr.errors.authentication import AuthenticationApiKeyNotFound

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from comradarr.core.auth.rate_limit import RateLimiter
    from comradarr.repositories.auth import ApiKeyRepository, ApiKeyScopeRepository
    from comradarr.services.audit.writer import AuditWriter

_logger = structlog.stdlib.get_logger(__name__)


class ApiKeyPrincipal(msgspec.Struct, frozen=True, kw_only=True):
    """Resolved identity from a validated API key."""

    user_id: uuid.UUID
    api_key_id: uuid.UUID
    permissions: frozenset[str]


class AnonymousPrincipal(msgspec.Struct, frozen=True, kw_only=True):
    """No credential was presented or all credentials were invalid."""


# Module-level constant — the ONLY sanctioned source of the API key prefix.
# Parsers, issuers, and audit context all reference this symbol directly.
# NEVER rebuild as ``"cmrr_" + "live_"`` or similar concatenations.
API_KEY_PREFIX: Final[str] = "cmrr_live_"

_BEARER_PREFIX = "Bearer "


def _hash_random(random_part: str) -> bytes:
    """SHA-256 of the random suffix (the only part stored in DB)."""
    return hashlib.sha256(random_part.encode()).digest()


def parse(header_value: str) -> bytes | None:
    """Parse an API key from a raw header value; return its hash or ``None``.

    Strips an optional ``Bearer `` prefix, then performs an exact-string
    structural check against ``API_KEY_PREFIX`` (RULE-AUTHZ-MATCH-001).
    Returns ``None`` on any mismatch — callers must increment the
    ``api_key_ip`` rate-limit bucket and bail **before** any DB lookup.

    No exception is raised on malformed input; ``None`` is the sentinel for
    "not an API key header".
    """
    value = header_value
    if value.startswith(_BEARER_PREFIX):
        value = value[len(_BEARER_PREFIX) :]

    # Exact-string prefix check (RULE-AUTHZ-MATCH-001 — no startswith + wildcard).
    if not value.startswith(API_KEY_PREFIX):
        return None

    random_part = value[len(API_KEY_PREFIX) :]
    if not random_part:
        return None

    return _hash_random(random_part)


@final
class ApiKeyService:
    """Runtime operations for API key issuance, validation, and permission resolution."""

    __slots__: tuple[str, ...] = ("_sessionmaker", "_audit")

    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        audit: AuditWriter,
    ) -> None:
        self._sessionmaker = sessionmaker
        self._audit = audit

    def _build_key_repo(self, db_session: AsyncSession) -> ApiKeyRepository:
        from comradarr.repositories.auth import ApiKeyRepository  # noqa: PLC0415

        return ApiKeyRepository(db_session)

    def _build_scope_repo(self, db_session: AsyncSession) -> ApiKeyScopeRepository:
        from comradarr.repositories.auth import ApiKeyScopeRepository  # noqa: PLC0415

        return ApiKeyScopeRepository(db_session)

    async def issue(
        self,
        *,
        user_id: uuid.UUID,
        name: str,
        scopes: list[str],
        expires_at: datetime | None,
        ip: str | None,
        user_agent: str | None,
    ) -> tuple[str, ApiKey]:
        """Mint a new API key; return ``(plaintext, ApiKey)`` — plaintext is shown once.

        Audit context contains only ``api_key_id``, ``prefix``, and
        ``last_four`` — never the plaintext or hash.
        """
        random_part = secrets.token_urlsafe(32)
        plaintext = API_KEY_PREFIX + random_part
        key_hash = _hash_random(random_part)
        last_four = plaintext[-4:]
        now = datetime.now(UTC)

        async with self._sessionmaker() as db_session:
            repo = self._build_key_repo(db_session)
            api_key = await repo.create(
                user_id=user_id,
                name=name,
                key_hash=key_hash,
                prefix=API_KEY_PREFIX,
                last_four=last_four,
                scopes=scopes,
                expires_at=expires_at,
                created_at=now,
            )
            await db_session.commit()

        await self._audit.record(
            action=AuditAction.API_KEY_ISSUED,
            actor_user_id=user_id,
            context={
                "api_key_id": str(api_key.id),
                "prefix": API_KEY_PREFIX,
                "last_four": last_four,
            },
            ip=ip,
            user_agent=user_agent,
        )

        _logger.info(
            "api_key.issued",
            api_key_id=str(api_key.id),
            prefix=API_KEY_PREFIX,
            last_four=last_four,
        )
        return plaintext, api_key

    async def validate(
        self,
        key_hash: bytes,
        source_ip: str | None,
        rate_limiter: RateLimiter,
    ) -> ApiKey | None:
        """Look up the API key by hash; flip ``last_used_at`` idempotently on first use.

        Returns ``None`` on miss (and hits the ``api_key_ip`` rate-limit bucket).
        The ``last_used_at`` update uses ``UPDATE … WHERE last_used_at IS NULL``
        so concurrent first-uses are idempotent.
        """
        async with self._sessionmaker() as db_session:
            repo = self._build_key_repo(db_session)
            api_key = await repo.get_by_hash(key_hash)

            if api_key is None:
                if source_ip is not None:
                    await rate_limiter.hit_api_key_ip(source_ip)
                return None

            now = datetime.now(UTC)
            first_use = await repo.update_last_used_if_null(api_key.id, now)
            await db_session.commit()

        if first_use:
            await self._audit.record(
                action=AuditAction.API_KEY_FIRST_USED,
                actor_user_id=api_key.user_id,
                context={
                    "api_key_id": str(api_key.id),
                    "prefix": api_key.prefix,
                    "last_four": api_key.last_four,
                },
                ip=source_ip,
                user_agent=None,
            )
            _logger.info(
                "api_key.first_used",
                api_key_id=str(api_key.id),
            )

        return api_key

    async def resolve_permissions(
        self,
        api_key: ApiKey,
        owner_role: str,
    ) -> set[str]:
        """Return the effective permission set for this key.

        If the key has no scope rows, it inherits all permissions for the
        owner's current role. Otherwise the effective set is the intersection
        of the key's explicit scopes and the role's permissions — a role
        demotion automatically shrinks any key's effective permissions.
        """
        async with self._sessionmaker() as db_session:
            scope_repo = self._build_scope_repo(db_session)
            key_repo = self._build_key_repo(db_session)
            scope_set = await scope_repo.get_scopes(api_key.id)
            role_perms = await key_repo.get_role_permissions(owner_role)

        if not scope_set:
            return role_perms

        return scope_set & role_perms

    async def revoke(
        self,
        api_key_id: uuid.UUID,
        actor_user_id: uuid.UUID,
        ip: str | None,
        user_agent: str | None,
    ) -> None:
        """Revoke an API key by id and emit an audit record.

        Raises :class:`AuthenticationApiKeyNotFound` when ``api_key_id`` does
        not exist so the caller gets a clean 404 rather than a silently
        fabricated audit row.  Attributes are snapshotted inside the session
        block so the audit record does not depend on session lifetime.
        """
        async with self._sessionmaker() as db_session:
            api_key = await db_session.get(ApiKey, api_key_id)
            if api_key is None:
                raise AuthenticationApiKeyNotFound()
            # Snapshot before DELETE + commit so audit access is session-independent.
            prefix: str = api_key.prefix
            last_four: str = api_key.last_four
            repo = self._build_key_repo(db_session)
            await repo.revoke(api_key_id)
            await db_session.commit()

        await self._audit.record(
            action=AuditAction.API_KEY_REVOKED,
            actor_user_id=actor_user_id,
            context={
                "api_key_id": str(api_key_id),
                "prefix": prefix,
                "last_four": last_four,
            },
            ip=ip,
            user_agent=user_agent,
        )
