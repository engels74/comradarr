"""Shared Alembic runner — CLI + Litestar lifespan call into the same body.

The Alembic CLI (``backend/migrations/env.py``) and the Litestar lifespan
(``comradarr.core.lifespan.db_lifespan``) historically diverged on startup
behavior — only the CLI checked for required Postgres roles, only the
lifespan paid attention to the runtime DSN. Centralizing the body here means
both call sites get the same advisory-lock and preflight semantics.

Highlights:

* :data:`MIGRATION_ADVISORY_LOCK_ID` — Comradarr's reserved 64-bit Postgres
  advisory-lock id. Held transaction-scoped (``pg_advisory_xact_lock``) so
  parallel multi-worker startups serialize cleanly. ANTI-137 attestation:
  using ``pg_advisory_xact_lock`` (not the session-scoped variant) means the
  lock is auto-released on COMMIT/ROLLBACK and never strands on a pooled
  connection that gets returned mid-lock.
* :func:`do_run_migrations` — synchronous Alembic body invoked through
  ``connection.run_sync``. Acquires the advisory lock BEFORE
  ``context.run_migrations()`` and pins ``transactional_ddl=True`` so Alembic
  does not internally check out a separate connection that would escape the
  outer-transaction lock scope. ANTI-135 attestation: structural defense
  against silent migration-on-startup failures.
* :func:`preflight_role_check` — async; queries ``pg_roles`` for the three
  Comradarr roles (``comradarr_migration``, ``comradarr_app``,
  ``comradarr_audit_admin``). If any are missing AND the connect user does
  not hold ``rolcreaterole``, raises a structured
  :class:`ConfigurationError` pointing at the runbook, instead of letting
  the per-row ``CREATE ROLE`` inside the migration explode with a permission
  stack trace.
* :func:`run_migrations_in_lifespan` — high-level entrypoint the lifespan
  uses. Bridges async → sync via ``engine.begin()`` (NOT ``engine.connect()``
  — the advisory lock needs an outer transaction to attach to).
"""

from pathlib import Path
from typing import TYPE_CHECKING, cast

import structlog
from sqlalchemy import text

from comradarr.errors.configuration import ConfigurationError

# Computed at import time so the async lifespan path doesn't pay the
# ``Path.resolve`` syscall (and so async-lint stays clean). ``__file__`` here
# is backend/src/comradarr/db/migrations.py — parents[3] == backend/.
_SCRIPT_LOCATION: str = str(Path(__file__).resolve().parents[3] / "migrations")

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection
    from sqlalchemy.ext.asyncio import AsyncEngine


_logger = structlog.stdlib.get_logger(__name__)


MIGRATION_ADVISORY_LOCK_ID: int = 0xC0DEBA52
"""Reserved 64-bit Postgres advisory lock id used for migration serialization.

The constant intentionally lives at module scope so tests, ops tooling, and
ad-hoc psql sessions can reference the same identifier without re-deriving
it. Acquired via ``pg_advisory_xact_lock`` (transaction-scoped) per ANTI-137.
"""


_REQUIRED_ROLES: tuple[str, ...] = (
    "comradarr_migration",
    "comradarr_app",
    "comradarr_audit_admin",
)


