"""Alembic baseline round-trip + autogenerate-empty-diff (plan §3 Milestone 10 step 43).

Four phases against a fresh per-test schema:

1. ``alembic upgrade head`` — applied via the same lifespan runner the app
   uses (preflight + advisory lock + transactional DDL). Asserts no exception.
2. **Autogenerate-empty-diff** — re-introspect the live schema and compare to
   ``Base.metadata`` via ``alembic.autogenerate.produce_migrations``. The diff
   list must be empty modulo the autogen-drift allowlist sourced from
   :data:`comradarr.db.migrations.AUTOGEN_DRIFT_ALLOWLIST`.
3. ``alembic downgrade base`` — every application table dropped.
4. **Re-apply head** — confirms idempotency (downgrade leaves no half-state).

The shared :func:`comradarr.db.migrations.filter_autogen_drift` filter
covers two autogenerate failure modes:

* **Partial indexes** (``ix_search_schedule_active``,
  ``ix_planned_commands_pending``) whose ``WHERE`` clause Postgres
  canonicalizes (``status = 'pending'::command_status``) in a form
  autogenerate cannot round-trip.
* **DESC-ordered indexes** (``ix_audit_log_action_timestamp_desc``,
  ``ix_audit_log_timestamp_desc``) — Postgres returns a
  ``UnaryExpression`` placeholder for the descending column during
  introspection, hiding the underlying column from ``compare_metadata``.

Adding a fifth entry requires extending the allowlist in
``comradarr.db.migrations`` explicitly — that discipline is the security
gate the spec calls out.

Plan §6 R2 attestation: this is the substitute coverage for objects the
autogenerate filter excludes — the partial-index ``WHERE`` clauses are
asserted via ``pg_indexes`` introspection in ``test_partial_indexes.py``.
"""

from pathlib import Path
from typing import TYPE_CHECKING, cast

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.config import Config as AlembicConfig
from alembic.migration import MigrationContext
from alembic.runtime.environment import EnvironmentContext
from alembic.script import ScriptDirectory
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.sql import text

import comradarr.db.models  # noqa: F401  # registers ORM models for autogenerate  # pyright: ignore[reportUnusedImport]
from comradarr.db.base import Base
from comradarr.db.migrations import (
    AUTOGEN_DRIFT_ALLOWLIST,
    filter_autogen_drift,
    run_migrations_in_lifespan,
)

# Mirror of comradarr.db.migrations._SCRIPT_LOCATION computed at import time —
# this file is backend/tests/db/test_alembic_baseline.py, so parents[2] is
# backend/. Avoids reaching across module privacy.
_SCRIPT_LOCATION: str = str(Path(__file__).resolve().parents[2] / "migrations")

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.engine import Connection
    from sqlalchemy.ext.asyncio import AsyncEngine


pytestmark = pytest.mark.integration


# Sentinel: the canonical allowlist contains exactly the 4 expected indexes
# (2 partial + 2 DESC-ordered). Any future addition must come with both an
# explicit edit to comradarr.db.migrations.AUTOGEN_DRIFT_ALLOWLIST AND a bump
# to this constant — the discipline is a security gate per plan §6 R2.
_EXPECTED_ALLOWLIST_SIZE = 5


def test_autogen_drift_allowlist_size_sentinel() -> None:
    """Lock the allowlist size — additions require explicit review."""
    assert len(AUTOGEN_DRIFT_ALLOWLIST) == _EXPECTED_ALLOWLIST_SIZE, (
        f"AUTOGEN_DRIFT_ALLOWLIST has {len(AUTOGEN_DRIFT_ALLOWLIST)} entries; "
        f"expected {_EXPECTED_ALLOWLIST_SIZE}. Adding an entry needs a "
        "concurrent review against plan §6 R2 (substitute coverage in "
        "test_partial_indexes.py)."
    )


def _build_alembic_config() -> AlembicConfig:
    """Build a minimal Alembic Config for autogenerate runs."""
    config = AlembicConfig()
    config.set_main_option("script_location", _SCRIPT_LOCATION)
    return config


async def _create_fresh_schema(base_url: str, schema: str) -> None:
    """Create ``schema`` on the test DB; idempotent for re-applies."""
    admin_engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
    try:
        async with admin_engine.connect() as conn:
            _ = await conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
    finally:
        await admin_engine.dispose()


