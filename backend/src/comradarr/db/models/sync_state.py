"""``sync_state`` table — per-connector mirror-sync ledger (Phase 9).

Phase 9's mirror sync engine writes here once per pass: ``last_full_at``,
``last_deep_at``, and ``last_incremental_at`` are the three independent rhythms
the engine maintains. ``fingerprint`` carries the engine's view of the
upstream state hash so a connector that briefly disappears does not trigger a
full re-sync on its next reachable poll.

The PK is ``connector_id`` (1:1 with ``connectors``) — there is at most one
active sync state per connector, and the row is recreated on connector
re-creation rather than carrying a surrogate UUID.
"""

import uuid  # noqa: TC003 — SQLAlchemy resolves `Mapped[uuid.UUID]` at runtime
from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base
from comradarr.db.enums import SyncStatus


class SyncState(Base):
    """Per-connector mirror-sync ledger (Phase 9)."""

    __tablename__: str = "sync_state"

    connector_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("connectors.id", ondelete="CASCADE"),
        primary_key=True,
    )
    last_full_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_deep_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_incremental_at: Mapped[datetime | None] = mapped_column(nullable=True)
    fingerprint: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
    )
    status: Mapped[SyncStatus] = mapped_column(
        SAEnum(
            SyncStatus,
            native_enum=True,
            name="sync_status",
            values_callable=lambda e: [m.value for m in e],  # pyright: ignore[reportUnknownLambdaType, reportUnknownMemberType, reportUnknownVariableType]
        ),
        nullable=False,
        default=SyncStatus.IDLE,
    )
    last_error: Mapped[str | None] = mapped_column(String, nullable=True)
    items_synced: Mapped[int] = mapped_column(default=0, nullable=False)
    duration_ms: Mapped[int] = mapped_column(default=0, nullable=False)
