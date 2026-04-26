"""``audit_log`` table — append-only security/operational audit trail (PRD §11).

The audit log is the schema-level carve-out of Comradarr's role model. The
v1 baseline migration grants ``comradarr_app`` only ``SELECT, INSERT`` on
this table; ``UPDATE`` and ``DELETE`` belong exclusively to
``comradarr_audit_admin`` (the retention vacuum target). The ORM model below
declares the column shape only — there are intentionally no model-level
``update`` / ``delete`` helpers for this table; writes from app code are
INSERT-only and the GRANT matrix enforces it at the database boundary.

``actor_user_id`` is FK→``users.id`` ON DELETE **SET NULL** (NOT cascade —
Phase 2 plan §6 R6 + Q3). Audit history must outlive the user it references;
deleting a user nulls the FK while preserving every row that mentions them.

``correlation_id`` is propagated from structlog request context per
RULE-LOG-001 + PRD §21 so audit rows can be joined to log streams.

``previous_hash`` / ``content_hash`` are reserved-NULL in v1 — the hash-chain
audit feature is deferred to PRD §29 Backlog. The columns exist now so the
schema is forward-compatible without a follow-up migration.

Index discipline: model-side ``Index`` declarations document the intended
``(timestamp DESC)`` and ``(action, timestamp DESC)`` ordering. Wave 2's
migration hand-patches the actual DESC ordering via
``postgresql_ops={"timestamp": "DESC"}`` — autogenerate emits ascending
indexes; the DESC switch is documentation here and behavior in the migration.
"""

import uuid  # noqa: TC003 — SQLAlchemy resolves `Mapped[uuid.UUID]` at runtime
from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Index, LargeBinary, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base, uuid_v7_pk_default
from comradarr.db.enums import AuditAction


class AuditLog(Base):
    """An append-only audit row (PRD §11 — `audit_log` table)."""

    __tablename__: str = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid_v7_pk_default,
    )
    timestamp: Mapped[datetime] = mapped_column(nullable=False)
    action: Mapped[AuditAction] = mapped_column(
        SAEnum(
            AuditAction,
            native_enum=True,
            name="audit_action",
            values_callable=lambda e: [m.value for m in e],  # pyright: ignore[reportUnknownLambdaType, reportUnknownMemberType, reportUnknownVariableType]
        ),
        nullable=False,
    )
    # SET NULL — preserve audit history past user deletion (Phase 2 plan §6 R6/Q3).
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    actor_ip: Mapped[str | None] = mapped_column(String, nullable=True)
    context: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
    )
    ip: Mapped[str | None] = mapped_column(String, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String, nullable=True)
    # Propagated from structlog request context per RULE-LOG-001 + PRD §21.
    correlation_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    # Reserved-NULL in v1; hash-chain audit is deferred to PRD §29 Backlog.
    previous_hash: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    content_hash: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    # Wave 2's migration switches these to DESC via `postgresql_ops`; the
    # model-side declaration documents intent and keeps autogenerate aware
    # of the indexes' existence.
    __table_args__: tuple[Index, ...] = (  # noqa: RUF012  # SQLA convention
        Index("ix_audit_log_timestamp_desc", "timestamp"),
        Index("ix_audit_log_action_timestamp_desc", "action", "timestamp"),
    )
