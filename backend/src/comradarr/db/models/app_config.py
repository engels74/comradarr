"""``app_config`` + ``app_secrets`` tables — singleton-style key/value stores.

Two tables, one module: the plaintext-public key/value store sits next to its
encrypted-secret companion so the policy boundary between them is obvious to
readers. The split is deliberate (Phase 2 plan §6 R9) — merging them fights
the AAD convention used by Phase 3's cipher (the AAD prefix differs per
table) and forces every plaintext read to traverse cipher code.

* ``app_config`` — plaintext singletons (e.g. UI settings, admin flags).
* ``app_secrets`` — encrypted singletons (e.g. ``setup_claim`` proof key per
  Phase 5 §5.5.3, AAD ``app_config:setup_claim:proof``).

Phase 2 ships only the column shape; Phase 3 owns the AES-256-GCM cipher that
fills the encrypted columns.
"""

from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base
from comradarr.db.encrypted import EncryptedField


class AppConfig(Base):
    """A plaintext app-wide config key/value pair (Phase 2 plan §M5 step 18)."""

    __tablename__: str = "app_config"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(nullable=False)


class AppSecret(Base):
    """An encrypted app-wide secret key/value pair (Phase 2 plan §M5 step 18).

    The setup-claim proof key (``setup_claim``) lives here per Phase 5 §5.5.3
    with AAD ``app_config:setup_claim:proof``. Phase 3 owns the cipher that
    fills the four encrypted columns.
    """

    __tablename__: str = "app_secrets"

    key: Mapped[str] = mapped_column(String, primary_key=True)

    # Phase 3 fills these via AES-256-GCM with the per-row AAD anchored on the
    # logical ``key`` column. The helper returns a 4-tuple of `mapped_column`
    # instances under column names ``value_{nonce,ciphertext,tag,key_version}``;
    # index into it so each class attribute carries its declared `Mapped[...]`
    # type without spawning underscore-temp columns.
    _value_columns: tuple[
        Mapped[bytes | None],
        Mapped[bytes | None],
        Mapped[bytes | None],
        Mapped[int | None],
    ] = EncryptedField("value")
    value_nonce: Mapped[bytes | None] = _value_columns[0]
    value_ciphertext: Mapped[bytes | None] = _value_columns[1]
    value_tag: Mapped[bytes | None] = _value_columns[2]
    value_key_version: Mapped[int | None] = _value_columns[3]

    updated_at: Mapped[datetime] = mapped_column(nullable=False)
