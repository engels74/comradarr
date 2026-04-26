"""``priority_searches`` table — operator-injected search jumps (PRD §10).

When an operator clicks "search now" on a row, Phase 10 inserts here and the
rotation engine pops the row out of band — bypassing the tier/last-searched
ordering. ``consumed_at`` is set when rotation services the request, leaving a
forensic trail. The composite UNIQUE ``(connector_id, content_type,
content_arr_id)`` prevents accidental dupes when an operator double-clicks.

A surrogate UUIDv7 PK keeps the row addressable by the audit-log writer; the
unique constraint is the operationally-meaningful identity.
"""

import uuid  # noqa: TC003 — SQLAlchemy resolves `Mapped[uuid.UUID]` at runtime
from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base, uuid_v7_pk_default
from comradarr.db.enums import ContentType


class PrioritySearch(Base):
    """Operator-injected priority-search request (PRD §10)."""

    __tablename__: str = "priority_searches"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid_v7_pk_default,
    )
    connector_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("connectors.id", ondelete="CASCADE"),
        nullable=False,
    )
    content_type: Mapped[ContentType] = mapped_column(
        SAEnum(
            ContentType,
            native_enum=True,
            name="content_type",
            values_callable=lambda e: [m.value for m in e],  # pyright: ignore[reportUnknownLambdaType, reportUnknownMemberType, reportUnknownVariableType]
        ),
        nullable=False,
    )
    content_arr_id: Mapped[int] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__: tuple[UniqueConstraint, ...] = (  # noqa: RUF012  # SQLA convention
        UniqueConstraint(
            "connector_id",
            "content_type",
            "content_arr_id",
            name="uq_priority_searches_target",
        ),
    )
