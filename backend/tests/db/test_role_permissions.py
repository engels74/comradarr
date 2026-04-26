"""Three-role / GRANT-matrix security gate (plan §3 Milestone 10 step 44).

This is the security gate for Phase 2: the role-permission matrix from
PRD §8 is empirically validated against the live schema's ``GRANT`` state.
A regression in the migration's GRANT block — or a future model addition
that forgets to extend ``TABLES_FOR_APP_GRANT`` / ``TABLES_FOR_AUDIT_GRANT``
— fails this suite immediately.

Coverage (drives 200+ pytest invocations):

* **Audit-log carve-out — 8 explicit cells** (plan §3 Milestone 10 step 44):
  ``comradarr_app`` SELECT/INSERT succeed; UPDATE/DELETE raise
  ``InsufficientPrivilege``. ``comradarr_audit_admin`` SELECT/DELETE succeed;
  INSERT/UPDATE raise ``InsufficientPrivilege``.

* **FK cascade under ``comradarr_app``** (plan §6 N1 + Q3): the
  ``audit_log.actor_user_id`` FK is ``ON DELETE SET NULL``. The cascade
  action runs with the table-owner's privileges, so deleting a referenced
  user clears the FK column even though ``comradarr_app`` lacks UPDATE on
  ``audit_log``.

* **All-tables matrix** — parametrized across ``Base.metadata.tables.values()``:
  - ``comradarr_app`` × every non-audit table × {SELECT, INSERT, UPDATE, DELETE}
    succeed (or skip with reason for tables whose NOT-NULL non-defaulted
    columns the parametrized inserter can't fill).
  - ``comradarr_audit_admin`` × every non-audit table × all 4 ops raise
    ``InsufficientPrivilege``.
  - ``comradarr_migration`` × every table × {UPDATE, DELETE} succeed.

* **Sentinel** — the parametrized matrix iterates EXACTLY
  ``len(Base.metadata.tables) == 22`` tables. A future model addition that
  is not auto-covered by the parametrize fails this guard.

RULE-AUTHZ-MATCH-001 attestation: this is RBAC at the DB layer, not
allowlist-comparator code. The discipline is analogous though — the matrix
auto-extends from ``Base.metadata.tables.values()``; the sentinel asserts
coverage. A new table without a corresponding GRANT entry in the migration
fails the matrix on first contact.

ANTI-105 attestation: ``SET ROLE`` requires an outer transaction so the
``RESET ROLE`` (or transaction rollback) restores the original privileges.
Each test takes a connection from ``db_engine``, opens its own
``BEGIN`` / ``ROLLBACK`` window, and never lets a ``SET ROLE`` leak into
another test's connection pool slot.
"""

import secrets
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

import pytest
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.sql import text

import comradarr.db.models  # noqa: F401  # pyright: ignore[reportUnusedImport]
from comradarr.db.base import Base

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine


pytestmark = pytest.mark.integration


_AUDIT_TABLE = "audit_log"

_APP_ROLE = "comradarr_app"
_AUDIT_ADMIN_ROLE = "comradarr_audit_admin"
_MIGRATION_ROLE = "comradarr_migration"

# Canonical PRD §8 Appendix B count. Keeping this as a literal lets the
# sentinel test catch silent regressions in either ``Base.metadata`` or the
# parametrized matrix list.
_EXPECTED_TABLE_COUNT: int = 22


# ---------------------------------------------------------------------------
# Connection helpers — every test owns its own connection + transaction so
# SET ROLE does not leak across pool slots (ANTI-105).
# ---------------------------------------------------------------------------


async def _set_role(conn: AsyncConnection, role: str) -> None:
    """Set the connection's effective role inside the active transaction.

    ``SET LOCAL`` scopes the role change to the current transaction so the
    finalizer's ``ROLLBACK`` (or an explicit ``RESET ROLE``) restores the
    pool slot to its original identity (ANTI-105). The conftest's
    ``db_engine`` fixture grants ``USAGE`` on the per-worker test schema to
    all three roles so unqualified table lookups via ``search_path`` resolve
    after the role switch.
    """
    _ = await conn.execute(text(f'SET LOCAL ROLE "{role}"'))


def _short_id() -> str:
    """Return a short, collision-resistant suffix for unique test rows."""
    return secrets.token_hex(4)


