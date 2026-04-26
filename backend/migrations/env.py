"""Async Alembic environment (RECIPE-ALEMBIC-ASYNC + ANTI-129).

Customizations vs. the stock ``alembic init -t async`` template:

* DSN is read from ``DATABASE_URL`` at runtime (Q3) — a missing var raises
  :class:`comradarr.errors.configuration.ConfigurationError` with the same
  prefix the application factory uses, so the operator sees one consistent
  failure shape.
* Offline mode is forbidden (Q3 — substituted for the recipe's RuntimeError).
  Comradarr is async-first; offline mode would emit raw SQL without exercising
  the asyncpg driver path the runtime uses, defeating the value of the
  migration suite as a parity check.
* ``logging.config.fileConfig`` is REMOVED (C4 / RULE-LOG-001) — structlog is
  the project's sole logging surface; routing Alembic's loggers through
  ``logging.basicConfig`` already configured by ``configure_logging`` keeps the
  CLI consistent with the app.
* The PEP 563 string-annotation pragma is intentionally absent (C12 /
  RULE-PY-002) — the project relies on PEP 749 lazy annotations, and the
  ``tools/lint/no_future_annotations.sh`` gate scans this file too.
* ``async_engine_from_config`` + ``pool.NullPool`` per RECIPE-ALEMBIC-ASYNC.
  Phase 2 lands the first revision; Phase 1 ships an empty ``versions/``.
"""

import asyncio
import os

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

import comradarr.db.models  # noqa: F401  # registers ORM models for autogenerate  # pyright: ignore[reportUnusedImport]
from comradarr.db.base import Base
from comradarr.db.migrations import do_run_migrations
from comradarr.errors.configuration import ConfigurationError

# Alembic Config object: provides access to the .ini file's [alembic] section
# and the runtime context flags (offline mode, x-arguments, etc.).
config = context.config

# DATABASE_URL is required: env.py is the migration entrypoint and must NEVER
# silently fall back to a static or hard-coded DSN. Wrapping ``os.environ[...]``
# in try/except KeyError lets us re-raise as ConfigurationError with the same
# message prefix the runtime uses so operators see one consistent shape.
try:
    _DATABASE_URL: str = os.environ["DATABASE_URL"]
except KeyError as exc:
    raise ConfigurationError("DATABASE_URL not set") from exc

# Override the (intentionally absent) sqlalchemy.url in alembic.ini with the
# runtime-resolved value before async_engine_from_config reads the section.
config.set_main_option("sqlalchemy.url", _DATABASE_URL)

# Phase 2 lands the first revision; the Base import (alongside the explicit
# ``import comradarr.db.models`` registration above) keeps autogenerate seeing
# the full model graph. ``target_metadata`` is the autogenerate hook.
target_metadata = Base.metadata


async def run_async_migrations() -> None:
    """Build an async engine, run migrations through ``run_sync``, dispose.

    The migration body itself lives in :func:`comradarr.db.migrations.do_run_migrations`
    so the CLI and the Litestar lifespan share a single code path (advisory
    lock + transactional DDL). RECIPE-ALEMBIC-ASYNC pitfall avoidance: the
    ``import comradarr.db.models`` at module top is what makes autogenerate
    see the ORM graph.
    """
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.begin() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    """Online entrypoint — RECIPE-ALEMBIC-ASYNC's documented asyncio.run site.

    ``asyncio.run`` is allowed here (Alembic CLI owns its own event loop;
    RULE-ASYNC-002 forbids it inside the Litestar lifespan, not in standalone
    CLI scripts).
    """
    asyncio.run(run_async_migrations())


# Offline mode is structurally forbidden — Q3. Run the online path otherwise.
if context.is_offline_mode():
    raise ConfigurationError("Offline mode disabled; set DATABASE_URL and run online")
run_migrations_online()
