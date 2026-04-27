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
from datetime import UTC, datetime  # noqa: TC003 — runtime use in method signatures
from typing import TYPE_CHECKING, cast

import structlog
from sqlalchemy import delete, select, text, update

if TYPE_CHECKING:
    from sqlalchemy.engine import CursorResult

from comradarr.core.auth.sentinel import LOCKED_OIDC_HASH, LOCKED_TRUSTED_HEADER_HASH
from comradarr.db.enums import (
    AuthProvider,  # noqa: TC001 — runtime: enum value flows through create_session()
    ProvisioningProvider,  # noqa: TC001 — runtime: enum value flows through create_provisioned()
    UserRole,  # noqa: TC001 — runtime: enum value flows through create_local/create_provisioned()
)
from comradarr.db.models.api_key import ApiKey
from comradarr.db.models.api_key_scope import ApiKeyScope
from comradarr.db.models.auth_rate_limit import AuthRateLimit
from comradarr.db.models.oidc_provider import OIDCProvider
from comradarr.db.models.role_permission import RolePermission
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

    # --- Phase 4 Slice D additions ---

    async def create_local(
        self,
        *,
        email: str,
        username: str,
        password_hash: str,
        role: UserRole,
    ) -> User:
        """Insert a local-password user row. Caller is responsible for hashing."""
        now = datetime.now(UTC)
        user = User(
            email=email,
            username=username,
            password_hash=password_hash,
            role=role,
            provisioning_provider=ProvisioningProvider.LOCAL,
            created_at=now,
            updated_at=now,
        )
        self.session.add(user)
        await self.session.flush()
        return user

    async def create_provisioned(
        self,
        *,
        email: str,
        username: str,
        provisioning_provider: ProvisioningProvider,
        role: UserRole,
    ) -> User:
        """Insert a non-local user row with the appropriate locked sentinel hash.

        The sentinel value written to ``password_hash`` is intentionally
        non-hashable so local password auth is structurally impossible against
        these rows (PRD §15).  Once Slice A lands, replace the inline constants
        with imports from ``comradarr.core.auth.sentinel``.
        """
        if provisioning_provider is ProvisioningProvider.TRUSTED_HEADER:
            sentinel = LOCKED_TRUSTED_HEADER_HASH
        elif provisioning_provider is ProvisioningProvider.OIDC:
            sentinel = LOCKED_OIDC_HASH
        else:
            raise ValueError(
                "create_provisioned called with LOCAL provider; use create_local instead"
            )
        now = datetime.now(UTC)
        user = User(
            email=email,
            username=username,
            password_hash=sentinel,
            role=role,
            provisioning_provider=provisioning_provider,
            created_at=now,
            updated_at=now,
        )
        self.session.add(user)
        await self.session.flush()
        return user

    async def update_password(self, user_id: uuid.UUID, new_hash: str) -> None:
        """Overwrite the ``password_hash`` for a local user row."""
        stmt = (
            update(User)
            .where(User.id == user_id)
            .values(password_hash=new_hash, updated_at=datetime.now(UTC))
            .execution_options(synchronize_session="fetch")
        )
        _ = await self.session.execute(stmt)

    async def set_last_login(self, user_id: uuid.UUID, ip: str | None) -> None:
        """Best-effort update of ``last_login_at``; logs on failure, never raises."""
        try:
            stmt = (
                update(User)
                .where(User.id == user_id)
                .values(last_login_at=datetime.now(UTC))
                .execution_options(synchronize_session="fetch")
            )
            _ = await self.session.execute(stmt)
        except Exception:
            _logger.warning(
                "user.set_last_login.failed",
                user_id=str(user_id),
                ip=ip,
                exc_info=True,
            )

    async def set_oidc_subject(self, user_id: uuid.UUID, subject: str) -> None:
        """Link an OIDC ``sub`` claim to the user row (Slice G consumer)."""
        stmt = (
            update(User)
            .where(User.id == user_id)
            .values(oidc_subject=subject, updated_at=datetime.now(UTC))
            .execution_options(synchronize_session="fetch")
        )
        _ = await self.session.execute(stmt)


