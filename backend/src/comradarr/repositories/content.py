"""Content repository — cursor-paginated reads over ``mirror_*`` tables.

Phase 9 owns the sync engine that writes these rows; Phase 2 ships only the
read API the BFF + rotation engine consume. Each list method orders by
``arr_id`` (the upstream natural key, monotonically issued by Sonarr/Radarr)
and pages via :mod:`comradarr.repositories._pagination` keysets.

Mirror rows have **composite primary keys** ``(connector_id, arr_id)``, but
keyset pagination is performed within a single connector at a time — the
caller passes ``connector_id`` as a filter, so the pagination keyset reduces
to ``(arr_id,)``. The :func:`_pagination.apply` helper expects a single
``id`` column, so these methods page by ``arr_id`` directly via tuple
ordering instead of routing through ``apply`` (which assumes a UUID id).
"""

import uuid  # noqa: TC003 — runtime use in method signatures

from sqlalchemy import select

from comradarr.db.models.mirror import MirrorEpisodes, MirrorMovies, MirrorSeries
from comradarr.repositories.base import BaseRepository


class ContentRepository(BaseRepository):
    """Read-only access to ``mirror_series``, ``mirror_episodes``, ``mirror_movies``."""

    async def list_series(
        self,
        connector_id: uuid.UUID,
        *,
        after_arr_id: int | None = None,
        limit: int = 50,
    ) -> list[MirrorSeries]:
        """Page series for one connector, ordered by upstream ``arr_id``."""
        stmt = select(MirrorSeries).where(MirrorSeries.connector_id == connector_id)
        if after_arr_id is not None:
            stmt = stmt.where(MirrorSeries.arr_id > after_arr_id)
        stmt = stmt.order_by(MirrorSeries.arr_id).limit(limit + 1)
        result = await self.session.scalars(stmt)
        return list(result.all())

    async def list_episodes(
        self,
        connector_id: uuid.UUID,
        *,
        series_arr_id: int | None = None,
        season_number: int | None = None,
        after_arr_id: int | None = None,
        limit: int = 100,
    ) -> list[MirrorEpisodes]:
        """Page episodes for one connector, optionally scoped to a season."""
        stmt = select(MirrorEpisodes).where(
            MirrorEpisodes.connector_id == connector_id,
        )
        if series_arr_id is not None:
            stmt = stmt.where(MirrorEpisodes.series_arr_id == series_arr_id)
        if season_number is not None:
            stmt = stmt.where(MirrorEpisodes.season_number == season_number)
        if after_arr_id is not None:
            stmt = stmt.where(MirrorEpisodes.arr_id > after_arr_id)
        stmt = stmt.order_by(MirrorEpisodes.arr_id).limit(limit + 1)
        result = await self.session.scalars(stmt)
        return list(result.all())

    async def list_movies(
        self,
        connector_id: uuid.UUID,
        *,
        after_arr_id: int | None = None,
        limit: int = 50,
    ) -> list[MirrorMovies]:
        """Page movies for one connector, ordered by upstream ``arr_id``."""
        stmt = select(MirrorMovies).where(MirrorMovies.connector_id == connector_id)
        if after_arr_id is not None:
            stmt = stmt.where(MirrorMovies.arr_id > after_arr_id)
        stmt = stmt.order_by(MirrorMovies.arr_id).limit(limit + 1)
        result = await self.session.scalars(stmt)
        return list(result.all())

    async def get_series(
        self,
        connector_id: uuid.UUID,
        arr_id: int,
    ) -> MirrorSeries | None:
        """Return one series row by its composite ``(connector_id, arr_id)`` key."""
        return await self.session.get(MirrorSeries, (connector_id, arr_id))

    async def get_movie(
        self,
        connector_id: uuid.UUID,
        arr_id: int,
    ) -> MirrorMovies | None:
        """Return one movie row by its composite ``(connector_id, arr_id)`` key."""
        return await self.session.get(MirrorMovies, (connector_id, arr_id))
