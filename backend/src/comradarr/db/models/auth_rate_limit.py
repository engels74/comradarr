"""``auth_rate_limits`` table — persistent rate-limit state (PRD §15).

Persistent across restarts so cycling the container does not reset limits
for a persistent attacker. An in-memory cache sits in front of this table
for hot-path lookups (Phase 4 owns the cache).

Composite PK ``(scope, key)`` lets a single row track each `(scope, key)`
pair without an extra index.
"""

from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base


class AuthRateLimit(Base):
    """Persistent rate-limit counter (PRD §15 — `auth_rate_limits` table)."""

    __tablename__: str = "auth_rate_limits"

    scope: Mapped[str] = mapped_column(String, primary_key=True)
    key: Mapped[str] = mapped_column(String, primary_key=True)
    counter: Mapped[int] = mapped_column(default=0, nullable=False)
    window_start: Mapped[datetime] = mapped_column(nullable=False)
    backoff_delay: Mapped[int] = mapped_column(default=0, nullable=False)
    last_failure_at: Mapped[datetime | None] = mapped_column(nullable=True)
