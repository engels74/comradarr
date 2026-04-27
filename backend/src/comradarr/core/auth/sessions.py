# src/comradarr/core/auth/sessions.py
"""Session minting, validation, rotation, and revocation (Phase 4 Slice B §5.4.5).

Token flow:
  plaintext  = secrets.token_urlsafe(32)   # 256-bit, returned as str to caller
  token_hash = sha256(plaintext.encode())  # 32 bytes, stored in DB

Only the hash is persisted — a DB dump cannot be replayed as a cookie. Revocation
deletes the row; there is no tombstone window.

Idle timeout is computed lazily at validation time as:
    last_seen_at + timedelta(days=idle_days)

Absolute timeout is stored as expires_at at mint time:
    now + timedelta(days=absolute_days)
"""

import asyncio
import hashlib
import secrets
import uuid  # noqa: TC003 — runtime: uuid.UUID used in method signatures
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, final

import msgspec
import structlog

from comradarr.db.enums import AuditAction, AuthProvider
from comradarr.db.models.session import Session  # noqa: TC001 — runtime: Session in return type

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from comradarr.config import Settings
    from comradarr.repositories.auth import OIDCProviderRepository, SessionRepository
    from comradarr.services.audit.writer import AuditWriter

_logger = structlog.stdlib.get_logger(__name__)


class SessionPrincipal(msgspec.Struct, frozen=True, kw_only=True):
    """Resolved identity from a validated session cookie."""

    user_id: uuid.UUID
    session_id: uuid.UUID
    auth_provider: AuthProvider
    oidc_provider_name: str | None = None


def _hash_token(plaintext: str) -> bytes:
    return hashlib.sha256(plaintext.encode()).digest()


async def _update_last_seen(
    sessionmaker: async_sessionmaker[AsyncSession],
    token_hash: bytes,
    now: datetime,
) -> None:
    """Fire-and-forget last_seen_at updater. Failures are logged, never raised."""
    from sqlalchemy import update  # noqa: PLC0415 — deferred to keep fire-and-forget cheap

    from comradarr.db.models.session import Session as SessionModel  # noqa: PLC0415

    try:
        async with sessionmaker() as db_session:
            stmt = (
                update(SessionModel)
                .where(SessionModel.token_hash == token_hash)
                .values(last_seen_at=now)
            )
            _ = await db_session.execute(stmt)
            await db_session.commit()
    except Exception:  # noqa: BLE001 — swallow all; this is best-effort
        _logger.warning("session.last_seen_update.failed", token_hash=token_hash.hex())


