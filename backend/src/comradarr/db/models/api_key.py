"""``api_keys`` table — programmatic-access keys for Comradarr (PRD §15).

Only the SHA-256 of the random portion is stored, alongside the visible
prefix and last-four characters that the UI shows. The full plaintext is
returned exactly once at creation; thereafter it is unrecoverable.

The `key_hash` column is sized for SHA-256 (32 bytes) and indexed for the
authentication hot path — every API-key-authenticated request hashes the
inbound key and looks it up here.
"""

import uuid  # noqa: TC003 — SQLAlchemy resolves `Mapped[uuid.UUID]` at runtime
from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import ForeignKey, LargeBinary, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base, uuid_v7_pk_default


class ApiKey(Base):
    """A programmatic API key tied to a user (PRD §15 — `api_keys` table)."""

    __tablename__: str = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid_v7_pk_default,
    )
    # SHA-256 of the random portion = 32 bytes; unique + indexed for the
    # authentication lookup path.
    key_hash: Mapped[bytes] = mapped_column(
        LargeBinary,
        unique=True,
        index=True,
        nullable=False,
    )
    prefix: Mapped[str] = mapped_column(String, nullable=False)
    last_four: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(nullable=True)