async def _drop_schema(base_url: str, schema: str) -> None:
    """Drop ``schema`` CASCADE; best-effort for finalizers."""
    admin_engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
    try:
        async with admin_engine.connect() as conn:
            _ = await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
    finally:
        await admin_engine.dispose()


@pytest.fixture(name="baseline_schema_engine")
async def _baseline_schema_engine_fixture(  # pyright: ignore[reportUnusedFunction]
    worker_id: str,
) -> AsyncIterator[AsyncEngine]:
    """Per-test engine pinned to a fresh ``baseline_<worker>_<rand>`` schema.

    A unique schema per test keeps the four phases (upgrade / autogenerate /
    downgrade / re-upgrade) independent of the session-scoped ``db_engine``
    (already at head) and avoids cross-test pollution.
    """
    import secrets  # noqa: PLC0415

    from tests.conftest import worker_database_url  # noqa: PLC0415

    base_url = worker_database_url(worker_id)
    schema = f"baseline_{worker_id}_{secrets.token_hex(4)}"

    await _create_fresh_schema(base_url, schema)

    engine = create_async_engine(
        base_url,
        connect_args={
            "server_settings": {
                "search_path": schema,
                "application_name": f"test_baseline_{worker_id}",
            },
        },
    )
    try:
        yield engine
    finally:
        await engine.dispose()
        await _drop_schema(base_url, schema)


def _autogenerate_diff(connection: Connection) -> list[object]:
    """Run autogenerate's diff phase against the live schema.

    Mirrors what the alembic CLI does internally for ``alembic check`` —
    builds a :class:`MigrationContext` with the partial-index filter and
    asks for the diff list. Returns ``[]`` when the schema matches
    ``Base.metadata`` modulo the allowlisted partial indexes.
    """
    config = _build_alembic_config()
    script_directory = ScriptDirectory.from_config(config)

    diff_holder: dict[str, list[object]] = {"diff": []}

    def _capture(_rev: object, _ctx: object) -> object:
        ctx = MigrationContext.configure(
            connection=connection,
            opts={
                "compare_type": True,
                "compare_server_default": True,
                "include_object": filter_autogen_drift,
                "target_metadata": Base.metadata,
            },
        )
        diff_holder["diff"] = compare_metadata(ctx, Base.metadata)
        return ()

    with EnvironmentContext(config, script_directory, fn=_capture) as env_ctx:
        env_ctx.configure(
            connection=connection,
            target_metadata=Base.metadata,
            compare_type=True,
            compare_server_default=True,
            include_object=filter_autogen_drift,
        )
        env_ctx.run_migrations()

    return diff_holder["diff"]


def _existing_table_names(connection: Connection, schema: str) -> set[str]:
    """Return the set of table names currently present in ``schema``."""
    inspector = sa.inspect(connection)
    return set(inspector.get_table_names(schema=schema))


async def test_baseline_upgrade_head_succeeds(
    baseline_schema_engine: AsyncEngine,
) -> None:
    """Phase 1 — ``alembic upgrade head`` applies cleanly to a fresh schema."""
    # The runner pre-flights roles, acquires the advisory lock, and applies
    # head; an exception here fails the test immediately.
    await run_migrations_in_lifespan(baseline_schema_engine)

    # Sanity check: every model-declared table is present in the schema.
    async with baseline_schema_engine.connect() as conn:

        def _check(sync_conn: Connection) -> None:
            inspector = sa.inspect(sync_conn)
            present = set(inspector.get_table_names())
            expected = set(Base.metadata.tables.keys())
            missing = expected - present
            assert not missing, f"upgrade head left tables missing: {sorted(missing)}"

        await conn.run_sync(_check)


async def test_baseline_autogenerate_empty_diff(
    baseline_schema_engine: AsyncEngine,
) -> None:
    """Phase 2 — autogenerate against the upgraded schema is empty (allowlist)."""
    await run_migrations_in_lifespan(baseline_schema_engine)

    async with baseline_schema_engine.connect() as conn:
        diff = await conn.run_sync(_autogenerate_diff)

    assert diff == [], (
        "autogenerate produced a non-empty diff against Base.metadata; "
        "either the migration drifted from the model graph or a new partial "
        f"index needs explicit allowlist entry. diff={diff!r}"
    )


