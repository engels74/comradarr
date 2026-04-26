"""``migrate`` console script — applies Alembic migrations from the CLI.

Plan §3 Milestone 8 (steps 29-33). The CLI sits alongside the lifespan
runner in :mod:`comradarr.db.migrations`: both call ``preflight_role_check``
first, then drive the same ``upgrade`` body. The split is load-bearing:

* The Litestar lifespan runs inside Granian's event loop, so it MUST bridge
  through ``connection.run_sync(do_run_migrations)`` (RULE-ASYNC-002).
* The CLI runs in a fresh process and owns its own loop, so it is allowed
  to call ``alembic.command.upgrade(config, "head")`` directly — the
  blocking Alembic command API is fine when nothing else is sharing the
  loop.

The CLI does NOT call ``logging.config.fileConfig(...)`` and does NOT pass a
positional ``file_=`` argument when constructing :class:`alembic.config.Config`
(C4 / RULE-LOG-001 — structlog is the project's sole logging surface).

Observability: emits two events through the structlog stdlib bridge —
``cli.migrate.begin`` (kwargs ``database_url_redacted``, ``current_revision``)
and ``cli.migrate.ok`` (kwargs ``from_revision``, ``to_revision``,
``elapsed_ms``). On any exception, emits ``cli.migrate.failed`` (kwarg
``error``) and exits 1.
"""

import asyncio
import re
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING, Final

import structlog
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.ext.asyncio import create_async_engine

from comradarr.config import load_settings
from comradarr.db.migrations import preflight_role_check
from comradarr.errors.configuration import ConfigurationError

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection
    from sqlalchemy.ext.asyncio import AsyncEngine


_logger = structlog.stdlib.get_logger(__name__)


# Resolve the Alembic ``script_location`` from this module's path so the CLI
# works regardless of the invocation cwd (``uv run migrate`` from project root,
# from ``backend/``, or from a packaged install). The path layout is fixed:
#
#   backend/src/comradarr/cli/migrate.py  →  parents[3] == backend/
#   backend/migrations/                   ←  alembic versions live here
#
# Using ``__file__`` keeps the spec's intent (``script_location = backend/migrations``
# relative to repo root) without making the operator promise to invoke from one
# particular cwd. ``Path.resolve()`` follows symlinks so editable installs
# (``uv pip install -e``) still resolve to the source tree.
_SCRIPT_LOCATION: Final[str] = str(Path(__file__).resolve().parents[3] / "migrations")

# Strip a `user:password@` userinfo block from a DSN before logging it so the
# password never lands in stdout (defense-in-depth — the structlog
# secret_pattern_redaction_processor catches stragglers, but the kwarg should
# be safe at the source). Matches `scheme://user:pwd@host` and rewrites to
# `scheme://<redacted>@host`.
_DSN_USERINFO_RE: Final = re.compile(r"^(?P<scheme>[^:]+://)[^/@]*@")


def _redact_dsn(database_url: str) -> str:
    """Return ``database_url`` with any ``user:password@`` block redacted."""
    return _DSN_USERINFO_RE.sub(r"\g<scheme><redacted>@", database_url)


def _build_alembic_config(database_url: str) -> AlembicConfig:
    """Build the Alembic Config WITHOUT ``fileConfig`` and WITHOUT positional ``file_=``.

    The default :class:`AlembicConfig` constructor accepts an optional
    positional ``file_`` argument that points at an ``alembic.ini``; passing
    one would invoke the bundled ``logging.config.fileConfig`` machinery and
    bypass structlog. We sidestep both by calling the no-arg constructor and
    setting only the two main options the migration body needs.
    """
    config = AlembicConfig()
    config.set_main_option("script_location", _SCRIPT_LOCATION)
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def _read_current_revision(connection: Connection) -> str | None:
    """Synchronous helper for ``conn.run_sync`` — return the DB's current revision."""
    context = MigrationContext.configure(connection)
    return context.get_current_revision()


async def _current_revision(engine: AsyncEngine) -> str | None:
    """Read the database's current Alembic revision (or ``None`` if never migrated)."""
    async with engine.connect() as conn:
        return await conn.run_sync(_read_current_revision)


def _head_revision(config: AlembicConfig) -> str | None:
    """Return the head revision recorded in ``versions/`` for this Alembic project."""
    script = ScriptDirectory.from_config(config)
    return script.get_current_head()


async def _async_main() -> int:
    """Async core invoked under the CLI's own ``asyncio.run`` — returns the exit code."""
    settings = load_settings()
    engine = create_async_engine(settings.database_url)
    try:
        # Hard preflight gate — fails fast with a structured ConfigurationError
        # when the three Comradarr roles are missing AND the connect user lacks
        # CREATEROLE. Logging the failure here keeps the operator-visible
        # surface consistent: structured event, no stack trace.
        try:
            await preflight_role_check(engine)
        except ConfigurationError as exc:
            _logger.error("cli.migrate.preflight_failed", error=str(exc))
            return 1

        config = _build_alembic_config(settings.database_url)
        from_revision = await _current_revision(engine)
        to_revision = _head_revision(config)

        _logger.info(
            "cli.migrate.begin",
            database_url_redacted=_redact_dsn(settings.database_url),
            current_revision=from_revision,
        )

        started_ms = time.monotonic()
        # alembic.command.upgrade is a blocking sync API; the CLI is allowed
        # to call it because nothing else is sharing the loop (RULE-ASYNC-002).
        # Run it in a thread so the surrounding ``asyncio.run`` does not block
        # the event loop while DDL streams to Postgres.
        await asyncio.to_thread(alembic_command.upgrade, config, "head")
        elapsed_ms = int((time.monotonic() - started_ms) * 1000)

        _logger.info(
            "cli.migrate.ok",
            from_revision=from_revision,
            to_revision=to_revision,
            elapsed_ms=elapsed_ms,
        )
        return 0
    finally:
        await engine.dispose()


def main() -> None:
    """Synchronous entrypoint for the ``migrate`` console script.

    Owns its own ``asyncio.run`` because no parent loop exists — this is the
    documented RULE-ASYNC-002 carve-out for standalone CLI scripts. Catches
    any unhandled exception, emits ``cli.migrate.failed`` with the structured
    error string, and exits 1. Always raises :class:`SystemExit`; never
    returns to the caller.
    """
    try:
        exit_code = asyncio.run(_async_main())
    except Exception as exc:  # noqa: BLE001 — CLI top-level catch
        _logger.error("cli.migrate.failed", error=str(exc))
        sys.exit(1)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
