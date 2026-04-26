"""Phase 2 test fixtures (RECIPE-PYTEST-DB + plan §3 Milestone 10 step 40).

The Phase 1 helpers (``stub_settings``, ``worker_id``) are preserved unchanged
(R-EXEC-7) — every Phase 1 test still imports them. Phase 2 lights up
:func:`worker_database_url` against a real Postgres instance and adds two new
async fixtures:

* :func:`db_engine` (session-scoped, one event loop) — creates the per-worker
  schema (``wid_<worker>``), pins the engine's ``search_path`` to that schema,
  runs ``alembic upgrade head`` against it, and drops the schema CASCADE on
  teardown. ``DROP SCHEMA`` is wrapped in ``try/except`` so a half-set-up
  worker never strands the rest of the suite.
* :func:`db_session` (function-scoped) — opens an outer ``BEGIN`` on a
  connection checked out from the engine, builds a sessionmaker with
  ``join_transaction_mode="create_savepoint"`` (NON-NEGOTIABLE per
  RECIPE-PYTEST-DB rules.md:1101 — without it, savepoint-rollback isolation
  silently breaks the moment a test commits), yields a session, and
  rolls back at teardown. Test bodies see a clean schema every time.

The session-scope engine fixture **resets its own worker schema** on entry
via ``DROP SCHEMA IF EXISTS ... CASCADE; CREATE SCHEMA ...`` (R4 mitigation
from plan §6). A crashed worker that died before the CASCADE-drop finalizer
ran is self-healed by the next session's drop-and-recreate of *its own*
worker id. Cross-worker sweep was removed because the
``application_name='test_<worker_id>'`` predicate raced with peer schema
creation under high xdist parallelism (the long-lived test engine registers
the application_name *after* schema creation, leaving a window where a
sibling worker's sweep would drop the peer's freshly-created schema). Stale
schemas from worker ids absent in the current run accumulate harmlessly —
the next run targeting that id resets it; otherwise they're tiny pg_namespace
bloat and operators can drop them manually if desired.

DSN resolution:

* CI (Postgres 16 service container): the workflow sets ``TEST_DATABASE_URL``
  to ``postgresql+asyncpg://postgres@localhost:5432/postgres`` — the
  superuser path that lets the conftest create roles + schemas.
* Local dev: ``TEST_DATABASE_URL`` defaults to
  ``postgresql+asyncpg://comradarr:comradarr@localhost:5432/comradarr_test``
  per docs/runbook/postgres-roles.md.

RULE-TEST-001 attestation: ``asyncio_mode = "auto"`` + ``loop_scope="session"``
already pinned in ``pyproject.toml``. Async fixtures use
:func:`pytest_asyncio.fixture` (NEVER plain ``@pytest.fixture`` — ANTI-015 /
ANTI-126). No ``event_loop`` fixture override (ANTI-019 / ANTI-127).
RULE-TEST-002 attestation: schema name is keyed on
``os.environ["PYTEST_XDIST_WORKER"]`` so xdist ``-n auto`` runs are isolated.
"""

import contextlib
import os
import secrets
from typing import TYPE_CHECKING, cast

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.sql import text

# Stable, high-entropy stub secret key for the *whole* test session — generated
# once at import-time so each worker observes a consistent value across xdist
# fan-out. Real Phase 2 DB tests re-seed per worker via _seed_db_env() below.
_STUB_SECRET_KEY: str = secrets.token_urlsafe(48)
_STUB_DATABASE_URL: str = "postgresql+asyncpg://stub:stub@localhost:1/stub"

# Seed env BEFORE first comradarr.* import so the module-level
# ``app = create_app()`` in comradarr/app.py sees a valid Settings.
_ = os.environ.setdefault("COMRADARR_SECRET_KEY", _STUB_SECRET_KEY)
_ = os.environ.setdefault("DATABASE_URL", _STUB_DATABASE_URL)

from comradarr.config import Settings, load_settings  # noqa: E402  — env seed must precede

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Mapping


def _xdist_worker_id(request: pytest.FixtureRequest) -> str:
    """Return the xdist worker id (``"gw0"``, ``"gw1"`` …) or ``"master"``."""
    worker: object = getattr(request.config, "workerinput", None)
    if isinstance(worker, dict):
        worker_typed = cast("dict[str, object]", worker)
        wid = worker_typed.get("workerid")
        if isinstance(wid, str):
            return wid
    return "master"