# Tight allowlist of (table_name, index_name) pairs that autogenerate cannot
# round-trip cleanly. Two failure modes are covered:
#
# * **Partial indexes** — Postgres canonicalizes the WHERE clause
#   (``status = 'pending'`` → ``status = 'pending'::command_status``) which
#   autogenerate sees as a non-empty diff against the model's literal text.
# * **DESC-ordered indexes** — DB-side introspection returns a
#   ``UnaryExpression`` placeholder for the descending column, hiding the
#   underlying column reference from ``compare_metadata``; the model side
#   reports the raw column. Autogenerate emits a spurious remove+add pair.
#
# The companion ``test_partial_indexes.py`` introspects ``pg_indexes`` to
# assert the actual WHERE clauses are present — so the substitute coverage
# from plan §6 R2 is preserved despite the allowlist. Adding a third entry
# requires an explicit review against R2.
AUTOGEN_DRIFT_ALLOWLIST: tuple[tuple[str, str], ...] = (
    ("search_schedule", "ix_search_schedule_active"),
    ("planned_commands", "ix_planned_commands_pending"),
    ("audit_log", "ix_audit_log_action_timestamp_desc"),
    ("audit_log", "ix_audit_log_timestamp_desc"),
    # Phase 4 partial unique index — Postgres canonicalizes the WHERE clause to
    # include an explicit cast (``'oidc'::provisioning_provider``) that
    # autogenerate cannot round-trip against the model's literal text.
    ("users", "ix_users_oidc_subject_where_oidc"),
)


def filter_autogen_drift(
    obj: object,
    name: str | None,
    type_: str,
    _reflected: bool,  # noqa: FBT001  # alembic API shape; underscore = unused
    _compare_to: object,
) -> bool:
    """Exclude allowlisted indexes from autogenerate diffs.

    Wired into ``context.configure(include_object=...)`` from both the
    runtime path (``do_run_migrations`` — covers ``alembic check``) and
    the in-process test path (``test_alembic_baseline.py``) so the two
    autogenerate surfaces produce identical diff lists. Returning
    ``False`` skips the index entirely from the diff.
    """
    if type_ != "index":
        return True
    table = cast("object", getattr(obj, "table", None))
    table_name: str | None = (
        cast("str | None", getattr(table, "name", None)) if table is not None else None
    )
    for allowed_table, allowed_index in AUTOGEN_DRIFT_ALLOWLIST:
        if name == allowed_index and (table_name is None or table_name == allowed_table):
            return False
    return True


def do_run_migrations(connection: Connection) -> None:
    """Run Alembic upgrades against ``connection`` under the advisory lock.

    Invoked through ``await conn.run_sync(do_run_migrations)`` from both the
    CLI (``migrations/env.py``) and the Litestar lifespan
    (:func:`run_migrations_in_lifespan`). Acquires
    :data:`MIGRATION_ADVISORY_LOCK_ID` BEFORE ``context.run_migrations()`` so
    parallel callers serialize through the lock — non-winners observe
    ``head == current`` and exit cleanly without re-running the upgrade.

    ``transactional_ddl=True`` is pinned on ``context.configure(...)`` so
    Alembic does not internally check out a separate connection (which would
    escape the outer-transaction lock scope and break ANTI-137).
    """
    # Imported lazily so this module does not pay the alembic / Base import
    # cost at boot time — the runtime path crosses through ``run_sync``, and
    # the CLI path already has alembic imported. Importing ``Base`` here
    # (rather than at module top) also avoids a circular-import risk when
    # ORM model files import ``comradarr.db.migrations``.
    from alembic import context  # noqa: PLC0415

    import comradarr.db.models  # noqa: F401, PLC0415  # autogenerate registration  # pyright: ignore[reportUnusedImport]
    from comradarr.db.base import Base  # noqa: PLC0415

    _ = connection.execute(
        text("SELECT pg_advisory_xact_lock(:lock_id)"),
        {"lock_id": MIGRATION_ADVISORY_LOCK_ID},
    )
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        transactional_ddl=True,
        # ``include_object`` is consulted only by autogenerate
        # (``alembic check`` / ``alembic revision --autogenerate``); it is a
        # no-op for ``alembic upgrade``. Wiring it here makes ``alembic check``
        # honor the same allowlist the in-process tests apply, so a
        # successful check in the suite implies a clean operator-side check.
        include_object=filter_autogen_drift,
    )
    with context.begin_transaction():
        context.run_migrations()