async def _insert_user(conn: AsyncConnection) -> uuid.UUID:
    """Insert a minimal user row and return its id.

    Used by the audit-log carve-out tests (need a row to FK-reference) and
    by the FK-cascade test (need a user to delete). Performed under whatever
    role is active on ``conn`` — callers SET ROLE before calling.
    """
    user_id = uuid.uuid7()
    suffix = _short_id()
    now = datetime.now(tz=UTC)
    _ = await conn.execute(
        text(
            "INSERT INTO users (id, email, username, role, "
            + "provisioning_provider, created_at, updated_at) "
            + "VALUES (:id, :email, :username, 'viewer', 'local', :now, :now)",
        ),
        {
            "id": user_id,
            "email": f"role-test-{suffix}@example.invalid",
            "username": f"role-test-{suffix}",
            "now": now,
        },
    )
    return user_id


async def _insert_audit_row(
    conn: AsyncConnection,
    *,
    actor_user_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """Insert a minimal audit_log row and return its id."""
    audit_id = uuid.uuid7()
    _ = await conn.execute(
        text(
            "INSERT INTO audit_log (id, timestamp, action, actor_user_id, context) "
            + "VALUES (:id, :ts, 'user.login.succeeded', :actor, '{}'::jsonb)",
        ),
        {
            "id": audit_id,
            "ts": datetime.now(tz=UTC),
            "actor": actor_user_id,
        },
    )
    return audit_id


# ---------------------------------------------------------------------------
# Audit-log carve-out — 8 explicit cells (plan §3 Milestone 10 step 44).
# ---------------------------------------------------------------------------


async def test_app_can_insert_into_audit_log(db_engine: AsyncEngine) -> None:
    """Cell 1: comradarr_app INSERT INTO audit_log succeeds."""
    async with db_engine.connect() as conn:
        trans = await conn.begin()
        try:
            await _set_role(conn, _APP_ROLE)
            audit_id = await _insert_audit_row(conn)
            assert audit_id is not None
        finally:
            await trans.rollback()


async def test_app_can_select_from_audit_log(db_engine: AsyncEngine) -> None:
    """Cell 2: comradarr_app SELECT FROM audit_log succeeds."""
    async with db_engine.connect() as conn:
        trans = await conn.begin()
        try:
            await _set_role(conn, _APP_ROLE)
            result = await conn.execute(text("SELECT COUNT(*) FROM audit_log"))
            count = cast("int | None", result.scalar_one())
            assert count is not None  # SELECT-PRIV proven by absence of exception
        finally:
            await trans.rollback()


async def test_app_cannot_update_audit_log(db_engine: AsyncEngine) -> None:
    """Cell 3: comradarr_app UPDATE audit_log raises InsufficientPrivilege."""
    async with db_engine.connect() as conn:
        # Seed a row as migration role; the UPDATE attempt then runs as app.
        outer = await conn.begin()
        try:
            await _set_role(conn, _MIGRATION_ROLE)
            audit_id = await _insert_audit_row(conn)
            await _set_role(conn, _APP_ROLE)
            with pytest.raises(ProgrammingError) as excinfo:
                _ = await conn.execute(
                    text("UPDATE audit_log SET context = '{}'::jsonb WHERE id = :id"),
                    {"id": audit_id},
                )
            assert "permission denied" in str(excinfo.value).lower(), (
                f"expected InsufficientPrivilege on UPDATE audit_log; got: {excinfo.value!r}"
            )
        finally:
            await outer.rollback()


async def test_app_cannot_delete_from_audit_log(db_engine: AsyncEngine) -> None:
    """Cell 4: comradarr_app DELETE FROM audit_log raises InsufficientPrivilege."""
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _MIGRATION_ROLE)
            audit_id = await _insert_audit_row(conn)
            await _set_role(conn, _APP_ROLE)
            with pytest.raises(ProgrammingError) as excinfo:
                _ = await conn.execute(
                    text("DELETE FROM audit_log WHERE id = :id"),
                    {"id": audit_id},
                )
            assert "permission denied" in str(excinfo.value).lower(), (
                f"expected InsufficientPrivilege on DELETE audit_log; got: {excinfo.value!r}"
            )
        finally:
            await outer.rollback()


async def test_audit_admin_can_select_from_audit_log(db_engine: AsyncEngine) -> None:
    """Cell 5: comradarr_audit_admin SELECT FROM audit_log succeeds."""
    async with db_engine.connect() as conn:
        trans = await conn.begin()
        try:
            await _set_role(conn, _AUDIT_ADMIN_ROLE)
            result = await conn.execute(text("SELECT COUNT(*) FROM audit_log"))
            count = cast("int | None", result.scalar_one())
            assert count is not None
        finally:
            await trans.rollback()


