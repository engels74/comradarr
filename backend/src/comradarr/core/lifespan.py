# pyright: reportAny=false, reportExplicitAny=false
"""Litestar lifespan composition (PATTERN-SESSION + plan §5.1.5).

Two ``@asynccontextmanager``-decorated lifespans:

* :func:`db_lifespan` — owns the async engine + sessionmaker, mounts both on
  ``app.state``, drives the migration runner gated by
  :attr:`Settings.comradarr_run_migrations_on_startup`, and disposes the
  engine on teardown.
* :func:`services_lifespan` — composer for the cross-phase services. Phase 1
  is a bare ``yield`` carrying explicit ``# Phase N:`` slot comments so
  later phases attach without rewriting the wiring shape. ``asyncio.TaskGroup``
  + the matching ``BaseExceptionGroup`` handler land together in Phase 9.

The migration branch-tree is load-bearing — Wave 4's
``test_lifespan_migrations.py`` asserts each event name + kwarg shape:

  * ``db.lifespan.migrations.applied`` (INFO) — flag ON, runner advanced
    head: kwargs ``from_revision`` (rev or ``None``), ``to_revision``
    (head rev), ``elapsed_ms`` (int).
  * ``db.lifespan.migrations.noop`` (INFO) — flag ON, runner observed
    head=current (the lock-loser path on multi-worker startup): kwarg
    ``reason="already_at_head"``.
  * ``db.lifespan.migrations.skipped`` (INFO) — flag OFF: kwarg
    ``reason="flag_off"``. No DB connection is attempted.
  * ``db.lifespan.migrations.failed`` (ERROR) — preflight or migration
    raised: kwarg ``error`` (string repr); the lifespan re-raises so app
    boot fails.

RULE-ASYNC-002 attestation: this module contains no ``asyncio.run``, no
synchronous I/O, and NEVER calls ``alembic.command.upgrade`` — that API
is a blocking sync entrypoint that would deadlock Granian's loop. The
async migration path bridges through
``comradarr.db.migrations.run_migrations_in_lifespan`` which uses
``connection.run_sync(do_run_migrations)`` internally.

RULE-LOG-001 attestation: every log line goes through
``structlog.stdlib.get_logger`` — never the stdlib ``logging.getLogger``
(which would bypass the structlog formatter).
"""

import time
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import structlog
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    async_sessionmaker,
    create_async_engine,
)

from comradarr.db.migrations import run_migrations_in_lifespan

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from litestar import Litestar
    from sqlalchemy.engine import Connection

    from comradarr.config import Settings


_logger = structlog.stdlib.get_logger(__name__)


def build_engine(database_url: str) -> AsyncEngine:
    """Build the async SQLAlchemy engine (PATTERN-SESSION).

    Phase 1 keeps engine construction lazy — asyncpg connects on the first
    query, not on :func:`create_async_engine`, so a stub DSN survives import
    + ``create_app()`` and only fails on real query execution. Phase 2's
    integration tests bring up Postgres for the first time.
    """
    return create_async_engine(database_url)


def _read_current_revision(connection: Connection) -> str | None:
    """Sync helper for ``conn.run_sync`` — read the DB's Alembic revision."""
    # Imported lazily so the boot-time import surface stays minimal — the
    # alembic runtime is a couple-hundred-millisecond import that we only
    # want to pay when the migration flag is actually ON.
    from alembic.runtime.migration import MigrationContext  # noqa: PLC0415

    context = MigrationContext.configure(connection)
    return context.get_current_revision()


async def _current_revision(engine: AsyncEngine) -> str | None:
    """Read the database's current Alembic revision (or ``None`` if fresh)."""
    async with engine.connect() as conn:
        return await conn.run_sync(_read_current_revision)


async def _run_migrations_branch(engine: AsyncEngine) -> None:
    """Drive the lifespan migration runner; emit the applied/noop/failed events.

    Sequencing is load-bearing for the multi-worker race:

    1. Read ``from_revision`` BEFORE acquiring the advisory lock so the
       lock-loser observes the same value the lock-winner is about to write
       (``head`` after the upgrade) and emits ``noop`` cleanly.
    2. ``run_migrations_in_lifespan`` opens the outer transaction, acquires
       ``pg_advisory_xact_lock``, and runs ``do_run_migrations``.
    3. Read ``to_revision`` AFTER the runner returns. If it equals
       ``from_revision``, the lock-loser's path applies → emit ``noop``.
       Otherwise emit ``applied`` with the elapsed time.

    The split point matters: putting the head-revision read inside the
    advisory-lock window would make every worker observe ``head=head`` and
    every worker would emit ``noop`` — concealing whether the migration
    actually ran.
    """
    from_revision = await _current_revision(engine)

    started_ms = time.monotonic()
    await run_migrations_in_lifespan(engine)
    elapsed_ms = int((time.monotonic() - started_ms) * 1000)

    to_revision = await _current_revision(engine)

    if to_revision == from_revision:
        _logger.info("db.lifespan.migrations.noop", reason="already_at_head")
        return

    _logger.info(
        "db.lifespan.migrations.applied",
        from_revision=from_revision,
        to_revision=to_revision,
        elapsed_ms=elapsed_ms,
    )


@asynccontextmanager
async def db_lifespan(app: Litestar) -> AsyncGenerator[None]:
    """Engine + sessionmaker ownership; runs the migration gate; disposes on teardown."""
    settings: Settings = app.state.settings  # set by create_app()
    engine = build_engine(settings.database_url)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    app.state.db_engine = engine
    app.state.db_sessionmaker = sessionmaker

    if settings.comradarr_run_migrations_on_startup:
        try:
            await _run_migrations_branch(engine)
        except Exception as exc:
            _logger.error("db.lifespan.migrations.failed", error=str(exc))
            await engine.dispose()
            raise
    else:
        # No DB connection is attempted on this path — Phase 1's stub DSN
        # survives boot because the flag defaults to False.
        _logger.info("db.lifespan.migrations.skipped", reason="flag_off")

    _logger.info("lifespan.db.ready", run_migrations=settings.comradarr_run_migrations_on_startup)
    try:
        yield
    finally:
        await engine.dispose()
        _logger.info("lifespan.db.disposed")


@asynccontextmanager
async def services_lifespan(_app: Litestar) -> AsyncGenerator[None]:
    """No-op service composer — Phase N slot comments document attachment points.

    Phase 9 introduces ``async with asyncio.TaskGroup() as tg:`` here AND
    registers ``exception_handlers[BaseExceptionGroup] = exception_group_handler``
    in :mod:`comradarr.app` so PEP 654 wrapping never bypasses the RFC 9457
    envelope contract. Phase 1 keeps the body bare so ``BaseExceptionGroup``
    has no surface area until there is a real failure path to handle.
    """
    # Phase 11: app.state.event_bus = EventBus(); tg.create_task(app.state.event_bus.run())
    # Phase 3:  app.state.crypto = CryptoService(settings)
    # Phase 7:  app.state.client_factory = ClientFactory(...)  # httpx[http2] lands Phase 7 per Q6
    # Phase 9:  app.state.sync_coordinator = ...; tg.create_task(app.state.sync_coordinator.run())
    # Phase 10: app.state.rotation_engine = ...; tg.create_task(app.state.rotation_engine.run())
    # Phase 12: app.state.notification_dispatcher = ...
    # Phase 8:  app.state.prowlarr_health_monitor = ...; tg.create_task(...)
    # Phase 3:  app.state.audit_retention_vacuum = ...; tg.create_task(...)
    yield
