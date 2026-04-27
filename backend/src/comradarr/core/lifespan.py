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
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from comradarr.config import derive_audit_admin_url
from comradarr.core.auth import AuthProviderRegistry
from comradarr.core.auth.api_keys import ApiKeyService
from comradarr.core.auth.local import LocalPasswordProvider
from comradarr.core.auth.oidc import OIDCService
from comradarr.core.auth.rate_limit import RateLimiter
from comradarr.core.auth.sessions import SessionService
from comradarr.core.auth.trusted_header import (
    TrustedHeaderProvider,
    emit_startup_warnings,
    parse_cidr_allowlist,
)
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
        # No DDL is attempted on this path. Probes still run when
        # ``comradarr_run_db_probes_on_startup`` is True — the flags decoupled
        # so a deployment that runs migrations out-of-band still gets the
        # SELECT 1 + enum-membership boot gate.
        _logger.info("db.lifespan.migrations.skipped", reason="flag_off")

    if settings.comradarr_run_db_probes_on_startup:
        # Boot probes are independent of the migrations flag (architect feedback,
        # Phase 3 §5.3.5 Iter 1 Critic): a deployment that runs migrations via
        # an init container or a one-shot job still wants the SELECT 1 + enum
        # gate at app boot. The Phase 1 stub-DSN tests opt out by setting
        # COMRADARR_RUN_DB_PROBES_ON_STARTUP=false in stub_settings().
        # When migrations ran above, the probes run AFTER so the enum check
        # observes the post-upgrade state.
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