async def test_audit_admin_can_delete_from_audit_log(db_engine: AsyncEngine) -> None:
    """Cell 6: comradarr_audit_admin DELETE FROM audit_log succeeds."""
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _MIGRATION_ROLE)
            audit_id = await _insert_audit_row(conn)
            await _set_role(conn, _AUDIT_ADMIN_ROLE)
            _ = await conn.execute(
                text("DELETE FROM audit_log WHERE id = :id"),
                {"id": audit_id},
            )
        finally:
            await outer.rollback()


async def test_audit_admin_cannot_insert_into_audit_log(db_engine: AsyncEngine) -> None:
    """Cell 7: comradarr_audit_admin INSERT raises InsufficientPrivilege."""
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _AUDIT_ADMIN_ROLE)
            with pytest.raises(ProgrammingError) as excinfo:
                _ = await _insert_audit_row(conn)
            assert "permission denied" in str(excinfo.value).lower(), (
                f"expected InsufficientPrivilege on INSERT audit_log; got: {excinfo.value!r}"
            )
        finally:
            await outer.rollback()


async def test_audit_admin_cannot_update_audit_log(db_engine: AsyncEngine) -> None:
    """Cell 8: comradarr_audit_admin UPDATE raises InsufficientPrivilege."""
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _MIGRATION_ROLE)
            audit_id = await _insert_audit_row(conn)
            await _set_role(conn, _AUDIT_ADMIN_ROLE)
            with pytest.raises(ProgrammingError) as excinfo:
                _ = await conn.execute(
                    text("UPDATE audit_log SET context = '{}'::jsonb WHERE id = :id"),
                    {"id": audit_id},
                )
            assert "permission denied" in str(excinfo.value).lower(), (
                f"expected InsufficientPrivilege on UPDATE audit_log; got: {excinfo.value!r}"
            )
        finally:
            await outer.rollback()


# ---------------------------------------------------------------------------
# FK cascade under comradarr_app — closes plan §6 N1.
# ---------------------------------------------------------------------------


async def test_audit_log_actor_user_id_fk_cascade_under_app_role(
    db_engine: AsyncEngine,
) -> None:
    """DELETE user → audit row's actor_user_id becomes NULL (under comradarr_app).

    The FK is ``ON DELETE SET NULL``. The SET-NULL cascade action runs with
    the table-owner's privileges (Postgres semantics), so even though
    ``comradarr_app`` lacks UPDATE on ``audit_log``, the cascade succeeds.
    Asserts (a) DELETE succeeds (no InsufficientPrivilege), (b) the audit
    row still exists, (c) ``actor_user_id IS NULL`` after the cascade.
    """
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _APP_ROLE)
            user_id = await _insert_user(conn)
            audit_id = await _insert_audit_row(conn, actor_user_id=user_id)

            # The FK cascade fires when the user is deleted.
            _ = await conn.execute(
                text("DELETE FROM users WHERE id = :id"),
                {"id": user_id},
            )

            # Audit row survives; FK column is NULL.
            row_result = await conn.execute(
                text("SELECT actor_user_id FROM audit_log WHERE id = :id"),
                {"id": audit_id},
            )
            row = row_result.first()
            assert row is not None, (
                "FK cascade dropped the audit row — expected SET NULL, got CASCADE-DELETE"
            )
            actor_after = cast("uuid.UUID | None", row[0])
            assert actor_after is None, (
                f"FK cascade did not null actor_user_id; got {actor_after!r}"
            )
        finally:
            await outer.rollback()


# ---------------------------------------------------------------------------
# Sentinel — assert the parametrized matrix iterates 22 tables.
# ---------------------------------------------------------------------------


def test_parametrized_matrix_covers_all_tables() -> None:
    """Sentinel: ``Base.metadata.tables`` has exactly the canonical 22 tables.

    Catches both directions: a model deletion that drops below 22 (silent
    coverage loss) and a model addition that pushes above 22 without an
    accompanying GRANT extension (would silently widen the matrix without
    forcing a review of the migration's GRANT block).
    """
    actual = len(Base.metadata.tables)
    assert actual == _EXPECTED_TABLE_COUNT, (
        f"Base.metadata has {actual} tables; expected {_EXPECTED_TABLE_COUNT} "
        "(PRD §8 Appendix B). A new table needs a GRANT-list extension in "
        "backend/migrations/versions/361c239a829d_v1_baseline_schema.py — "
        "see TABLES_FOR_APP_GRANT / TABLES_FOR_AUDIT_GRANT."
    )


# ---------------------------------------------------------------------------
# All-tables matrix — drives ~200 invocations across 22 × 4 × 3.
# ---------------------------------------------------------------------------


