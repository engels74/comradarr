"""``app_secrets`` repository — encrypted singleton key/value store (plan §5.3.5).

Each row in ``app_secrets`` carries a :class:`Secret` plaintext encrypted
under the active key version with a per-row AAD. Two AAD shapes are bound
deliberately:

* The ``setup_claim`` row uses the AAD ``app_config:setup_claim:proof``
  (Phase 5 §5.5.3 frozen contract — the bootstrap proof key historically
  lived in the ``app_config`` table before the encrypted/plaintext split,
  and the AAD is preserved across the migration so old ciphertexts decrypt).
* Every other row uses ``app_secrets:<key>:value`` — the standard
  ``<table>:<row_pk>:<column>`` shape produced by
  :meth:`CryptoService.aad_for`.

The custom AAD for ``setup_claim`` means this repo cannot ride
:class:`EncryptedFieldCodec` (which is hard-bound to a single
``(table, column)`` pair and would emit ``app_secrets:setup_claim:value``
universally). Instead it calls :class:`CryptoService.encrypt` /
:meth:`decrypt` directly with hand-built AAD bytes. The four-column
NULL-shape contract — ALL-NULL means "absent", SOME-NULL means corrupt —
mirrors the codec's invariant.
"""

from datetime import UTC, datetime
from typing import final

from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 — runtime DI: Litestar resolves AsyncSession at request time
)

from comradarr.core.crypto import (
    CryptoService,  # noqa: TC001 — runtime DI: lifespan injects the singleton
    EncryptedBlob,
)
from comradarr.core.types import (
    Secret,  # noqa: TC001 — runtime use in method signatures
)
from comradarr.db.models.app_config import AppSecret
from comradarr.errors.crypto import CryptoError
from comradarr.repositories.base import BaseRepository

_SETUP_CLAIM_AAD: bytes = b"app_config:setup_claim:proof"


@final
class AppSecretsRepository(BaseRepository):
    """Get/put encrypted singleton secrets keyed on the logical name."""

    _crypto: CryptoService

    def __init__(self, session: AsyncSession, crypto: CryptoService) -> None:
        super().__init__(session)
        self._crypto = crypto

    @staticmethod
    def _aad_for(key: str) -> bytes:
        """Return the per-row AAD bytes for ``key``.

        ``setup_claim`` is the documented exception — its AAD is pinned to
        ``app_config:setup_claim:proof`` (Phase 5 §5.5.3 contract). Every
        other key follows the canonical ``app_secrets:<key>:value`` shape.
        """
        if key == "setup_claim":
            return _SETUP_CLAIM_AAD
        return f"app_secrets:{key}:value".encode()

    async def get(self, key: str) -> Secret[bytes] | None:
        """Decrypt and return the secret for ``key``, or ``None`` if absent.

        Returns :data:`None` when the row is missing or when all four
        ``value_*`` columns are NULL (the canonical "stored shape with no
        value yet" state). Raises :class:`CryptoError` on partial-NULL.
        """
        row = await self.session.get(AppSecret, key)
        if row is None:
            return None
        match row.value_nonce, row.value_ciphertext, row.value_tag, row.value_key_version:
            case (None, None, None, None):
                return None
            case (bytes() as nonce, bytes() as ciphertext, bytes() as tag, int() as version):
                blob = EncryptedBlob(
                    nonce=nonce,
                    ciphertext=ciphertext,
                    tag=tag,
                    key_version=version,
                )
                return self._crypto.decrypt(blob, self._aad_for(key))
            case _:
                msg = "incomplete app_secrets value tuple"
                raise CryptoError(msg)

    async def put(self, key: str, plaintext: Secret[bytes]) -> None:
        """Upsert ``key`` with the encrypted ``plaintext``.

        Existing rows are updated in place (preserving the row's identity
        for any FK referrers); missing rows are inserted. Either path lands
        a fresh nonce + ciphertext + tag + key_version under the canonical
        AAD for the key.
        """
        blob = self._crypto.encrypt(plaintext, self._aad_for(key))
        now = datetime.now(UTC)
        existing = await self.session.get(AppSecret, key)
        if existing is None:
            self.session.add(
                AppSecret(
                    key=key,
                    value_nonce=blob.nonce,
                    value_ciphertext=blob.ciphertext,
                    value_tag=blob.tag,
                    value_key_version=blob.key_version,
                    updated_at=now,
                ),
            )
        else:
            existing.value_nonce = blob.nonce
            existing.value_ciphertext = blob.ciphertext
            existing.value_tag = blob.tag
            existing.value_key_version = blob.key_version
            existing.updated_at = now
        await self.session.flush()
