"""Multi-worker migration race regression — ANTI-135 / R10 / Pre-Mortem #4.

Spawns N=4 concurrent ``run_migrations_in_lifespan`` invocations as
**separate subprocesses** against a single fresh schema. The PG advisory
lock acquired inside :func:`comradarr.db.migrations.do_run_migrations`
serializes them so:

* **All 4 subprocesses exit cleanly (rc=0)** — without the lock, the
  losers race the ``INSERT INTO alembic_version`` and Postgres raises
  ``UniqueViolation`` on three of them. The exit-code check IS the
  ANTI-135 / Pre-Mortem #4 detection signal; a missing or out-of-scope
  advisory lock surfaces here as one or more non-zero subprocess exits.
* **The alembic_version table holds exactly one row at head** — the
  lock-winner applied the migration; the lock-losers reached the
  ``context.run_migrations()`` body, observed ``current_revision == head``
  via alembic's internal compare, and returned cleanly without
  re-inserting.
* **The schema matches the ORM metadata exactly** — the second test
  shells out to ``alembic check`` against the same per-test schema.

Failure modes this test catches:

* If ``pg_advisory_xact_lock`` is removed or moved outside the outer
  transaction, the losers' ``INSERT INTO alembic_version`` collides with
  the winner's row and one or more subprocesses exit non-zero.
  Pre-mortem Scenario 4 detection is exactly this signal.
* If ``transactional_ddl=True`` is dropped, alembic checks out a separate
  connection that escapes the outer-transaction lock scope (ANTI-137);
  the same UniqueViolation reproduces.
* If the schema drifts from models, ``alembic check`` emits a non-empty
  diff — a stale GRANT block, a missed index, or a DDL hand-patch that
  diverged from the autogenerate output all surface here.

**Why the test does NOT track per-subprocess from/to revision tuples**:
the lifespan reads ``from_revision`` BEFORE acquiring the advisory lock
(load-bearing for the noop-vs-applied event branching at runtime), so
all N subprocesses race the read and ALL observe ``from=None`` against
a fresh schema. Differentiating winner-vs-loser by ``(from, to)`` would
require sampling inside the lock — the production lifespan deliberately
samples outside, so the test mirrors that. The exit-code-clean check is
sufficient and load-bearing.

**Why subprocesses, not coroutines**: Alembic's ``EnvironmentContext``
manipulates module-level globals (``alembic.context``'s proxy machinery)
that are NOT safe to enter twice in the same process. A naive
``asyncio.gather`` of N concurrent migrations in one process raises a
``KeyError: 'script'`` when the second context exits — alembic's internal
proxy registry only tracks one context per process. Separate subprocesses
are also a more faithful representation of the production scenario:
N Granian workers are N separate Python processes contending on the same
``pg_advisory_xact_lock`` from independent OS-level connections.

Schema isolation: the fixture creates a fresh per-test schema and pins it
on each subprocess via ``PGOPTIONS=-csearch_path=<schema>`` (libpq's
startup-options channel) AND via the worker-DSN's ``server_settings`` —
asyncpg respects neither URL ``options=`` nor ``PGOPTIONS`` directly, so
the harness sub-script (defined inline below) constructs the engine with
``connect_args.server_settings.search_path`` exactly the way the W4
conftest's ``db_engine`` fixture does.
"""

import asyncio
import json
import os
import secrets
import subprocess
import sys
from collections.abc import (
    AsyncIterator,  # noqa: TC003 — runtime use: pytest resolves fixture generator return type at collection time (RULE-PY-002 forbids `from __future__ import annotations`)
)
from contextlib import suppress

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.sql import text

pytestmark = pytest.mark.integration


# Phase 4 advanced ``head`` past phase 3: the chain is
# ``361c239a829d → a1b2c3d4e5f6 → b2c3d4e5f6a7 → 1d8a2c6dcc5d``. The
# advisory-lock test parses the harness's ``{"from": ..., "to": ...}`` JSON
# and asserts the applied head matches this constant; bump on every new revision.
_HEAD_REVISION = "1d8a2c6dcc5d"
_N_CONCURRENT = 4
_SUBPROCESS_TIMEOUT_SECONDS = 60


# Inline harness: imported by ``-c`` so we don't need a sibling .py file
# in tests/db/. Reads DATABASE_URL + SEARCH_PATH from env, constructs the
# pinned engine the same way the W4 conftest does, runs the migration via
# the lifespan entrypoint, and prints ``{"from": ..., "to": ...}`` JSON
# on the LAST stdout line so the parent can parse it back.
_HARNESS_SCRIPT = """
import asyncio, json, os, sys
from sqlalchemy.ext.asyncio import create_async_engine
from comradarr.core.lifespan import _current_revision
from comradarr.db.migrations import run_migrations_in_lifespan

async def _main():
    engine = create_async_engine(
        os.environ["DATABASE_URL"],
        connect_args={
            "server_settings": {
                "search_path": os.environ["SEARCH_PATH"],
                "application_name": "locktest_subproc",
            },
        },
    )
    try:
        from_revision = await _current_revision(engine)
        await run_migrations_in_lifespan(engine)
        to_revision = await _current_revision(engine)
    finally:
        await engine.dispose()
    print(json.dumps({"from": from_revision, "to": to_revision}))

asyncio.run(_main())
"""