# A fixed sentinel UUID lets the matrix execute UPDATE/DELETE statements that
# match zero rows but still need to PARSE successfully — Postgres checks
# privileges before evaluating the WHERE clause, so a 0-row UPDATE under
# comradarr_audit_admin still raises InsufficientPrivilege.
_SENTINEL_UUID = uuid.UUID("00000000-0000-7000-8000-000000000000")
_SENTINEL_INT = -2_147_483_647  # min(int4) + 1 — guaranteed not to clash


def _all_tables() -> list[str]:
    """Return the canonical sorted list of table names from ``Base.metadata``.

    Sorted for deterministic pytest test-id ordering. The list literal is
    NOT hardcoded — it's driven from ``Base.metadata.tables.values()`` per
    the spec, so a new model addition automatically extends coverage.
    """
    return sorted(Base.metadata.tables.keys())


def _non_audit_tables() -> list[str]:
    return [t for t in _all_tables() if t != _AUDIT_TABLE]


def _pk_col(table_name: str) -> str:
    """Return the first primary-key column for ``table_name``.

    The UPDATE privilege probe uses ``SET <pk> = <pk> WHERE FALSE`` — a
    no-op self-assignment on a real, regular column. We can't use a
    Postgres system column (``tableoid``, ``ctid``) because the parser
    rejects ``SET tableoid = tableoid`` before reaching the privilege
    check. Picking the PK guarantees a non-NULL, non-computed regular
    column on every table including the composite-PK ``api_key_scopes``
    junction.
    """
    table = Base.metadata.tables[table_name]
    pk_cols: list[str] = [c.name for c in table.primary_key.columns]
    return pk_cols[0]


@pytest.mark.parametrize("table_name", _non_audit_tables())
async def test_audit_admin_select_denied_on_non_audit_tables(
    db_engine: AsyncEngine,
    table_name: str,
) -> None:
    """comradarr_audit_admin SELECT on every non-audit table is denied."""
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _AUDIT_ADMIN_ROLE)
            with pytest.raises(ProgrammingError) as excinfo:
                _ = await conn.execute(text(f'SELECT 1 FROM "{table_name}" LIMIT 1'))
            assert "permission denied" in str(excinfo.value).lower(), (
                f"expected InsufficientPrivilege on SELECT {table_name} as "
                f"audit_admin; got: {excinfo.value!r}"
            )
        finally:
            await outer.rollback()


@pytest.mark.parametrize("table_name", _non_audit_tables())
async def test_audit_admin_insert_denied_on_non_audit_tables(
    db_engine: AsyncEngine,
    table_name: str,
) -> None:
    """comradarr_audit_admin INSERT on every non-audit table is denied.

    Issues a no-op INSERT that Postgres rejects on privilege grounds before
    parsing reaches column resolution. ``DEFAULT VALUES`` hits the same
    privilege check while sidestepping the column-names problem.
    """
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _AUDIT_ADMIN_ROLE)
            with pytest.raises(ProgrammingError) as excinfo:
                _ = await conn.execute(
                    text(f'INSERT INTO "{table_name}" DEFAULT VALUES'),
                )
            assert "permission denied" in str(excinfo.value).lower(), (
                f"expected InsufficientPrivilege on INSERT {table_name} as "
                f"audit_admin; got: {excinfo.value!r}"
            )
        finally:
            await outer.rollback()


@pytest.mark.parametrize("table_name", _non_audit_tables())
async def test_audit_admin_update_denied_on_non_audit_tables(
    db_engine: AsyncEngine,
    table_name: str,
) -> None:
    """comradarr_audit_admin UPDATE on every non-audit table is denied.

    Uses a guaranteed-false WHERE so the statement matches zero rows; the
    privilege check fires first and the test asserts the resulting
    ProgrammingError.
    """
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _AUDIT_ADMIN_ROLE)
            # `WHERE FALSE` matches zero rows but the privilege check still
            # fires; ``SET <pk> = <pk>`` is a no-op self-assign that parses
            # successfully on every table (system columns like ``tableoid``
            # are rejected at parse time, before the privilege check).
            pk = _pk_col(table_name)
            with pytest.raises(ProgrammingError) as excinfo:
                _ = await conn.execute(
                    text(f'UPDATE "{table_name}" SET "{pk}" = "{pk}" WHERE FALSE'),
                )
            assert "permission denied" in str(excinfo.value).lower(), (
                f"expected InsufficientPrivilege on UPDATE {table_name} as "
                f"audit_admin; got: {excinfo.value!r}"
            )
        finally:
            await outer.rollback()


