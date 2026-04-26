"""``sessions`` table — active login sessions (PRD §15).

The session token plaintext is never stored; only its SHA-256 hash, so a
database read cannot be replayed as a cookie. Revocation deletes the row
rather than marking it expired — there is no window in which a replayed
cookie could match.

``oidc_provider_name`` matches ``oidc_providers.short_name`` lazily — there
is intentionally NO foreign-key declaration (Phase 2 plan §6 Q8). Deleting
an OIDC provider should not cascade to active sessions; the dispatcher
treats a session whose ``oidc_provider_name`` no longer resolves as expired
on the next refresh.
"""

import uuid  # noqa: TC003 — SQLAlchemy resolves `Mapped[uuid.UUID]` at runtime
from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, LargeBinary, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base, uuid_v7_pk_default
from comradarr.db.enums import AuthProvider


class Session(Base):
    """A login session (PRD §15 — `sessions` table)."""

    __tablename__: str = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid_v7_pk_default,
    )
    # SHA-256 of the session token = 32 bytes. Indexed for constant-time
    # lookup during the session-validation hot path.
    token_hash: Mapped[bytes] = mapped_column(
        LargeBinary,
        unique=True,
        index=True,
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    auth_provider: Mapped[AuthProvider] = mapped_column(
        SAEnum(
            AuthProvider,
            native_enum=True,
            name="auth_provider",
            values_callable=lambda e: [m.value for m in e],  # pyright: ignore[reportUnknownLambdaType, reportUnknownMemberType, reportUnknownVariableType]
        ),
        nullable=False,
    )
    # Lazy match against `oidc_providers.short_name` — no FK by design (Q8).
    oidc_provider_name: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(nullable=False)
    ip: Mapped[str | None] = mapped_column(String, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
