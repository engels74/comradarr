"""Connector repository — read + crypto-bound writers (plan §3 M9 step 37 + §5.3.5).

Phase 2 shipped only queries that don't touch the encrypted ``api_key_*``
columns: looking up a connector by id, listing the unpaused fleet, and
flipping the ``paused`` bit. Phase 3 adds the writers that mint the API key
through :class:`EncryptedFieldCodec` so the four ``api_key_*`` columns land
together with their per-row AAD anchored on the connector's UUID PK.

The PK is generated **Python-side** (via :func:`uuid_v7_pk_default`) before
the INSERT so the AAD bytes used at encrypt time are identical to those used
at decrypt time. Letting the database default the PK would race the AAD
construction.
"""

import uuid  # noqa: TC003 — runtime use in method signatures
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 — runtime DI: Litestar resolves AsyncSession at request time
)

from comradarr.core.crypto import (
    CryptoService,  # noqa: TC001 — runtime DI: lifespan injects the singleton
)
from comradarr.core.types import (
    Secret,  # noqa: TC001 — runtime use in method signatures
)
from comradarr.db.base import uuid_v7_pk_default
from comradarr.db.encrypted import EncryptedFieldCodec
from comradarr.db.enums import (
    ConnectorType,  # noqa: TC001 — runtime use in method signatures
)
from comradarr.db.models.connector import Connector
from comradarr.repositories.base import BaseRepository


class ConnectorRepository(BaseRepository):
    """Read + insert/update over ``connectors`` (PRD §13)."""

    _api_key_codec: EncryptedFieldCodec

    def __init__(self, session: AsyncSession, crypto: CryptoService) -> None:
        super().__init__(session)
        self._api_key_codec = EncryptedFieldCodec(crypto, "connectors", "api_key")

    async def get_by_id(self, connector_id: uuid.UUID) -> Connector | None:
        """Return the connector with the given id, or ``None`` if absent."""
        return await self.session.get(Connector, connector_id)

    async def list_active(self) -> list[Connector]:
        """Return every connector whose ``paused`` flag is ``False``."""
        stmt = select(Connector).where(Connector.paused.is_(False))
        result = await self.session.scalars(stmt)
        return list(result.all())

    async def pause(self, connector_id: uuid.UUID, *, paused: bool) -> None:
        """Flip the connector's ``paused`` flag without touching other columns.

        Encrypted ``api_key_*`` columns are deliberately excluded from the
        UPDATE set — key rotation is a separate writer (Phase 30).
        """
        stmt = update(Connector).where(Connector.id == connector_id).values(paused=paused)
        _ = await self.session.execute(stmt)

    async def add(
        self,
        *,
        name: str,
        type: ConnectorType,  # noqa: A002 — mirrors the Connector ORM column name
        url: str,
        api_key: Secret[bytes],
        per_connector_limits: dict[str, object] | None = None,
        insecure_skip_tls_verify: bool = False,
        tls_ca_bundle_path: str | None = None,
    ) -> Connector:
        """Insert a new connector with an AES-GCM-encrypted ``api_key``.

        The PK is minted Python-side so the AAD ``connectors:<id>:api_key``
        binds the same row id at encrypt and decrypt time.
        """
        connector_id = uuid_v7_pk_default()
        nonce, ciphertext, tag, key_version = self._api_key_codec.encode(
            api_key,
            str(connector_id),
        )
        now = datetime.now(UTC)
        row = Connector(
            id=connector_id,
            name=name,
            type=type,
            url=url,
            api_key_nonce=nonce,
            api_key_ciphertext=ciphertext,
            api_key_tag=tag,
            api_key_key_version=key_version,
            per_connector_limits=per_connector_limits if per_connector_limits is not None else {},
            insecure_skip_tls_verify=insecure_skip_tls_verify,
            tls_ca_bundle_path=tls_ca_bundle_path,
            paused=False,
            created_at=now,
            updated_at=now,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def get_api_key(self, connector_id: uuid.UUID) -> Secret[bytes] | None:
        """Decrypt and return the connector's ``api_key`` plaintext.

        Returns :data:`None` when the connector row is absent or all four
        ``api_key_*`` columns are NULL. A partial-NULL combination raises
        :class:`comradarr.errors.crypto.CryptoError` (delegated to the
        codec).
        """
        row = await self.session.get(Connector, connector_id)
        if row is None:
            return None
        return self._api_key_codec.decode(
            row.api_key_nonce,
            row.api_key_ciphertext,
            row.api_key_tag,
            row.api_key_key_version,
            str(connector_id),
        )
