"""Notification tables — channels, routes, templates (PRD §12 / Phase 12).

Three cohesive tables share one module because they are routinely read
together (a route resolves to a channel + a template at dispatch time):

* ``notification_channels`` — per-user transport configuration with encrypted
  channel-specific config blob (e.g. SMTP password, webhook secret).
* ``notification_routes`` — per-user mapping of event types onto channels with
  an optional JSONB predicate for filtering.
* ``notification_templates`` — per-user (event_type, channel_kind) message
  templates. Composite PK matches the unique constraint exactly — no
  surrogate UUID (Phase 2 plan §6 Q2).

Phase 2 ships only the column shape; Phase 12 owns the dispatcher and Phase 3
owns the AES-256-GCM cipher that fills the encrypted ``config_*`` columns.
"""

import uuid  # noqa: TC003 — SQLAlchemy resolves `Mapped[uuid.UUID]` at runtime
from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import Boolean, ForeignKey, Index, String, Uuid
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base, uuid_v7_pk_default
from comradarr.db.encrypted import EncryptedField
from comradarr.db.enums import ChannelKind, ChannelTestStatus


class NotificationChannel(Base):
    """A configured notification transport for one user (Phase 2 plan §M5 step 20)."""

    __tablename__: str = "notification_channels"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid_v7_pk_default,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[ChannelKind] = mapped_column(
        SAEnum(
            ChannelKind,
            native_enum=True,
            name="channel_kind",
            values_callable=lambda e: [m.value for m in e],  # pyright: ignore[reportUnknownLambdaType, reportUnknownMemberType, reportUnknownVariableType]
        ),
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Phase 3 fills these via AES-256-GCM with the per-row AAD anchored on the
    # channel ``id``. The helper returns a 4-tuple of `mapped_column` instances
    # under column names ``config_{nonce,ciphertext,tag,key_version}``; index
    # into it so each class attribute carries its declared `Mapped[...]` type
    # without spawning underscore-temp columns.
    _config_columns: tuple[
        Mapped[bytes | None],
        Mapped[bytes | None],
        Mapped[bytes | None],
        Mapped[int | None],
    ] = EncryptedField("config")
    config_nonce: Mapped[bytes | None] = _config_columns[0]
    config_ciphertext: Mapped[bytes | None] = _config_columns[1]
    config_tag: Mapped[bytes | None] = _config_columns[2]
    config_key_version: Mapped[int | None] = _config_columns[3]

    insecure_skip_tls_verify: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    tls_ca_bundle_path: Mapped[str | None] = mapped_column(String, nullable=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_test_status: Mapped[ChannelTestStatus] = mapped_column(
        SAEnum(
            ChannelTestStatus,
            native_enum=True,
            name="channel_test_status",
            values_callable=lambda e: [m.value for m in e],  # pyright: ignore[reportUnknownLambdaType, reportUnknownMemberType, reportUnknownVariableType]
        ),
        nullable=False,
        default=ChannelTestStatus.UNTESTED,
    )

    __table_args__: tuple[Index, ...] = (  # noqa: RUF012  # SQLA convention
        Index("ix_notification_channels_user_id", "user_id"),
        Index("ix_notification_channels_enabled_kind", "enabled", "kind"),
    )


class NotificationRoute(Base):
    """A per-user (event_type, channel) routing rule (Phase 2 plan §M5 step 20)."""

    __tablename__: str = "notification_routes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    event_type: Mapped[str] = mapped_column(String, primary_key=True)
    channel_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("notification_channels.id", ondelete="CASCADE"),
        primary_key=True,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    predicate: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)

    __table_args__: tuple[Index, ...] = (  # noqa: RUF012  # SQLA convention
        Index("ix_notification_routes_user_event", "user_id", "event_type"),
    )


class NotificationTemplate(Base):
    """A per-user (event_type, channel_kind) message template.

    Composite PK matches the unique constraint exactly; no surrogate UUID is
    issued (Phase 2 plan §6 Q2 — keeps the shape minimal and de-duplicates
    the natural-key + uniqueness invariant).
    """

    __tablename__: str = "notification_templates"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    event_type: Mapped[str] = mapped_column(String, primary_key=True)
    channel_kind: Mapped[ChannelKind] = mapped_column(
        SAEnum(
            ChannelKind,
            native_enum=True,
            name="channel_kind",
            values_callable=lambda e: [m.value for m in e],  # pyright: ignore[reportUnknownLambdaType, reportUnknownMemberType, reportUnknownVariableType]
        ),
        primary_key=True,
    )
    subject_template: Mapped[str] = mapped_column(String, nullable=False)
    body_template: Mapped[str] = mapped_column(String, nullable=False)
