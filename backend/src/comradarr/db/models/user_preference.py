"""``user_preferences`` table — per-user opaque key/value store (PRD Appendix B).

Composite PK ``(user_id, key)`` keeps each preference unique per user without
an extra surrogate. ``ON DELETE CASCADE`` on ``user_id`` ensures deleting a
user wipes their preferences in the same transaction (PRD §8 / Phase 2 plan
§6 R6 — user-owned rows cascade with the user).
"""

import uuid  # noqa: TC003 — SQLAlchemy resolves `Mapped[uuid.UUID]` at runtime
from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base


class UserPreference(Base):
    """A single per-user preference row (Phase 2 plan §M5 step 19)."""

    __tablename__: str = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(nullable=False)
