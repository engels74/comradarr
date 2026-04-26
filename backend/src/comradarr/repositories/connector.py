"""Connector repository — read-only in v1 (plan §3 Milestone 9 step 37).

Phase 2 ships only the queries that don't touch the encrypted ``api_key_*``
columns: looking up a connector by id, listing the unpaused fleet, and
flipping the ``paused`` bit. Writers that mint or rotate an API key are
**deliberately** absent because their semantics depend on Phase 3's
AES-256-GCM cipher; landing them now would either ship dead structural code
or a placeholder that future callers have to remember not to call. Plan §6
P4 ("ship structure independent of crypto") pins this contract.

Phase 4+ adds: ``add(...)``, ``update_api_key(...)``, ``rotate_api_key(...)``.
"""

import uuid  # noqa: TC003 — runtime use in method signatures

from sqlalchemy import select, update

from comradarr.db.models.connector import Connector
from comradarr.repositories.base import BaseRepository


class ConnectorRepository(BaseRepository):
    """Read-side queries against ``connectors`` (PRD §13)."""

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
        UPDATE set. Phase 3 owns key rotation; this method's job is the
        operator-facing "pause/resume" toggle only.
        """
        stmt = update(Connector).where(Connector.id == connector_id).values(paused=paused)
        _ = await self.session.execute(stmt)