@pytest.fixture(name="fresh_schema")
async def _fresh_schema_fixture(  # pyright: ignore[reportUnusedFunction]
    worker_id: str,
) -> AsyncIterator[tuple[str, str]]:
    """Yield ``(base_url, schema)`` for a fresh per-test schema.

    The fresh schema is created here and dropped on teardown; subprocess
    harnesses propagate the schema via ``SEARCH_PATH`` env var which the
    inline ``_HARNESS_SCRIPT`` translates into the asyncpg-compatible
    ``connect_args.server_settings.search_path`` form (R-EXEC-7 parity
    with the W4 ``db_engine`` fixture).
    """
    from tests.conftest import worker_database_url  # noqa: PLC0415

    base_url = worker_database_url(worker_id)
    schema = f"locktest_{worker_id}_{secrets.token_hex(4)}"

    admin_engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
    try:
        async with admin_engine.connect() as admin_conn:
            _ = await admin_conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    finally:
        await admin_engine.dispose()

    try:
        yield base_url, schema
    finally:
        cleanup_engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
        try:
            async with cleanup_engine.connect() as cleanup_conn:
                with suppress(Exception):
                    _ = await cleanup_conn.execute(
                        text(f'DROP SCHEMA "{schema}" CASCADE'),
                    )
        finally:
            await cleanup_engine.dispose()