@pytest.fixture(name="worker_id", scope="session")
def worker_id_fixture(request: pytest.FixtureRequest) -> str:
    """Expose the pytest-xdist worker id to tests (Phase 2 DB-key driver).

    Session-scoped: the worker id is a process-level constant for the life of
    the pytest run, so a session-scoped fixture lets the session-scoped
    ``db_engine`` consume it without a ScopeMismatch.
    """
    return _xdist_worker_id(request)


def worker_database_url(_worker_id: str) -> str:
    """Return the test DSN.

    The ``application_name`` and ``search_path`` are NOT appended as DSN query
    parameters because asyncpg does not accept them as ``connect()`` kwargs —
    they must be passed via ``connect_args.server_settings`` on the engine
    (see :func:`db_engine`). Both are wired there.
    """
    return os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql+asyncpg://comradarr:comradarr@localhost:5432/comradarr_test",
    )


def stub_settings(
    *,
    overrides: Mapping[str, str] | None = None,
) -> Settings:
    """Build a frozen :class:`Settings` from a stub env (R7 mitigation).

    The default env supplies the minimum to satisfy ``load_settings`` (a
    high-entropy secret key + an asyncpg DSN). Tests pass ``overrides`` to flip
    individual fields without leaking real process env vars.
    """
    env: dict[str, str] = {
        "COMRADARR_SECRET_KEY": _STUB_SECRET_KEY,
        "DATABASE_URL": _STUB_DATABASE_URL,
    }
    if overrides:
        env.update(overrides)
    return load_settings(env=env)


# ---------------------------------------------------------------------------
# Phase 2: per-worker schema + transactional-rollback DB fixtures
# ---------------------------------------------------------------------------


_WID_SCHEMA_PREFIX = "wid_"


