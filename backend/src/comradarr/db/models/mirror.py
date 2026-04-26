"""Mirror tables — local cache of upstream *arr content (PRD §13 / Appendix B).

Three tables share this module because they form a single cohesive surface
that Phase 9's sync engine populates atomically per connector:

* ``mirror_series``    — Sonarr series rows.
* ``mirror_episodes``  — Sonarr episodes (one row per episode).
* ``mirror_movies``    — Radarr movies.

Each row is keyed by the composite ``(connector_id, arr_id)`` because the
upstream ``arr_id`` is only unique within a given connector — two Sonarr
instances can both expose ``series 42`` and they refer to different shows.
``ON DELETE CASCADE`` on ``connector_id`` lets removing a connector wipe its
mirror rows in a single statement (plan §6 R6).

The ``meta`` JSONB column stores upstream fields the schema does not project
into typed columns (e.g. genres, network tags, runtime); shape is intentionally
loose because the *arr APIs evolve outside our control.
"""

import uuid  # noqa: TC003 — SQLAlchemy resolves `Mapped[uuid.UUID]` at runtime
from datetime import date  # noqa: TC003 — SQLAlchemy resolves `Mapped[date]` at runtime

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base


class MirrorSeries(Base):
    """Local cache of one upstream Sonarr series (PRD §13 — `mirror_series`)."""

    __tablename__: str = "mirror_series"

    connector_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("connectors.id", ondelete="CASCADE"),
        primary_key=True,
    )
    arr_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    tvdb_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    monitored: Mapped[bool] = mapped_column(Boolean, nullable=False)
    meta: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
    )


class MirrorEpisodes(Base):
    """Local cache of one upstream Sonarr episode (PRD §13 — `mirror_episodes`)."""

    __tablename__: str = "mirror_episodes"
    # Plan §M3 step 13: index lookups by (connector_id, series_arr_id, season_number)
    # so the rotation engine can fetch the season slice without a full scan.
    __table_args__: tuple[Index, ...] = (
        Index(
            "ix_mirror_episodes_series_season",
            "connector_id",
            "series_arr_id",
            "season_number",
        ),
    )

    connector_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("connectors.id", ondelete="CASCADE"),
        primary_key=True,
    )
    arr_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    series_arr_id: Mapped[int] = mapped_column(Integer, nullable=False)
    season_number: Mapped[int] = mapped_column(Integer, nullable=False)
    episode_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    air_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    has_file: Mapped[bool] = mapped_column(Boolean, nullable=False)
    meta: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
    )


class MirrorMovies(Base):
    """Local cache of one upstream Radarr movie (PRD §13 — `mirror_movies`)."""

    __tablename__: str = "mirror_movies"

    connector_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("connectors.id", ondelete="CASCADE"),
        primary_key=True,
    )
    arr_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    tmdb_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    monitored: Mapped[bool] = mapped_column(Boolean, nullable=False)
    meta: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
    )