def _spawn_migration_subprocess(base_url: str, schema: str) -> subprocess.Popen[str]:
    """Start one subprocess that runs the migration against ``schema``.

    Returns the live :class:`subprocess.Popen` so the caller can collect
    its exit code and stdout once the race finishes.
    """
    # Build env from scratch (NOT inheriting ``os.environ``) so a developer's
    # locally-set ``COMRADARR_SECRET_KEY`` cannot leak into subprocess stdout
    # or CI logs. Mirrors the discipline in ``test_e2e_boot.py``.
    env: dict[str, str] = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
        "DATABASE_URL": base_url,
        "SEARCH_PATH": schema,
        "COMRADARR_SECRET_KEY": secrets.token_hex(32),
        # Phase 3 §5.3.1 made COMRADARR_AUDIT_ADMIN_PASSWORD a required input;
        # the harness imports comradarr.config so it must be seeded here.
        "COMRADARR_AUDIT_ADMIN_PASSWORD": secrets.token_urlsafe(48),
    }
    return subprocess.Popen(  # noqa: S603 — fixed argv, no shell
        [sys.executable, "-c", _HARNESS_SCRIPT],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def _parse_revisions_from_stdout(stdout: str) -> tuple[str | None, str | None]:
    """Extract the ``{"from": ..., "to": ...}`` JSON from the last stdout line.

    The harness logs structlog events to stdout before printing the JSON
    summary; the JSON is the LAST non-empty line. If parsing fails we
    surface the raw stdout so the assertion error is debuggable.
    """
    lines = [line for line in stdout.splitlines() if line.strip()]
    if not lines:
        msg = f"empty subprocess stdout (no JSON summary): {stdout!r}"
        raise AssertionError(msg)
    last = lines[-1]
    try:
        payload = json.loads(last)  # pyright: ignore[reportAny]
    except json.JSONDecodeError as exc:
        msg = (
            f"could not parse JSON summary from last stdout line: {last!r}; full stdout: {stdout!r}"
        )
        raise AssertionError(msg) from exc
    return payload.get("from"), payload.get("to")  # pyright: ignore[reportAny]


async def test_concurrent_migrations_serialize_via_advisory_lock(
    fresh_schema: tuple[str, str],
) -> None:
    """N=4 concurrent subprocesses converge on head, no UniqueViolation.

    Each subprocess imports the lifespan entrypoint and runs the migration
    against the shared fresh schema. The advisory lock inside
    :func:`do_run_migrations` serializes them so:

    * Every subprocess exits ``rc=0`` — without the lock, three losers
      race the ``INSERT INTO alembic_version`` after the winner commits
      and Postgres raises ``UniqueViolation`` on at least one of them.
    * The ``alembic_version`` table holds exactly one row at head — no
      duplicate inserts (would be the ANTI-135 corruption signal) and no
      partial state (would be the ANTI-137 escaped-transaction signal).

    All four subprocesses observe ``from=None`` because the lifespan
    samples ``from_revision`` BEFORE the lock (load-bearing for the
    noop-vs-applied branching), so the per-subprocess ``(from, to)``
    tuples can't differentiate winner from loser. The exit-code-clean
    + single-row-at-head pair IS the gate.
    """
    base_url, schema = fresh_schema

    procs = [_spawn_migration_subprocess(base_url, schema) for _ in range(_N_CONCURRENT)]

    # Communicate in a thread so we don't block the asyncio loop. Each
    # subprocess runs its own asyncio.run, so we can wait on them in any
    # order — there's no event-loop interaction with the parent test.
    async def _wait_for(proc: subprocess.Popen[str]) -> tuple[int, str]:
        stdout, _ = await asyncio.to_thread(proc.communicate, timeout=_SUBPROCESS_TIMEOUT_SECONDS)
        return proc.returncode, stdout

    results = await asyncio.gather(*(_wait_for(p) for p in procs))

    # Gate signal #1: every subprocess exits cleanly. A non-zero exit
    # (e.g. UniqueViolation racing the alembic_version insert) is the
    # ANTI-135 / ANTI-137 regression we are detecting.
    for i, (rc, stdout) in enumerate(results):
        assert rc == 0, f"subprocess {i} exited with code {rc}; stdout: {stdout!r}"

    # Every subprocess must end at head; from=None for all because the
    # lifespan samples outside the lock (see module docstring).
    revisions = [_parse_revisions_from_stdout(stdout) for _, stdout in results]
    for frm, to in revisions:
        assert to == _HEAD_REVISION, (
            f"subprocess did not converge on head; got (from={frm!r}, "
            f"to={to!r}); revisions={revisions!r}"
        )

    # Gate signal #2: alembic_version table holds exactly one row at
    # head. Multiple rows would mean a loser successfully re-inserted
    # without the lock catching it; missing row would mean the winner's
    # transaction rolled back unexpectedly.
    verify_engine = create_async_engine(
        base_url,
        connect_args={
            "server_settings": {
                "search_path": schema,
                "application_name": "locktest_verify",
            },
        },
    )
    try:
        async with verify_engine.connect() as conn:
            row_count_result = await conn.execute(
                text("SELECT COUNT(*) FROM alembic_version"),
            )
            row_count: int = row_count_result.scalar_one()  # pyright: ignore[reportAny]
            head_result = await conn.execute(
                text("SELECT version_num FROM alembic_version"),
            )
            head_value = head_result.scalar_one_or_none()
    finally:
        await verify_engine.dispose()

    assert row_count == 1, (
        f"alembic_version has {row_count} rows after race; expected 1. "
        "More than 1 row indicates a UniqueViolation-adjacent regression "
        "(advisory lock missing or out-of-scope)."
    )
    assert head_value == _HEAD_REVISION, (
        f"alembic_version row is {head_value!r}, expected {_HEAD_REVISION!r}"
    )


async def test_concurrent_migrations_alembic_clean(fresh_schema: tuple[str, str]) -> None:
    """After concurrent runners settle, the schema matches models exactly.

    Run the race, then shell out to ``alembic check`` against the same
    schema. ``alembic check`` exits 0 when autogenerate would produce an
    empty diff — i.e. the on-disk schema and the ORM metadata agree. A
    non-empty diff means concurrent runners corrupted the schema (e.g.
    partial application before the lock arrived).

    Search-path pinning takes a two-pronged approach because asyncpg (used
    by ``migrations/env.py``) ignores libpq's ``PGOPTIONS`` and ``?options=``:

    * ``SEARCH_PATH=<schema>`` — read by env.py and forwarded to asyncpg as
      ``connect_args.server_settings.search_path``. This is what makes the
      ``alembic check`` autogenerate diff land in the per-test schema.
    * ``PGOPTIONS=-csearch_path=<schema>`` — kept for any libpq-driven
      bookkeeping the alembic CLI might do outside env.py.
    """
    base_url, schema = fresh_schema

    procs = [_spawn_migration_subprocess(base_url, schema) for _ in range(_N_CONCURRENT)]
    results = await asyncio.gather(
        *(asyncio.to_thread(p.communicate, timeout=_SUBPROCESS_TIMEOUT_SECONDS) for p in procs),
    )
    for i, (stdout, _) in enumerate(results):
        rc = procs[i].returncode
        assert rc == 0, f"subprocess {i} exited with code {rc}; stdout: {stdout!r}"

    proc = await asyncio.to_thread(
        subprocess.run,
        [sys.executable, "-m", "alembic", "check"],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
        env={
            # See ``_spawn_migration_subprocess`` — env from scratch so the
            # operator's ``COMRADARR_SECRET_KEY`` cannot bleed into the
            # ``alembic check`` subprocess's stdout/CI logs.
            "PATH": os.environ.get("PATH", ""),
            "HOME": os.environ.get("HOME", ""),
            "DATABASE_URL": base_url,
            # SEARCH_PATH is the asyncpg-honored channel (env.py forwards it
            # via connect_args.server_settings); PGOPTIONS is the libpq belt
            # for any non-env.py invocations the alembic CLI may make.
            "SEARCH_PATH": schema,
            "PGOPTIONS": f"-csearch_path={schema}",
            "COMRADARR_SECRET_KEY": secrets.token_hex(32),
            # Phase 3 §5.3.1 made COMRADARR_AUDIT_ADMIN_PASSWORD a required
            # input; alembic check imports comradarr.config so it must be set.
            "COMRADARR_AUDIT_ADMIN_PASSWORD": secrets.token_urlsafe(48),
        },
    )
    assert proc.returncode == 0, (
        f"alembic check failed (exit={proc.returncode}); "
        f"stdout={proc.stdout!r}; stderr={proc.stderr!r}"
    )
