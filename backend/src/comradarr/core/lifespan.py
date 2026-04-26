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

import asyncio
import time
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    async_sessionmaker,
    create_async_engine,
)

from comradarr.config import derive_audit_admin_url
from comradarr.core.crypto import CryptoService
from comradarr.db.enums import AuditAction
from comradarr.db.migrations import run_migrations_in_lifespan
from comradarr.errors.configuration import ConfigurationError
from comradarr.services.audit import AuditRetentionVacuum, AuditWriter

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Callable

    from litestar import Litestar
    from sqlalchemy.engine import Connection

    from comradarr.config import Settings
    from comradarr.services.audit import AuditRetentionVacuumHealth


_logger = structlog.stdlib.get_logger(__name__)

# Lifespan teardown timeout for the retention vacuum task — long enough to
# unwind a single in-flight DELETE batch, short enough that boot loops
# don't pin the worker on shutdown.
_VACUUM_TEARDOWN_TIMEOUT_SECONDS: float = 5.0


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


def _resolve_audit_admin_url(settings: Settings) -> str:
    """Pick the audit-admin DSN — explicit env wins; otherwise derive from app DSN."""
    if settings.audit_admin_database_url is not None:
        return settings.audit_admin_database_url.expose()
    return derive_audit_admin_url(settings.database_url, settings.audit_admin_password)


async def _probe_engine(engine: AsyncEngine, *, role: str) -> None:
    """Authenticate ``engine`` with a ``SELECT 1`` and a structured failure mode."""
    try:
        async with engine.connect() as conn:
            _ = await conn.execute(text("SELECT 1"))
    except Exception as exc:
        if role == "audit_admin":
            raise ConfigurationError(
                "audit-admin engine cannot authenticate; check "
                + "COMRADARR_AUDIT_ADMIN_PASSWORD and the LOGIN migration"
            ) from exc
        raise ConfigurationError(f"{role} engine cannot authenticate") from exc


async def _probe_audit_action_enum(engine: AsyncEngine) -> None:
    """Verify the PG ``audit_action`` enum contains every Python enum member.

    Iter 1 Independent #1: a missed ``ALTER TYPE ADD VALUE`` migration would
    otherwise let writes for the new code raise ``InvalidTextRepresentation``
    deep inside :class:`AuditWriter.record` — the boot probe surfaces the
    drift up-front with the exact missing-member list.
    """
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT enum_range(NULL::audit_action)"))
        row = result.first()
    if row is None or row[0] is None:
        raise ConfigurationError("audit_action enum is unreachable in the database")
    pg_members = set(row[0])
    py_members = {m.value for m in AuditAction}
    missing = sorted(py_members - pg_members)
    if missing:
        raise ConfigurationError(
            f"audit_action enum is missing expected members: {missing}; run pending migrations"
        )


@asynccontextmanager
async def db_lifespan(app: Litestar) -> AsyncGenerator[None]:
    """Engine + sessionmaker ownership; runs the migration gate; disposes on teardown."""
    settings: Settings = app.state.settings  # set by create_app()

    engine = build_engine(settings.database_url.expose())
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    app.state.db_engine = engine
    app.state.db_sessionmaker = sessionmaker

    audit_admin_engine = build_engine(_resolve_audit_admin_url(settings))
    audit_admin_sessionmaker = async_sessionmaker(audit_admin_engine, expire_on_commit=False)
    app.state.audit_admin_engine = audit_admin_engine
    app.state.audit_admin_sessionmaker = audit_admin_sessionmaker

    if settings.comradarr_run_migrations_on_startup:
        try:
            await _run_migrations_branch(engine)
        except Exception as exc:
            _logger.error("db.lifespan.migrations.failed", error=str(exc))
            await engine.dispose()
            await audit_admin_engine.dispose()
            raise
    else:
        # No DB connection is attempted on this path — Phase 1's stub DSN
        # survives boot because the flag defaults to False.
        _logger.info("db.lifespan.migrations.skipped", reason="flag_off")

    if settings.comradarr_run_migrations_on_startup:
        # Boot probes only fire on the migration-gated path because the
        # flag-off path never connects to the database (Phase 1 stub-DSN
        # contract). When the flag is ON the probes run AFTER migrations
        # so the enum-membership check sees the post-upgrade state.
        try:
            await _probe_engine(engine, role="app")
            await _probe_engine(audit_admin_engine, role="audit_admin")
            await _probe_audit_action_enum(engine)
        except Exception:
            await engine.dispose()
            await audit_admin_engine.dispose()
            raise

    _logger.info("lifespan.db.ready", run_migrations=settings.comradarr_run_migrations_on_startup)
    try:
        yield
    finally:
        await engine.dispose()
        await audit_admin_engine.dispose()
        _logger.info("lifespan.db.disposed")


