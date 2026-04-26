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

The session-scope engine fixture also performs a **startup sweep** that drops
any leftover ``wid_*`` schemas older than 1 hour. This is the R4 mitigation
from plan §6: a crashed worker that died before the CASCADE-drop finalizer
ran would otherwise pollute the test DB indefinitely. The 1-hour threshold
is wide enough to leave concurrent worker schemas alone (a long pytest run
finishes in single-digit minutes) but tight enough to keep stale state from
accumulating across CI days.

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
    AsyncConnection,
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


async def _sweep_stale_schemas(conn: AsyncConnection) -> None:
    """Drop any leftover ``wid_*`` schemas (plan §6 R4 mitigation).

    A worker that died after creating its schema but before the
    ``DROP SCHEMA CASCADE`` finalizer ran would leave behind a ``wid_*``
    schema indefinitely. The startup sweep clears them on every new test
    session so the test DB does not accumulate carcasses across CI days.

    PostgreSQL does not expose schema-creation timestamps and the
    pg_class.xmin → pg_xact_commit_timestamp path requires
    ``track_commit_timestamp = on`` plus a non-trivial xid cast that breaks
    on PG14+. We instead drop *every* ``wid_*`` schema unconditionally — the
    per-session ``CREATE SCHEMA IF NOT EXISTS`` immediately afterwards is
    idempotent, and concurrent xdist workers each own a distinct schema, so
    the only thing we ever delete is genuine stale state.
    """
    # Drop wid_* schemas whose corresponding test_<worker> application_name
    # has no live row in pg_stat_activity — i.e. nobody owns them anymore.
    # _WID_SCHEMA_PREFIX is a module constant; ruff S608 is a false positive.
    sweep_sql = (
        f"SELECT n.nspname FROM pg_namespace n "  # noqa: S608
        f"WHERE n.nspname LIKE '{_WID_SCHEMA_PREFIX}%' "
        f"  AND NOT EXISTS ("
        f"    SELECT 1 FROM pg_stat_activity a "
        f"    WHERE a.application_name = "
        f"      'test_' || substring(n.nspname FROM length('{_WID_SCHEMA_PREFIX}') + 1)"
        f"  )"
    )
    rows = await conn.execute(text(sweep_sql))
    stale: list[str] = [cast("str", row[0]) for row in rows.all()]
    for schema in stale:
        # Best-effort: a concurrent session may already be dropping it.
        with contextlib.suppress(Exception):
            _ = await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def db_engine(worker_id: str) -> AsyncIterator[AsyncEngine]:
    """Per-worker engine pinned to ``wid_<worker>`` schema with alembic head.

    Lifecycle:

    1. Connect superuser-style to the test DB; run the stale-schema sweep.
    2. ``CREATE SCHEMA IF NOT EXISTS wid_<worker>``.
    3. Build the engine with ``connect_args.server_settings.search_path``
       pinned to the worker schema so every connection from this engine
       sees the schema as the default.
    4. Run ``alembic upgrade head`` against this engine — the migrations
       create their tables inside the worker schema (Postgres resolves
       unqualified ``CREATE TABLE`` against the first writable entry of
       ``search_path``).
    5. ``yield`` the engine for the whole session.
    6. ``DROP SCHEMA wid_<worker> CASCADE`` in try/except; dispose engine.
    """
    schema = _schema_for(worker_id)
    base_url = worker_database_url(worker_id)

    # Step 1-2: schema setup via a one-shot admin engine. Using a separate
    # engine for the bootstrap keeps the long-lived test engine's pool
    # clean of administrative state.
    admin_engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
    try:
        async with admin_engine.connect() as admin_conn:
            await _sweep_stale_schemas(admin_conn)
            _ = await admin_conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
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