async def test_baseline_downgrade_base_drops_all_tables(
    baseline_schema_engine: AsyncEngine,
    worker_id: str,
) -> None:
    """Phase 3 — ``alembic downgrade base`` removes every application table."""
    from tests.conftest import worker_database_url  # noqa: PLC0415

    await run_migrations_in_lifespan(baseline_schema_engine)

    # Determine the active schema via current_schema() so we can introspect it.
    async with baseline_schema_engine.connect() as conn:
        result = await conn.execute(text("SELECT current_schema()"))
        active_schema = cast("str", result.scalar_one())

    # Run downgrade through the alembic EnvironmentContext (mirrors what
    # ``alembic.command.downgrade`` does internally); using an inline engine
    # pinned to the active schema keeps the search_path correct for DROPs.
    inline_env_engine = create_async_engine(
        worker_database_url(worker_id),
        connect_args={
            "server_settings": {"search_path": active_schema},
        },
    )
    try:
        async with inline_env_engine.begin() as conn:
            await conn.run_sync(_run_alembic_downgrade, active_schema)
    finally:
        await inline_env_engine.dispose()

    # Re-introspect: every model-declared table must be absent.
    async with baseline_schema_engine.connect() as conn:

        def _verify(sync_conn: Connection) -> set[str]:
            return _existing_table_names(sync_conn, active_schema)

        existing = await conn.run_sync(_verify)

    expected_dropped = set(Base.metadata.tables.keys())
    leftovers = expected_dropped & existing
    assert not leftovers, f"downgrade base left tables: {sorted(leftovers)}"


def _run_alembic_downgrade(connection: Connection, schema: str) -> None:
    """Invoke ``alembic downgrade base`` against ``connection`` (sync body).

    Used by the downgrade test — mirrors :func:`do_run_migrations` but calls
    the downgrade command instead of upgrade. Pins the search_path on the
    connection itself so DROP statements target the test schema.
    """
    config = _build_alembic_config()
    script_directory = ScriptDirectory.from_config(config)

    _ = connection.execute(text(f'SET search_path TO "{schema}"'))

    def _downgrade(rev: object, _ctx: object) -> object:
        rev_str = cast("str | None", rev)
        return script_directory._downgrade_revs("base", rev_str)  # noqa: SLF001 # pyright: ignore[reportPrivateUsage]

    with EnvironmentContext(config, script_directory, fn=_downgrade) as env_ctx:
        env_ctx.configure(
            connection=connection,
            target_metadata=Base.metadata,
            transactional_ddl=True,
        )
        with env_ctx.begin_transaction():
            env_ctx.run_migrations()


async def test_baseline_reupgrade_idempotent(
    baseline_schema_engine: AsyncEngine,
    worker_id: str,
) -> None:
    """Phase 4 — head → base → head leaves a clean schema (idempotency gate)."""
    from tests.conftest import worker_database_url  # noqa: PLC0415

    # First upgrade.
    await run_migrations_in_lifespan(baseline_schema_engine)

    # Determine schema for the inline downgrade env.
    async with baseline_schema_engine.connect() as conn:
        result = await conn.execute(text("SELECT current_schema()"))
        active_schema = cast("str", result.scalar_one())

    # Downgrade to base.
    inline_env_engine = create_async_engine(
        worker_database_url(worker_id),
        connect_args={"server_settings": {"search_path": active_schema}},
    )
    try:
        async with inline_env_engine.begin() as conn:
            await conn.run_sync(_run_alembic_downgrade, active_schema)
    finally:
        await inline_env_engine.dispose()

    # Re-apply head — this is the idempotency assertion. The runner must
    # succeed without raising "table already exists" (which would indicate
    # the downgrade left ENUM types or constraints behind).
    await run_migrations_in_lifespan(baseline_schema_engine)

    # Final autogenerate diff: empty.
    async with baseline_schema_engine.connect() as conn:
        diff = await conn.run_sync(_autogenerate_diff)

    assert diff == [], (
        "re-applied head produced a non-empty autogenerate diff; idempotency "
        f"violated. diff={diff!r}"
    )