def _schema_for(worker: str) -> str:
    """Return the per-worker schema name (e.g. ``wid_gw0`` / ``wid_master``)."""
    return f"{_WID_SCHEMA_PREFIX}{worker}"


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def db_engine(worker_id: str) -> AsyncIterator[AsyncEngine]:
    """Per-worker engine pinned to ``wid_<worker>`` schema with alembic head.

    Lifecycle:

    1. Connect superuser-style to the test DB.
    2. ``DROP SCHEMA IF EXISTS wid_<worker> CASCADE`` followed by
       ``CREATE SCHEMA wid_<worker>`` — peer-isolated reset (each worker
       only touches its own schema, so cross-worker races are impossible).
    3. Build the engine with ``connect_args.server_settings.search_path``
       pinned to the worker schema so every connection from this engine
       sees the schema as the default.
    4. Run ``alembic upgrade head`` against this engine — the migrations
       create their tables inside the worker schema (Postgres resolves
       unqualified ``CREATE TABLE`` against the first writable entry of
       ``search_path``).
    5. ``yield`` the engine for the whole session.
    6. ``DROP SCHEMA wid_<worker> CASCADE`` in try/except; dispose engine.

    Earlier revisions ran a startup sweep that dropped *every* ``wid_*``
    schema whose ``application_name='test_<id>'`` was absent from
    ``pg_stat_activity``. Under ``-n auto`` on many-core hosts (10+ xdist
    workers) the sweep raced with peers: a peer's ``wid_<id>`` exists in
    ``pg_namespace`` immediately after step 2 but its long-lived test engine
    (which sets ``application_name``) hasn't connected yet, so a sibling
    worker's sweep would drop the peer's freshly-created schema. The
    drop-and-recreate-own-schema approach used here is race-free.
    """
    schema = _schema_for(worker_id)
    base_url = worker_database_url(worker_id)

    # Step 1-2: schema reset via a one-shot admin engine. Using a separate
    # engine for the bootstrap keeps the long-lived test engine's pool
    # clean of administrative state.
    #
    # Schema-level USAGE: the production migration grants ``USAGE ON SCHEMA
    # public`` to the three application roles. Phase-2 tests redirect DDL into
    # the per-worker ``wid_<worker>`` schema via ``search_path``, so the
    # migration's table-level GRANTs land on tables inside this schema — but
    # the migration's ``GRANT USAGE ON SCHEMA public`` line targets ``public``
    # specifically and does NOT reach ``wid_<worker>``. Without USAGE on the
    # worker schema, every role-restricted lookup raises ``relation "..." does
    # not exist`` because the role can't see into the schema. We bridge the
    # gap here, in test scaffolding only — production rolls migrations into
    # the default ``public`` schema where the migration's USAGE grant applies
    # directly.
    admin_engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
    try:
        async with admin_engine.connect() as admin_conn:
            # Self-isolating reset: only this worker's schema is touched.
            _ = await admin_conn.execute(
                text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'),
            )
            _ = await admin_conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            for role in ("comradarr_migration", "comradarr_app", "comradarr_audit_admin"):
                _ = await admin_conn.execute(
                    text(f'GRANT USAGE ON SCHEMA "{schema}" TO "{role}"'),
                )
            # The migration role also CREATEs tables inside the schema during
            # ``alembic upgrade head`` — without ``CREATE`` on the worker
            # schema it would fall back to ``public`` and miss the test's
            # search_path pin entirely.
            _ = await admin_conn.execute(
                text(f'GRANT CREATE ON SCHEMA "{schema}" TO "comradarr_migration"'),
            )
    finally:
        await admin_engine.dispose()

    # Step 3: long-lived test engine pinned to the worker schema. Both the
    # search_path and application_name are passed via server_settings (asyncpg
    # rejects them as plain connect kwargs).
    engine = create_async_engine(
        base_url,
        connect_args={
            "server_settings": {
                "search_path": schema,
                "application_name": f"test_{worker_id}",
            },
        },
    )

    # Step 4: alembic upgrade head. We delegate to the same lifespan runner
    # the app uses (PATTERN-LIFESPAN parity); preflight + advisory lock +
    # transactional DDL all flow through ``run_migrations_in_lifespan``.
    # Imported lazily so a test module that does not request this fixture
    # never pays the alembic / db.migrations import cost.
    from comradarr.db.migrations import (  # noqa: PLC0415
        run_migrations_in_lifespan,
    )

    await run_migrations_in_lifespan(engine)

    # Post-migration grant fix-up: the production migration runs
    # ``GRANT ALL ON ALL TABLES IN SCHEMA public TO comradarr_migration``,
    # but ``ALL TABLES IN SCHEMA <name>`` is hard-pinned to ``<name>`` and
    # does NOT follow ``search_path``. The per-table app/audit grants
    # (``GRANT ... ON "users"``) are unqualified so they DO follow
    # search_path and land on ``wid_<worker>.users`` correctly — but the
    # migration role's ALL-TABLES grant misses every table in the worker
    # schema. We replay the migration role's table + sequence grants here
    # against ``wid_<worker>`` so role-permission tests that
    # ``SET LOCAL ROLE comradarr_migration`` can still UPDATE/DELETE.
    grant_engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
    try:
        async with grant_engine.connect() as grant_conn:
            _ = await grant_conn.execute(
                text(f'GRANT ALL ON ALL TABLES IN SCHEMA "{schema}" TO "comradarr_migration"'),
            )
            _ = await grant_conn.execute(
                text(
                    f'GRANT ALL ON ALL SEQUENCES IN SCHEMA "{schema}" TO "comradarr_migration"',
                ),
            )
    finally:
        await grant_engine.dispose()

    try:
        yield engine
    finally:
        # Step 6: schema teardown. Wrapped in try/except so a half-built
        # session never wedges the suite — the next run's startup sweep
        # will catch anything that escapes here.
        await engine.dispose()
        cleanup_engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
        try:
            async with cleanup_engine.connect() as cleanup_conn:
                # Finalizer is best-effort — startup sweep catches escapees.
                with contextlib.suppress(Exception):
                    _ = await cleanup_conn.execute(
                        text(f'DROP SCHEMA "{schema}" CASCADE'),
                    )
        finally:
            await cleanup_engine.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def db_session(db_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    """Per-test session — outer ``BEGIN`` + savepoint rollback isolation.

    The ``join_transaction_mode="create_savepoint"`` literal is MANDATORY
    per RECIPE-PYTEST-DB rules.md:1101: without it, the moment a test body
    calls ``session.commit()`` SQLAlchemy releases the outer transaction and
    subsequent tests see committed state. With ``create_savepoint``, every
    ``session.commit()`` is implemented as a SAVEPOINT release and the outer
    ``BEGIN`` survives until our finalizer rolls it back.
    """
    async with db_engine.connect() as conn:
        outer_trans = await conn.begin()
        sessionmaker = async_sessionmaker(
            bind=conn,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        async with sessionmaker() as session:
            try:
                yield session
            finally:
                await outer_trans.rollback()