class SessionRepository(BaseRepository):
    """CRUD for browser/cookie session rows. Phase 4 wires the runtime path."""

    async def create_session(
        self,
        *,
        user_id: uuid.UUID,
        token_hash: bytes,
        auth_provider: AuthProvider,
        oidc_provider_name: str | None,
        created_at: datetime,
        expires_at: datetime,
        last_seen_at: datetime,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> Session:
        """Insert a new session row and return the persisted instance."""
        session_row = Session(
            token_hash=token_hash,
            user_id=user_id,
            auth_provider=auth_provider,
            oidc_provider_name=oidc_provider_name,
            created_at=created_at,
            expires_at=expires_at,
            last_seen_at=last_seen_at,
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

    # --- Phase 4 Slice B additions ---

    async def delete_by_hash(self, token_hash: bytes) -> None:
        """Delete a single session row by ``token_hash`` (fixation defense / rotation)."""
        stmt = delete(Session).where(Session.token_hash == token_hash)
        _ = await self.session.execute(stmt)

    async def delete_other_sessions(
        self, user_id: uuid.UUID, except_token_hash: bytes
    ) -> list[Session]:
        """Delete all sessions for ``user_id`` except the one with ``except_token_hash``.

        Returns the list of deleted rows so callers can emit per-row audit events.
        """
        fetch_stmt = (
            select(Session)
            .where(Session.user_id == user_id)
            .where(Session.token_hash != except_token_hash)
        )
        result = await self.session.scalars(fetch_stmt)
        rows = list(result.all())
        if rows:
            del_stmt = (
                delete(Session)
                .where(Session.user_id == user_id)
                .where(Session.token_hash != except_token_hash)
            )
            _ = await self.session.execute(del_stmt)
        return rows


class ApiKeyRepository(BaseRepository):
    """Read + write surface for ``api_keys``. Phase 4 issues and revokes keys."""

    async def get_by_hash(self, key_hash: bytes) -> ApiKey | None:
        stmt = select(ApiKey).where(ApiKey.key_hash == key_hash)
        return await self.session.scalar(stmt)

    async def list_for_user(self, user_id: uuid.UUID) -> list[ApiKey]:
        stmt = select(ApiKey).where(ApiKey.user_id == user_id)
        result = await self.session.scalars(stmt)
        return list(result.all())

    # --- Phase 4 Slice H additions ---

    async def create(
        self,
        *,
        user_id: uuid.UUID,
        name: str,
        key_hash: bytes,
        prefix: str,
        last_four: str,
        scopes: list[str],
        expires_at: datetime | None,
        created_at: datetime,
    ) -> ApiKey:
        """Insert a new API key row and its scope rows; return the persisted instance."""
        api_key = ApiKey(
            user_id=user_id,
            name=name,
            key_hash=key_hash,
            prefix=prefix,
            last_four=last_four,
            expires_at=expires_at,
            created_at=created_at,
        )
        self.session.add(api_key)
        await self.session.flush()  # populate api_key.id before scope inserts

        for permission_name in scopes:
            scope_row = ApiKeyScope(
                api_key_id=api_key.id,
                permission_name=permission_name,
            )
            self.session.add(scope_row)

        if scopes:
            await self.session.flush()

        return api_key

    async def update_last_used_if_null(self, api_key_id: uuid.UUID, now: datetime) -> bool:
        """Set ``last_used_at`` only when it is currently NULL (idempotent first-use).

        Returns ``True`` when the update matched (i.e. this was the first use),
        ``False`` when ``last_used_at`` was already set. Uses
        ``UPDATE … WHERE last_used_at IS NULL`` so concurrent first-uses are safe.
        """
        stmt = (
            update(ApiKey)
            .where(ApiKey.id == api_key_id)
            .where(ApiKey.last_used_at.is_(None))
            .values(last_used_at=now)
            .execution_options(synchronize_session="fetch")
        )
        result = await self.session.execute(stmt)
        return cast("CursorResult[object]", result).rowcount > 0

    async def revoke(self, api_key_id: uuid.UUID) -> None:
        """Delete the API key row (CASCADE removes scope rows via FK)."""
        stmt = delete(ApiKey).where(ApiKey.id == api_key_id)
        _ = await self.session.execute(stmt)

    async def get_role_permissions(self, role_name: str) -> set[str]:
        """Return all permission names granted to ``role_name``."""
        stmt = select(RolePermission.permission_name).where(RolePermission.role_name == role_name)
        result = await self.session.scalars(stmt)
        return set(result.all())


class ApiKeyScopeRepository(BaseRepository):
    """Read surface for ``api_key_scopes`` — per-key permission subsets."""

    async def get_scopes(self, api_key_id: uuid.UUID) -> set[str]:
        """Return the explicit permission names for an API key.

        An empty set means the key inherits the owner's full role permissions.
        """
        stmt = select(ApiKeyScope.permission_name).where(ApiKeyScope.api_key_id == api_key_id)
        result = await self.session.scalars(stmt)
        return set(result.all())


class AuthRateLimitRepository(BaseRepository):
    """Read/write surface for ``auth_rate_limits`` counters."""

    async def get(self, scope: str, key: str) -> AuthRateLimit | None:
        return await self.session.get(AuthRateLimit, (scope, key))

    async def upsert_increment(
        self,
        scope: str,
        key: str,
        now: datetime,
        *,
        window_seconds: int | None = None,
    ) -> AuthRateLimit:
        """Upsert the rate-limit row and increment its counter.

        Uses ``INSERT … ON CONFLICT DO UPDATE`` so the operation is a single
        round-trip with no read-before-write (RULE-DB-003).

        When ``window_seconds`` is supplied the counter resets to 1 if the
        existing ``window_start`` is older than ``window_seconds``; otherwise
        it increments within the current window.  Omitting ``window_seconds``
        (username-backoff path) always increments monotonically.
        """
        if window_seconds is not None:
            # Window-aware upsert: reset counter when the window has rolled over.
            stmt = text(
                """
                INSERT INTO auth_rate_limits
                    (scope, key, counter, window_start, backoff_delay, last_failure_at)
                VALUES
                    (:scope, :key, 1, :now, 0, :now)
                ON CONFLICT (scope, key) DO UPDATE
                    SET
                        counter = CASE
                            WHEN EXTRACT(EPOCH FROM
                                (:now - auth_rate_limits.window_start)) >= :window_seconds
                            THEN 1
                            ELSE auth_rate_limits.counter + 1
                        END,
                        window_start = CASE
                            WHEN EXTRACT(EPOCH FROM
                                (:now - auth_rate_limits.window_start)) >= :window_seconds
                            THEN :now
                            ELSE auth_rate_limits.window_start
                        END,
                        last_failure_at = :now
                RETURNING scope, key, counter, window_start, backoff_delay, last_failure_at
                """
            )
            result = await self.session.execute(
                stmt,
                {
                    "scope": scope,
                    "key": key,
                    "now": now,
                    "window_seconds": window_seconds,
                },
            )
        else:
            # Monotonic upsert: counter always increments (backoff path).
            stmt = text(
                """
                INSERT INTO auth_rate_limits
                    (scope, key, counter, window_start, backoff_delay, last_failure_at)
                VALUES
                    (:scope, :key, 1, :now, 0, :now)
                ON CONFLICT (scope, key) DO UPDATE
                    SET
                        counter = auth_rate_limits.counter + 1,
                        last_failure_at = :now
                RETURNING scope, key, counter, window_start, backoff_delay, last_failure_at
                """
            )
            result = await self.session.execute(
                stmt,
                {"scope": scope, "key": key, "now": now},
            )

        row = result.one()
        # cast() narrows the Any-typed Row attributes from text() RETURNING
        # to concrete types that match the AuthRateLimit model (RULE-PY-003).
        rate_limit = AuthRateLimit(
            scope=cast("str", row.scope),
            key=cast("str", row.key),
        )
        rate_limit.counter = cast("int", row.counter)
        rate_limit.window_start = cast("datetime", row.window_start)
        rate_limit.backoff_delay = cast("int", row.backoff_delay)
        rate_limit.last_failure_at = cast("datetime | None", row.last_failure_at)
        return rate_limit

    async def reset(self, scope: str, key: str) -> None:
        """Reset the counter to 0 (called on successful authentication)."""
        now = datetime.now(UTC)
        stmt = text(
            """
            UPDATE auth_rate_limits
            SET counter = 0, last_failure_at = NULL
            WHERE scope = :scope AND key = :key
            """
        )
        _ = await self.session.execute(stmt, {"scope": scope, "key": key, "now": now})


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
    ApiKeyScopeRepository,
    AuthRateLimitRepository,
    OIDCProviderRepository,
):
    """Aggregate facade over the auth-domain repositories.

    Phase 4 controllers can either inject this composite class or the
    individual repositories directly. The composite is offered so a single
    ``AsyncSession`` is shared across the auth call graph without callers
    threading five separate repository instances through their fixtures.
    """
