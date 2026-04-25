# pyright: reportAny=false, reportExplicitAny=false
"""Litestar lifespan composition (PATTERN-SESSION + plan §5.1.5).

Two ``@asynccontextmanager``-decorated lifespans:

* :func:`db_lifespan` — owns the async engine + sessionmaker, mounts both on
  ``app.state``, calls :func:`_run_pending_migrations` (a Phase 1 no-op gated
  by :attr:`Settings.comradarr_run_migrations_on_startup`), and disposes the
  engine on teardown.
* :func:`services_lifespan` — composer for the cross-phase services. Phase 1
  is a bare ``yield`` carrying explicit ``# Phase N:`` slot comments so
  later phases attach without rewriting the wiring shape. ``asyncio.TaskGroup``
  + the matching ``BaseExceptionGroup`` handler land together in Phase 9.

RULE-ASYNC-002 attestation: this module contains no ``asyncio.run`` and no
synchronous I/O — Granian owns the loop. RULE-LOG-001 attestation: every log
line goes through ``structlog.stdlib.get_logger`` — never the stdlib
``logging.getLogger`` (which would bypass the structlog formatter).
"""

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import structlog
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    async_sessionmaker,
    create_async_engine,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from litestar import Litestar

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


async def _run_pending_migrations(_engine: AsyncEngine, settings: Settings) -> None:
    """No-op stub gated by :attr:`Settings.comradarr_run_migrations_on_startup`.

    Phase 1 default is ``False`` ⇒ guaranteed no-op (no DB connection
    attempted, so the lifespan stays valid against a stub DSN).

    Phase 2 trap-comment: ``alembic.command.upgrade`` is a *blocking sync*
    API; wrap with ``asyncio.to_thread()`` before calling from this async
    lifespan, OR run it pre-lifespan in ``__main__.py`` post-validation.
    """
    if not settings.comradarr_run_migrations_on_startup:
        return
    # Phase 2: alembic.command.upgrade(...) wrapped in asyncio.to_thread().
    _logger.warning("lifespan.migrations.runner_not_implemented")


@asynccontextmanager
async def db_lifespan(app: Litestar) -> AsyncGenerator[None]:
    """Engine + sessionmaker ownership; runs the migration gate; disposes on teardown."""
    settings: Settings = app.state.settings  # set by create_app()
    engine = build_engine(settings.database_url)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    app.state.db_engine = engine
    app.state.db_sessionmaker = sessionmaker

    await _run_pending_migrations(engine, settings)
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
