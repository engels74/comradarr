"""Auth repositories — skeleton CRUD for Phase 4 to compose against.

Phase 2 ships only the structural query surface; Phase 4 owns runtime auth
(login, session minting, OIDC callback wiring, API key issuance, rate-limit
counters). Each method here is intentionally narrow — Phase 4's controllers
are expected to compose multiple repository calls inside a single
``AsyncSession`` transaction (e.g. validate-then-mint-then-audit), not to
defer the orchestration to repository helpers.

**Q8 — lazy-match for ``sessions.oidc_provider_name``.** Sessions store the
OIDC provider's ``short_name`` as a plain string with **no** foreign key to
``oidc_providers`` (deletes on the provider row would otherwise cascade-revoke
sessions, which is a footgun for operators rotating provider config).
Consequence: callers of :meth:`SessionRepository.get_session_by_hash` MUST
treat a session whose ``oidc_provider_name`` no longer matches any row in
``oidc_providers`` as **expired**. Phase 4 owns the validator that enforces
this — Phase 2 only carries the docstring contract.
"""

import uuid  # noqa: TC003 — runtime use in method signatures
from datetime import datetime  # noqa: TC003 — runtime use in method signatures

import structlog
from sqlalchemy import delete, select

from comradarr.db.enums import (
    AuthProvider,  # noqa: TC001 — runtime: enum value flows through create_session()
)
from comradarr.db.models.api_key import ApiKey
from comradarr.db.models.auth_rate_limit import AuthRateLimit
from comradarr.db.models.oidc_provider import OIDCProvider
from comradarr.db.models.session import Session
from comradarr.db.models.user import User
from comradarr.repositories.base import BaseRepository

_logger = structlog.stdlib.get_logger(__name__)


class UserRepository(BaseRepository):
    """Read + light-write surface for ``users``."""

    async def get_by_id(self, user_id: uuid.UUID) -> User | None:
        return await self.session.get(User, user_id)

    async def get_by_email(self, email: str) -> User | None:
        stmt = select(User).where(User.email == email)
        return await self.session.scalar(stmt)

    async def get_by_username(self, username: str) -> User | None:
        stmt = select(User).where(User.username == username)
        return await self.session.scalar(stmt)


class SessionRepository(BaseRepository):
    """CRUD for browser/cookie session rows. Phase 4 wires the runtime path."""

    async def create_session(
        self,
        *,
        user_id: uuid.UUID,
        token_hash: bytes,
        auth_provider: AuthProvider,
        oidc_provider_name: str | None,
        expires_at: datetime,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> Session:
        """Insert a new session row and return the persisted instance."""
        session_row = Session(
            token_hash=token_hash,
            user_id=user_id,
            auth_provider=auth_provider,
            oidc_provider_name=oidc_provider_name,
            expires_at=expires_at,
            ip=ip,
            user_agent=user_agent,
        )
        self.session.add(session_row)
        await self.session.flush()
        return session_row

    async def get_session_by_hash(self, token_hash: bytes) -> Session | None:
        """Look up a session by its ``token_hash``.

        See module docstring (Q8): callers MUST cross-check
        ``Session.oidc_provider_name`` against ``oidc_providers`` and treat a
        broken match as expired. Phase 4 owns that validator.
        """
        stmt = select(Session).where(Session.token_hash == token_hash)
        return await self.session.scalar(stmt)

    async def revoke_sessions(self, user_id: uuid.UUID) -> None:
        """Delete every session row owned by ``user_id`` (logout-all path)."""
        stmt = delete(Session).where(Session.user_id == user_id)
        _ = await self.session.execute(stmt)


class ApiKeyRepository(BaseRepository):
    """Read-side surface for ``api_keys``. Phase 4 issues new keys."""

    async def get_by_hash(self, key_hash: bytes) -> ApiKey | None:
        stmt = select(ApiKey).where(ApiKey.key_hash == key_hash)
        return await self.session.scalar(stmt)

    async def list_for_user(self, user_id: uuid.UUID) -> list[ApiKey]:
        stmt = select(ApiKey).where(ApiKey.user_id == user_id)
        result = await self.session.scalars(stmt)
        return list(result.all())


class AuthRateLimitRepository(BaseRepository):
    """Read/write surface for ``auth_rate_limits`` counters."""

    async def get(self, scope: str, key: str) -> AuthRateLimit | None:
        return await self.session.get(AuthRateLimit, (scope, key))


class OIDCProviderRepository(BaseRepository):
    """Read surface for ``oidc_providers``. Phase 4 owns mutations."""

    async def get_by_short_name(self, short_name: str) -> OIDCProvider | None:
        return await self.session.get(OIDCProvider, short_name)

    async def list_all(self) -> list[OIDCProvider]:
        stmt = select(OIDCProvider)
        result = await self.session.scalars(stmt)
        return list(result.all())


class AuthRepository(
    UserRepository,
    SessionRepository,
    ApiKeyRepository,
    AuthRateLimitRepository,
    OIDCProviderRepository,
):
    """Aggregate facade over the auth-domain repositories.

    Phase 4 controllers can either inject this composite class or the
    individual repositories directly. The composite is offered so a single
    ``AsyncSession`` is shared across the auth call graph without callers
    threading five separate repository instances through their fixtures.
    """
