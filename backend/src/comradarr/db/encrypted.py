"""``EncryptedField(name)`` 4-column ORM helper (plan §3 Milestone 1 step 2).

Phase 2 ships **structural columns only** — there is no crypto here. Phase 3
populates the columns with AES-256-GCM ciphertext, nonce, and tag values, and
maintains the active key version. Keeping the helper structurally separate
lets Phase 2's migration, repositories, and tests land independently of the
cipher rollout.

Usage (tuple-unpacking on the class body)::

    class Connector(Base):
        __tablename__ = "connectors"
        id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid_v7_pk_default)
        # 4 columns: api_key_nonce, api_key_ciphertext, api_key_tag,
        # api_key_key_version — Phase 3 fills them in.
        (
            api_key_nonce,
            api_key_ciphertext,
            api_key_tag,
            api_key_key_version,
        ) = EncryptedField("api_key")

The four columns are all nullable in v1: the schema lands before the cipher
exists, so historical rows must be allowed to carry NULL until Phase 3
backfills (decision pinned in Phase 2 plan §6 Q5). A follow-up migration may
tighten ``NOT NULL`` after Phase 3 ships and runs.

Column-name shape (stable across the spike's tuple form vs. the documented
mixin fallback) — referenced by tests and Phase 3 cipher integration::

    {name}_nonce         BYTEA     NULL
    {name}_ciphertext    BYTEA     NULL
    {name}_tag           BYTEA     NULL
    {name}_key_version   SMALLINT  NULL
"""

from sqlalchemy import LargeBinary, SmallInteger
from sqlalchemy.orm import Mapped, mapped_column


def EncryptedField(  # noqa: N802 — factory mirroring SQLAlchemy declarative idioms.
    name: str,
) -> tuple[
    Mapped[bytes | None],
    Mapped[bytes | None],
    Mapped[bytes | None],
    Mapped[int | None],
]:
    """Return the 4 mapped columns that make up an encrypted field.

    Parameters
    ----------
    name:
        Logical field name (e.g. ``"api_key"``, ``"client_secret"``). The
        produced column names are namespaced under this prefix so multiple
        encrypted fields can co-exist on the same model.

    Returns
    -------
    tuple
        ``(<name>_nonce, <name>_ciphertext, <name>_tag, <name>_key_version)``
        ready for tuple-unpacking on a declarative class body.
    """
    nonce: Mapped[bytes | None] = mapped_column(
        f"{name}_nonce",
        LargeBinary,
        nullable=True,
    )
    ciphertext: Mapped[bytes | None] = mapped_column(
        f"{name}_ciphertext",
        LargeBinary,
        nullable=True,
    )
    tag: Mapped[bytes | None] = mapped_column(
        f"{name}_tag",
        LargeBinary,
        nullable=True,
    )
    key_version: Mapped[int | None] = mapped_column(
        f"{name}_key_version",
        SmallInteger,
        nullable=True,
    )
    return nonce, ciphertext, tag, key_version