def _make_vacuum_done_callback(app: Litestar) -> Callable[[asyncio.Task[object]], None]:
    """Build the done-callback that flips audit_retention_vacuum_health on crash.

    Iter 1 Amendment 2: the callback must (a) flip ``app.state`` to
    ``"crashed"`` so Phase 6's ``/health`` endpoint surfaces the failure
    AND (b) re-raise the underlying exception into the lifespan task so
    boot fails loudly rather than silently degrading.
    ``asyncio.CancelledError`` is the lifespan-teardown path and is NOT a
    crash.
    """

    def _on_done(task: asyncio.Task[object]) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc is None:
            return
        app.state.audit_retention_vacuum_health = "crashed"
        raise exc

    return _on_done


@asynccontextmanager
async def services_lifespan(app: Litestar) -> AsyncGenerator[None]:
    """Compose the cross-phase services. Phase 3 wires crypto + audit + vacuum."""
    settings: Settings = app.state.settings

    app.state.crypto = CryptoService(settings)
    app.state.audit_writer = AuditWriter(app.state.db_sessionmaker)

    initial_health: AuditRetentionVacuumHealth = "skipped_indefinite"
    app.state.audit_retention_vacuum_health = initial_health
    vacuum = AuditRetentionVacuum(
        app.state.audit_admin_sessionmaker,
        horizon=settings.audit_retention_timedelta(),
        interval=settings.comradarr_audit_vacuum_interval_seconds,
    )
    app.state.audit_retention_vacuum = vacuum

    vacuum_task: asyncio.Task[object] = asyncio.create_task(
        vacuum.run(),  # type: ignore[arg-type]
        name="audit_retention_vacuum",
    )
    vacuum_task.add_done_callback(_make_vacuum_done_callback(app))
    app.state.audit_retention_vacuum_task = vacuum_task

    # Phase 11: app.state.event_bus = EventBus(); tg.create_task(app.state.event_bus.run())
    # Phase 7:  app.state.client_factory = ClientFactory(...)  # httpx[http2] lands Phase 7 per Q6
    # Phase 9:  app.state.sync_coordinator = ...; tg.create_task(app.state.sync_coordinator.run())
    # Phase 10: app.state.rotation_engine = ...; tg.create_task(app.state.rotation_engine.run())
    # Phase 12: app.state.notification_dispatcher = ...
    # Phase 8:  app.state.prowlarr_health_monitor = ...; tg.create_task(...)
    try:
        yield
    finally:
        if not vacuum_task.done():
            _ = vacuum_task.cancel()
        try:
            await asyncio.wait_for(vacuum_task, timeout=_VACUUM_TEARDOWN_TIMEOUT_SECONDS)
        except TimeoutError, asyncio.CancelledError:  # noqa: PERF203 — explicit teardown branches
            pass
        except Exception as exc:  # noqa: BLE001 — done-callback already re-raised; swallow on teardown
            _logger.warning("lifespan.services.vacuum_teardown_error", error=str(exc))