@final
class SessionService:
    """Runtime session operations — mint, validate, rotate, revoke."""

    __slots__: tuple[str, ...] = ("_sessionmaker", "_settings", "_audit")

    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        settings: Settings,
        audit: AuditWriter,
    ) -> None:
        self._sessionmaker = sessionmaker
        self._settings = settings
        self._audit = audit

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _idle_days(self) -> int:
        return self._settings.comradarr_session_idle_days

    def _absolute_days(self) -> int:
        return self._settings.comradarr_session_absolute_days

    def _build_session_repo(self, db_session: AsyncSession) -> SessionRepository:
        from comradarr.repositories.auth import SessionRepository  # noqa: PLC0415

        return SessionRepository(db_session)

    def _build_oidc_repo(self, db_session: AsyncSession) -> OIDCProviderRepository:
        from comradarr.repositories.auth import OIDCProviderRepository  # noqa: PLC0415

        return OIDCProviderRepository(db_session)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def mint(
        self,
        *,
        user_id: uuid.UUID,
        auth_provider: AuthProvider,
        oidc_provider_name: str | None,
        ip: str | None,
        user_agent: str | None,
        replace_token_hash: bytes | None,
    ) -> tuple[str, Session]:
        """Mint a new session token.

        If ``replace_token_hash`` is provided the matching session row is
        deleted in the same transaction (fixation defense / rotation).

        Returns ``(plaintext_token, Session)``. The caller (controller) is
        responsible for setting the cookie; plaintext is never stored.
        """
        plaintext = secrets.token_urlsafe(32)
        token_hash = _hash_token(plaintext)
        now = datetime.now(UTC)
        expires_at = now + timedelta(days=self._absolute_days())

        async with self._sessionmaker() as db_session:
            repo = self._build_session_repo(db_session)

            if replace_token_hash is not None:
                await repo.delete_by_hash(replace_token_hash)

            session_row = await repo.create_session(
                user_id=user_id,
                token_hash=token_hash,
                auth_provider=auth_provider,
                oidc_provider_name=oidc_provider_name,
                created_at=now,
                expires_at=expires_at,
                last_seen_at=now,
                ip=ip,
                user_agent=user_agent,
            )
            await db_session.commit()
            await db_session.refresh(session_row)

        return plaintext, session_row

    async def validate(self, token: str) -> SessionPrincipal | None:
        """Validate a session token; return principal or None if invalid/expired.

        Idle timeout: last_seen_at + idle_days
        Absolute timeout: expires_at (minted at creation)
        OIDC provider lazy-match: broken match → treat as expired (Q8 contract)
        """
        token_hash = _hash_token(token)
        now = datetime.now(UTC)

        async with self._sessionmaker() as db_session:
            repo = self._build_session_repo(db_session)
            row = await repo.get_session_by_hash(token_hash)

        if row is None:
            return None

        # Absolute timeout
        if now >= row.expires_at.replace(tzinfo=UTC):
            return None

        # Idle timeout
        idle_deadline = row.last_seen_at.replace(tzinfo=UTC) + timedelta(days=self._idle_days())
        if now >= idle_deadline:
            return None

        # OIDC provider lazy-match (Q8): if the session was issued for an OIDC
        # provider that no longer exists in the registry, treat it as expired.
        if row.oidc_provider_name is not None:
            async with self._sessionmaker() as db_session:
                oidc_repo = self._build_oidc_repo(db_session)
                provider_row = await oidc_repo.get_by_short_name(row.oidc_provider_name)
            if provider_row is None:
                return None

        # Fire-and-forget last_seen_at update; failures are swallowed + logged.
        _ = asyncio.create_task(
            _update_last_seen(self._sessionmaker, token_hash, now),
            name=f"session.last_seen.{token_hash.hex()[:8]}",
        )

        return SessionPrincipal(
            user_id=row.user_id,
            session_id=row.id,
            auth_provider=row.auth_provider,
            oidc_provider_name=row.oidc_provider_name,
        )

    async def rotate(
        self,
        *,
        current_token_hash: bytes,
        user_id: uuid.UUID,
        auth_provider: AuthProvider,
        oidc_provider_name: str | None,
        ip: str | None,
        user_agent: str | None,
    ) -> str:
        """Rotate: mint a fresh token (deleting current), revoke all other sessions.

        Emits SESSION_REVOKED audit per killed row.
        """
        plaintext, _new_session = await self.mint(
            user_id=user_id,
            auth_provider=auth_provider,
            oidc_provider_name=oidc_provider_name,
            ip=ip,
            user_agent=user_agent,
            replace_token_hash=current_token_hash,
        )

        new_hash = _hash_token(plaintext)
        await self._revoke_others_and_audit(user_id=user_id, except_token_hash=new_hash)

        return plaintext

    async def revoke_all_other(self, user_id: uuid.UUID, except_token_hash: bytes) -> None:
        """Revoke all sessions for ``user_id`` except the one with ``except_token_hash``."""
        await self._revoke_others_and_audit(user_id=user_id, except_token_hash=except_token_hash)

    async def revoke(self, token_hash: bytes) -> None:
        """Revoke a single session by hash."""
        async with self._sessionmaker() as db_session:
            repo = self._build_session_repo(db_session)
            row = await repo.get_session_by_hash(token_hash)
            if row is not None:
                await repo.delete_by_hash(token_hash)
                await db_session.commit()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _revoke_others_and_audit(
        self, *, user_id: uuid.UUID, except_token_hash: bytes
    ) -> None:
        """Delete all sessions for user except the given hash; audit each deletion."""
        async with self._sessionmaker() as db_session:
            repo = self._build_session_repo(db_session)
            killed_rows = await repo.delete_other_sessions(
                user_id=user_id, except_token_hash=except_token_hash
            )
            await db_session.commit()

        for row in killed_rows:
            await self._audit.record(
                action=AuditAction.SESSION_REVOKED,
                actor_user_id=user_id,
                context={"session_id": str(row.id)},
                ip=row.ip,
                user_agent=row.user_agent,
            )