async def preflight_role_check(engine: AsyncEngine) -> None:
    """Fail fast with a structured error when the 3 required roles are absent.

    Both the CLI script and the lifespan path call this BEFORE invoking the
    migration body. Otherwise an operator on a managed-Postgres deployment
    that forgot to pre-create the roles would see a stack trace from the
    role-creation block in ``upgrade()`` instead of the actionable
    ``ConfigurationError`` pointing at ``docs/runbook/postgres-roles.md``.

    The check is intentionally cheap — two short SQL statements, no DDL —
    so adding it to the lifespan path does not slow boot detectably.
    """
    async with engine.connect() as conn:
        roles_result = await conn.execute(
            text("SELECT rolname FROM pg_roles WHERE rolname = ANY(:names)"),
            {"names": list(_REQUIRED_ROLES)},
        )
        present_roles = {row[0] for row in roles_result.all()}

        creator_result = await conn.execute(
            text("SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user"),
        )
        creator_row = creator_result.first()
        connect_user_can_createrole: bool = (
            creator_row[0] is True if creator_row is not None else False
        )

    missing_roles = [role for role in _REQUIRED_ROLES if role not in present_roles]
    if missing_roles and not connect_user_can_createrole:
        _logger.error(
            "migrations.preflight.roles_missing",
            missing=missing_roles,
            connect_user_has_createrole=connect_user_can_createrole,
        )
        raise ConfigurationError(
            "postgres roles missing and connect user lacks CREATEROLE; see docs/runbook/postgres-roles.md",  # noqa: E501
        )

    _logger.info(
        "migrations.preflight.ok",
        present_roles=sorted(present_roles),
        connect_user_has_createrole=connect_user_can_createrole,
    )


async def run_migrations_in_lifespan(engine: AsyncEngine) -> None:
    """Async entrypoint used by the Litestar lifespan (RULE-ASYNC-002 bridge).

    Order of operations is load-bearing:

    1. :func:`preflight_role_check` raises a structured error early when the
       roles are missing, instead of letting the migration body explode.
    2. Build an :class:`EnvironmentContext` with an explicit
       ``upgrade`` migration function (mirrors ``alembic.command.upgrade``'s
       internal closure) so Alembic's ``context.configure`` proxy and its
       ``run_migrations`` dispatcher are both wired before
       :func:`do_run_migrations` runs.
    3. ``async with engine.begin() as conn`` opens an *outer* transaction so
       :func:`do_run_migrations` can attach ``pg_advisory_xact_lock`` to it.
    4. ``await conn.run_sync(_do_run_with_env)`` bridges async → sync.

    Concurrency: the advisory lock guarantees that N replicas calling this
    in parallel serialize. Non-winners observe ``head == current`` and exit
    cleanly — Alembic's own no-op fast path runs once they get the lock.
    """
    from alembic.config import Config as AlembicConfig  # noqa: PLC0415
    from alembic.runtime.environment import EnvironmentContext  # noqa: PLC0415
    from alembic.script import ScriptDirectory  # noqa: PLC0415

    await preflight_role_check(engine)

    # Build a minimal Alembic Config + ScriptDirectory pointing at backend/migrations.
    alembic_config = AlembicConfig()
    alembic_config.set_main_option("script_location", _SCRIPT_LOCATION)
    script_directory = ScriptDirectory.from_config(alembic_config)

    # Mirror of ``alembic.command.upgrade``'s internal ``upgrade(rev, context)``
    # closure — returns the list of migration steps from the DB's current
    # revision up to ``head``. Wiring this through ``EnvironmentContext(fn=...)``
    # is what makes ``context.run_migrations()`` actually execute scripts.
    def _upgrade_to_head(rev: object, _ctx: object) -> object:
        return script_directory._upgrade_revs("head", rev)  # noqa: SLF001 # pyright: ignore[reportPrivateUsage,reportArgumentType]

    def _do_run_with_env(connection: Connection) -> None:
        with EnvironmentContext(alembic_config, script_directory, fn=_upgrade_to_head):
            do_run_migrations(connection)

    async with engine.begin() as conn:
        await conn.run_sync(_do_run_with_env)
    _logger.info("migrations.lifespan.complete")