@pytest.mark.parametrize("table_name", _non_audit_tables())
async def test_audit_admin_delete_denied_on_non_audit_tables(
    db_engine: AsyncEngine,
    table_name: str,
) -> None:
    """comradarr_audit_admin DELETE on every non-audit table is denied."""
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _AUDIT_ADMIN_ROLE)
            with pytest.raises(ProgrammingError) as excinfo:
                _ = await conn.execute(text(f'DELETE FROM "{table_name}" WHERE FALSE'))
            assert "permission denied" in str(excinfo.value).lower(), (
                f"expected InsufficientPrivilege on DELETE {table_name} as "
                f"audit_admin; got: {excinfo.value!r}"
            )
        finally:
            await outer.rollback()


@pytest.mark.parametrize("table_name", _non_audit_tables())
async def test_app_select_succeeds_on_non_audit_tables(
    db_engine: AsyncEngine,
    table_name: str,
) -> None:
    """comradarr_app SELECT on every non-audit table succeeds (privilege-only check)."""
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _APP_ROLE)
            # SELECT 1 ... LIMIT 1 is a privilege-only check — no row required.
            _ = await conn.execute(text(f'SELECT 1 FROM "{table_name}" LIMIT 1'))
        finally:
            await outer.rollback()


@pytest.mark.parametrize("table_name", _non_audit_tables())
async def test_app_update_privilege_present_on_non_audit_tables(
    db_engine: AsyncEngine,
    table_name: str,
) -> None:
    """comradarr_app UPDATE on every non-audit table is permitted (no privilege error).

    The matrix asserts the *privilege*, not the *outcome*. Constructing a
    valid row for every table's full NOT-NULL column shape is out of scope
    for this matrix. ``UPDATE ... WHERE FALSE`` runs the privilege check
    without modifying any row; if comradarr_app lacks UPDATE on this table,
    Postgres raises ProgrammingError (which fails this test).
    """
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _APP_ROLE)
            pk = _pk_col(table_name)
            _ = await conn.execute(
                text(f'UPDATE "{table_name}" SET "{pk}" = "{pk}" WHERE FALSE'),
            )
        finally:
            await outer.rollback()


@pytest.mark.parametrize("table_name", _non_audit_tables())
async def test_app_delete_privilege_present_on_non_audit_tables(
    db_engine: AsyncEngine,
    table_name: str,
) -> None:
    """comradarr_app DELETE on every non-audit table is permitted."""
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _APP_ROLE)
            _ = await conn.execute(text(f'DELETE FROM "{table_name}" WHERE FALSE'))
        finally:
            await outer.rollback()


@pytest.mark.parametrize("table_name", _non_audit_tables())
async def test_app_insert_privilege_present_on_non_audit_tables(
    db_engine: AsyncEngine,
    table_name: str,
) -> None:
    """comradarr_app INSERT privilege is granted on every non-audit table.

    Substitute coverage for ``INSERT DEFAULT VALUES`` (which would fail on
    NOT-NULL columns regardless of privilege): we issue an
    ``INSERT ... SELECT WHERE FALSE`` that produces zero rows. The privilege
    check fires; the row count is zero; we assert the absence of a
    ProgrammingError.
    """
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _APP_ROLE)
            # Empty SELECT bypasses NOT-NULL constraints — privilege-only check.
            _ = await conn.execute(
                text(f'INSERT INTO "{table_name}" SELECT * FROM "{table_name}" WHERE FALSE'),
            )
        finally:
            await outer.rollback()


@pytest.mark.parametrize("table_name", _all_tables())
async def test_migration_update_privilege_present_on_all_tables(
    db_engine: AsyncEngine,
    table_name: str,
) -> None:
    """comradarr_migration UPDATE privilege is granted on every table (incl. audit_log)."""
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _MIGRATION_ROLE)
            pk = _pk_col(table_name)
            _ = await conn.execute(
                text(f'UPDATE "{table_name}" SET "{pk}" = "{pk}" WHERE FALSE'),
            )
        finally:
            await outer.rollback()


@pytest.mark.parametrize("table_name", _all_tables())
async def test_migration_delete_privilege_present_on_all_tables(
    db_engine: AsyncEngine,
    table_name: str,
) -> None:
    """comradarr_migration DELETE privilege is granted on every table (incl. audit_log)."""
    async with db_engine.connect() as conn:
        outer = await conn.begin()
        try:
            await _set_role(conn, _MIGRATION_ROLE)
            _ = await conn.execute(text(f'DELETE FROM "{table_name}" WHERE FALSE'))
        finally:
            await outer.rollback()


# Suppress unused-name warnings on the sentinel constants — they document
# intent for future test extensions even when not directly referenced here.
_ = _SENTINEL_UUID
_ = _SENTINEL_INT
