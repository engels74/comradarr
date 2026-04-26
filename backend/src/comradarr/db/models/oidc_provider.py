"""``oidc_providers`` table — per-provider OIDC configuration (PRD §15).

The PK is ``short_name`` (the operator-chosen identifier visible in URLs and
the UI), not a UUID surrogate, because the short name is the natural key the
session row references via ``sessions.oidc_provider_name`` and the OIDC
callback URL embeds.

The client secret lives in 4 encrypted columns produced by
:func:`comradarr.db.encrypted.EncryptedField`. Phase 2 ships only the
column shape; Phase 3 owns the AES-256-GCM cipher that fills them.
"""

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base
from comradarr.db.encrypted import EncryptedField


class OIDCProvider(Base):
    """A configured OIDC identity provider (PRD §15 — `oidc_providers`)."""

    __tablename__: str = "oidc_providers"

    short_name: Mapped[str] = mapped_column(String, primary_key=True)
    issuer_url: Mapped[str] = mapped_column(String, nullable=False)
    client_id: Mapped[str] = mapped_column(String, nullable=False)

    # Phase 3 fills these via AES-256-GCM with `short_name` as the AAD anchor.
    # The helper returns a 4-tuple of `mapped_column(...)` instances under the
    # column names ``client_secret_{nonce,ciphertext,tag,key_version}``; index
    # into it so each class attribute carries its declared `Mapped[...]` type
    # without spawning underscore-temp columns.
    _client_secret_columns: tuple[
        Mapped[bytes | None],
        Mapped[bytes | None],
        Mapped[bytes | None],
        Mapped[int | None],
    ] = EncryptedField("client_secret")
    client_secret_nonce: Mapped[bytes | None] = _client_secret_columns[0]
    client_secret_ciphertext: Mapped[bytes | None] = _client_secret_columns[1]
    client_secret_tag: Mapped[bytes | None] = _client_secret_columns[2]
    client_secret_key_version: Mapped[int | None] = _client_secret_columns[3]

    display_name: Mapped[str] = mapped_column(String, nullable=False)
    scope_list: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=lambda: ["openid", "email", "profile"],
    )
    discovery_url: Mapped[str] = mapped_column(String, nullable=False)
    discovery_cache: Mapped[dict[str, object] | None] = mapped_column(
        JSONB,
        nullable=True,
    )
