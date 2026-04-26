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

from typing import TYPE_CHECKING, final

from sqlalchemy import LargeBinary, SmallInteger
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.core.crypto import CryptoService, EncryptedBlob
from comradarr.errors.crypto import CryptoError

if TYPE_CHECKING:
    from comradarr.core.types import Secret


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


@final
class EncryptedFieldCodec:
    """Adapter binding :class:`CryptoService` to a single ``(table, column)`` pair.

    The codec is the only sanctioned way to translate between the four
    nullable storage columns produced by :func:`EncryptedField` and a
    :class:`Secret` plaintext. Centralizing the encode/decode pair here
    enforces three invariants that would otherwise drift across repository
    code:

    * The AAD is built from :meth:`CryptoService.aad_for` using the codec's
      pinned ``(table, column)`` plus the row's primary key — every
      encrypted column on every row binds its triple, so a ciphertext copied
      between rows or columns fails to decrypt loudly.
    * Decode rejects partial column tuples. ALL four columns NULL means "no
      value stored" (returns :data:`None`); SOME-but-not-all NULL means the
      row is corrupt and must surface as :class:`CryptoError` rather than
      silently round-tripping a sentinel.
    * The ``row_pk`` is stringified at the codec boundary (callers pass
      ``str(uuid)`` or similar) so the AAD bytes match across encrypt and
      decrypt regardless of the source representation.
    """

    __slots__: tuple[str, ...] = ("_column", "_crypto", "_table")

    _crypto: CryptoService
    _table: str
    _column: str

    def __init__(self, crypto: CryptoService, table: str, column: str) -> None:
        self._crypto = crypto
        self._table = table
        self._column = column

    def encode(self, plaintext: Secret[bytes], row_pk: str) -> tuple[bytes, bytes, bytes, int]:
        """Encrypt ``plaintext`` and return the 4-column storage tuple.

        Returns ``(nonce, ciphertext, tag, key_version)`` ready to fan out
        into the four ``EncryptedField`` columns. The AAD binds
        ``(table, row_pk, column)`` so a ciphertext relocated to a different
        row will fail :meth:`decode` with :class:`CryptoAuthenticationFailed`.
        """
        aad = self._crypto.aad_for(self._table, row_pk, self._column)
        blob = self._crypto.encrypt(plaintext, aad)
        return blob.nonce, blob.ciphertext, blob.tag, blob.key_version

    def decode(
        self,
        nonce: bytes | None,
        ciphertext: bytes | None,
        tag: bytes | None,
        key_version: int | None,
        row_pk: str,
    ) -> Secret[bytes] | None:
        """Decrypt the 4-column storage tuple back to a :class:`Secret`.

        Returns :data:`None` when **all four** columns are NULL (the
        sanctioned "no value stored" shape). Raises :class:`CryptoError`
        when **some but not all** columns are NULL — that combination is a
        partial write and must never round-trip silently.
        """
        # match-statement narrows each binding for the type checker without
        # using ``assert`` (which ruff S101 forbids in production code).
        match nonce, ciphertext, tag, key_version:
            case (None, None, None, None):
                return None
            case (bytes() as n, bytes() as c, bytes() as t, int() as v):
                blob = EncryptedBlob(nonce=n, ciphertext=c, tag=t, key_version=v)
                aad = self._crypto.aad_for(self._table, row_pk, self._column)
                return self._crypto.decrypt(blob, aad)
            case _:
                msg = "incomplete EncryptedField tuple"
                raise CryptoError(msg)
