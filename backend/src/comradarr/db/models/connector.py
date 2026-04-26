"""``connectors`` table — outbound *arr-flavored connector rows (PRD §13).

A connector represents one configured upstream Sonarr / Radarr / Prowlarr
instance. Phase 7 owns the HTTP client; Phase 2 ships only the schema. The
API key lives in 4 encrypted columns produced by
:func:`comradarr.db.encrypted.EncryptedField`. Phase 3 owns the AES-256-GCM
cipher that fills them.

The ``per_connector_limits`` JSONB column carries optional per-connector
overrides for global rate / concurrency limits (Phase 7); shape is intentionally
loose (``dict[str, object]``) because the limit policy schema is not frozen
until Phase 7 ships.
"""

import uuid  # noqa: TC003 — SQLAlchemy resolves `Mapped[uuid.UUID]` at runtime
from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import Boolean, String, Uuid
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base, uuid_v7_pk_default
from comradarr.db.encrypted import EncryptedField
from comradarr.db.enums import ConnectorType


class Connector(Base):
    """A configured outbound *arr connector (PRD §13 — `connectors`)."""

    __tablename__: str = "connectors"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid_v7_pk_default,
    )
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    type: Mapped[ConnectorType] = mapped_column(
        SAEnum(ConnectorType, native_enum=True, name="connector_type"),
        nullable=False,
    )
    url: Mapped[str] = mapped_column(String, nullable=False)

    # Phase 3 fills these via AES-256-GCM with `id` as the AAD anchor. The
    # helper returns a 4-tuple of `mapped_column(...)` instances under the
    # column names ``api_key_{nonce,ciphertext,tag,key_version}``; index into
    # it so each class attribute carries its declared `Mapped[...]` type
    # without spawning underscore-temp columns.
    _api_key_columns: tuple[
        Mapped[bytes | None],
        Mapped[bytes | None],
        Mapped[bytes | None],
        Mapped[int | None],
    ] = EncryptedField("api_key")
    api_key_nonce: Mapped[bytes | None] = _api_key_columns[0]
    api_key_ciphertext: Mapped[bytes | None] = _api_key_columns[1]
    api_key_tag: Mapped[bytes | None] = _api_key_columns[2]
    api_key_key_version: Mapped[int | None] = _api_key_columns[3]

    per_connector_limits: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
    )
    insecure_skip_tls_verify: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    tls_ca_bundle_path: Mapped[str | None] = mapped_column(String, nullable=True)
    paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(nullable=False)
    updated_at: Mapped[datetime] = mapped_column(nullable=False)