def _jwks_done_callback(task: asyncio.Task[object]) -> None:
    """Log a crashed JWKS refresher task. ``CancelledError`` = clean shutdown."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        return
    _logger.error(
        "lifespan.services.jwks_refresher_crashed",
        error=str(exc),
        error_type=type(exc).__name__,
    )


def _make_vacuum_done_callback(app: Litestar) -> Callable[[asyncio.Task[object]], None]:
    """Build the done-callback that flips audit_retention_vacuum_health on crash.

    Architect rework (Phase 3 §5.3.5 Iter 1 Critic): re-raising from an
    asyncio done-callback is silently consumed by the loop's exception
    handler, so the original "raise into the lifespan task" plan never
    actually surfaced the failure. Instead, the callback now:

    * flips ``app.state.audit_retention_vacuum_health`` to ``"crashed"``;
    * stashes the exception on ``app.state.audit_retention_vacuum_error``
      so Phase 6's ``/health`` endpoint can render the cause without
      reaching back into the (already-finished) task;
    * logs ``lifespan.services.vacuum_crashed`` at error severity so
      operators see the failure even when ``/health`` is unavailable.

    ``asyncio.CancelledError`` is the lifespan-teardown path and is NOT
    treated as a crash.
    """

    def _on_done(task: asyncio.Task[object]) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc is None:
            return
        app.state.audit_retention_vacuum_health = "crashed"
        app.state.audit_retention_vacuum_error = exc
        _logger.error(
            "lifespan.services.vacuum_crashed",
            error=str(exc),
            error_type=type(exc).__name__,
        )

    return _on_done


def _initial_vacuum_health(horizon_set: bool) -> AuditRetentionVacuumHealth:
    """Pick the initial health state from whether the retention horizon is set.

    Architect rework (Phase 3 §5.3.5 Iter 1 Critic): the previous code
    hard-coded ``"skipped_indefinite"`` regardless of horizon, so a
    deployment with retention enabled would still report the no-op state
    until the loop crashed. The state machine has only two pre-crash
    settled values, so we pick them up-front:

    * horizon set         → ``"running"`` (loop will DELETE on each tick).
    * horizon ``None``    → ``"skipped_indefinite"`` (loop emits the
      skip event each tick, never DELETEs).
    """
    return "running" if horizon_set else "skipped_indefinite"


@asynccontextmanager
async def services_lifespan(app: Litestar) -> AsyncGenerator[None]:
    """Compose the cross-phase services. Phase 4 extends Phase 3 with auth services."""
    settings: Settings = app.state.settings
    db_sessionmaker: async_sessionmaker[AsyncSession] = app.state.db_sessionmaker

    app.state.crypto = CryptoService(settings)
    audit = AuditWriter(db_sessionmaker)
    app.state.audit_writer = audit

    horizon = settings.audit_retention_timedelta()
    app.state.audit_retention_vacuum_health = _initial_vacuum_health(horizon is not None)
    app.state.audit_retention_vacuum_error = None
    vacuum = AuditRetentionVacuum(
        app.state.audit_admin_sessionmaker,
        horizon=horizon,
        interval=settings.comradarr_audit_vacuum_interval_seconds,
    )
    app.state.audit_retention_vacuum = vacuum

    vacuum_task: asyncio.Task[object] = asyncio.create_task(
        vacuum.run(),
        name="audit_retention_vacuum",
    )
    vacuum_task.add_done_callback(_make_vacuum_done_callback(app))
    app.state.audit_retention_vacuum_task = vacuum_task

    # Phase 4: auth services.
    # RateLimiter opens a fresh session per hit so concurrent requests don't
    # race on a shared AsyncSession. Each call commits its own transaction.
    rate_limiter = RateLimiter(db_sessionmaker)
    app.state.rate_limiter = rate_limiter

    session_service = SessionService(db_sessionmaker, settings, audit)
    app.state.session_service = session_service

    api_key_service = ApiKeyService(db_sessionmaker, audit)
    app.state.api_key_service = api_key_service

    local_provider = LocalPasswordProvider(settings, audit, rate_limiter)
    app.state.local_provider = local_provider

    oidc_providers = settings.oidc_providers if settings.oidc_providers else {}
    oidc_service = OIDCService(oidc_providers, app.state.crypto, db_sessionmaker, audit, settings)
    app.state.oidc_service = oidc_service

    allowlist = parse_cidr_allowlist(settings.trusted_header_auth_proxy_ips)
    trusted_header_provider = TrustedHeaderProvider(settings, audit, allowlist, db_sessionmaker)
    app.state.trusted_header_provider = trusted_header_provider

    auth_registry = AuthProviderRegistry([local_provider, trusted_header_provider])
    app.state.auth_registry = auth_registry

    # Startup warnings for operator misconfiguration (trusted header).
    emit_startup_warnings(settings)
    app.state.startup_warnings = True

    jwks_task: asyncio.Task[object] | None = None
    if oidc_providers:
        jwks_task = asyncio.create_task(
            oidc_service.run_jwks_refresher(),
            name="jwks_refresher",
        )
        jwks_task.add_done_callback(_jwks_done_callback)

    # Phase 11: app.state.event_bus = EventBus(); tg.create_task(app.state.event_bus.run())
    # Phase 7:  app.state.client_factory = ClientFactory(...)  # httpx[http2] lands Phase 7 per Q6
    # Phase 9:  app.state.sync_coordinator = ...; tg.create_task(app.state.sync_coordinator.run())
    # Phase 10: app.state.rotation_engine = ...; tg.create_task(app.state.rotation_engine.run())
    # Phase 12: app.state.notification_dispatcher = ...
    # Phase 8:  app.state.prowlarr_health_monitor = ...; tg.create_task(...)
    try:
        yield
    finally:
        if jwks_task is not None and not jwks_task.done():
            _ = jwks_task.cancel()
        if not vacuum_task.done():
            _ = vacuum_task.cancel()
        if jwks_task is not None:
            try:
                await asyncio.wait_for(jwks_task, timeout=_VACUUM_TEARDOWN_TIMEOUT_SECONDS)
            except TimeoutError, asyncio.CancelledError:
                pass
            except Exception as exc:  # noqa: BLE001
                _logger.warning("lifespan.services.jwks_teardown_error", error=str(exc))
        try:
            await asyncio.wait_for(vacuum_task, timeout=_VACUUM_TEARDOWN_TIMEOUT_SECONDS)
        except TimeoutError, asyncio.CancelledError:
            pass
        except Exception as exc:  # noqa: BLE001 — done-callback already recorded the error; swallow on teardown
            _logger.warning("lifespan.services.vacuum_teardown_error", error=str(exc))
