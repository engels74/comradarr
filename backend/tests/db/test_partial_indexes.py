"""Partial-index ``WHERE`` clause introspection (plan §3 Milestone 10 step 46).

Two indexes carry a ``postgresql_where`` predicate that autogenerate cannot
round-trip: ``ix_search_schedule_active`` (``WHERE NOT paused``) and
``ix_planned_commands_pending`` (``WHERE status = 'pending'``). Both are
deliberately excluded from ``test_alembic_baseline.py``'s autogenerate diff
via the tight allowlist. This module is the substitute coverage (plan §6 R2):
introspect ``pg_indexes`` and assert the actual ``WHERE`` clause text the
migration produced is what PRD §10 / Phase 9 require.

PostgreSQL canonicalizes index predicates — ``NOT paused`` round-trips as
``(NOT paused)`` and ``status = 'pending'`` becomes
``(status = 'pending'::command_status)`` once the ENUM type binding lands.
The assertions accept either form by substring match on the canonical
fragment.

The session-scoped ``db_engine`` fixture (already at head against
``wid_<worker>``) is fine to reuse here — we only read ``pg_indexes`` and
do not mutate schema state.
"""

from typing import TYPE_CHECKING, cast

import pytest
from sqlalchemy.sql import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine


pytestmark = pytest.mark.integration


async def _read_partial_index_predicate(
    engine: AsyncEngine,
    table_name: str,
    index_name: str,
) -> str:
    """Return the ``indexdef`` text for ``index_name`` on ``table_name``.

    Looks the index up in ``pg_indexes`` filtered by the connection's
    ``current_schema()`` (which the db_engine fixture pins to ``wid_<worker>``).
    Returns the full ``CREATE INDEX ... WHERE ...`` definition; callers
    substring-match the WHERE-clause fragment.
    """
    # Query is fully static; ``:tablename`` and ``:indexname`` are bound
    # parameters routed through SQLAlchemy's parameter binding (no identifier
    # interpolation). S608 false positive — silenced via per-file-ignore in
    # pyproject.toml.
    query = text(
        "SELECT indexdef FROM pg_indexes "
        + "WHERE schemaname = current_schema() "
        + "AND tablename = :tablename "
        + "AND indexname = :indexname",
    )
    async with engine.connect() as conn:
        result = await conn.execute(
            query,
            {"tablename": table_name, "indexname": index_name},
        )
        row = result.first()
        assert row is not None, (
            f"partial index {index_name} not found on {table_name} in "
            "current_schema(); migration drift or schema not at head"
        )
        return cast("str", row[0])


async def test_search_schedule_active_partial_where_clause(
    db_engine: AsyncEngine,
) -> None:
    """``ix_search_schedule_active`` carries ``WHERE NOT paused`` predicate."""
    indexdef = await _read_partial_index_predicate(
        db_engine,
        "search_schedule",
        "ix_search_schedule_active",
    )
    # Postgres canonicalizes the predicate body. Accept the canonical
    # parenthesized form ``WHERE (NOT paused)`` or the raw form.
    assert "WHERE" in indexdef, (
        f"ix_search_schedule_active is not partial: {indexdef!r} "
        "(missing WHERE clause; plan §6 R2 violation)"
    )
    where_fragment = indexdef.split("WHERE", maxsplit=1)[1]
    assert "NOT paused" in where_fragment, (
        f"ix_search_schedule_active WHERE clause is not 'NOT paused': {where_fragment!r}"
    )


async def test_planned_commands_pending_partial_where_clause(
    db_engine: AsyncEngine,
) -> None:
    """``ix_planned_commands_pending`` carries ``WHERE status = 'pending'`` predicate."""
    indexdef = await _read_partial_index_predicate(
        db_engine,
        "planned_commands",
        "ix_planned_commands_pending",
    )
    assert "WHERE" in indexdef, (
        f"ix_planned_commands_pending is not partial: {indexdef!r} "
        "(missing WHERE clause; plan §6 R2 violation)"
    )
    where_fragment = indexdef.split("WHERE", maxsplit=1)[1]
    # PG canonicalizes to ``(status = 'pending'::command_status)`` once the
    # ENUM type binds. Substring match on the load-bearing pieces tolerates
    # both the raw and the cast form.
    assert "status" in where_fragment and "'pending'" in where_fragment, (
        f"ix_planned_commands_pending WHERE clause does not match "
        f"status = 'pending': {where_fragment!r}"
    )
