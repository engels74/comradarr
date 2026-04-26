"""E2E boot smoke — automated CI gate (plan §3 Milestone 10 step 51, F7 closure).

Launches the canonical Granian process via
``subprocess.Popen([sys.executable, "-m", "comradarr"], env=...)`` against a
fresh per-worker schema with ``COMRADARR_RUN_MIGRATIONS_ON_STARTUP=1``,
polls ``GET /health`` until 200, asserts the
``db.lifespan.migrations.applied`` event landed in stdout, then SIGTERMs the
subprocess and asserts a clean exit.

Why ``subprocess.Popen([sys.executable, "-m", "comradarr"], env=...)`` and
**not** ``uv run comradarr``:

* PATH-independent — CI runners and local dev shells differ in where ``uv``
  lives; using the test session's interpreter directly closes F7
  ("test passes locally, fails on CI because uv isn't on PATH").
* The console-script entry point (``comradarr = comradarr.__main__:main``)
  resolves to the same ``main()`` body as ``python -m comradarr``, so we
  exercise the production boot path without depending on the install layout.

The subprocess's ``env`` dict is built from scratch (NOT inherited via
``os.environ``) so the test cannot accidentally leak the developer's local
secret-key registry or live DSN into the smoke. ``COMRADARR_SECRET_KEY``
gets a stub registered as version 0; the worker DSN is forwarded via
``DATABASE_URL``; the migration flag is set to ``1``.

The 10-second poll budget is the explicit deadline from the team-prd
acceptance checklist; it covers Granian boot + alembic head application on
an empty schema (typically <2s on a developer laptop, <5s on CI runners).

ANTI-135 attestation: the assertion that ``db.lifespan.migrations.applied``
appeared in stdout proves the migration runner ran inside the lifespan
under the advisory lock — the load-bearing contract for multi-worker boot.

RULE-ASYNC-002: this test runs synchronously (no asyncio fixture);
:func:`subprocess.Popen` + :func:`time.sleep` polling is fine because the
subprocess owns its own event loop (Granian's uvloop) and we observe it
through stdin/stdout.

**Concurrency caveat**: Granian binds the port hardcoded in
:mod:`comradarr.__main__` (8000 in dev mode, on 127.0.0.1). xdist parallel
test workers each get their own per-worker schema, but only one subprocess
can hold port 8000 at any instant. The :func:`pytest.mark.e2e` marker plus
xdist's ``-x`` flag (or running E2E in a single-worker pass) is the
operator-side discipline for avoiding port contention.
"""

import asyncio
import os
import secrets
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import (
    Iterator,  # noqa: TC003 — runtime use: pytest resolves fixture generator return type at collection time (RULE-PY-002 forbids `from __future__ import annotations`)
)
from contextlib import suppress

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.sql import text

pytestmark = [pytest.mark.integration, pytest.mark.e2e]


_BOOT_TIMEOUT_SECONDS = 10.0
_HEALTH_POLL_INTERVAL_SECONDS = 0.2
_TERM_TIMEOUT_SECONDS = 5.0
_GRANIAN_PORT = 8000  # hardcoded in comradarr/__main__.py
_HEAD_REVISION = "361c239a829d"
# 32-byte secret key (64 hex chars) bound to version 1 via the suffix-less
# ``COMRADARR_SECRET_KEY`` env var (plan §5.1.1 Step 2.5). The hex string is
# decoded by :func:`_read_secret_bytes` into 32 high-entropy bytes — meeting
# the ≥4.0 bits/byte Shannon-entropy floor enforced in
# :func:`comradarr.security.secret_key.validate_secret_key`. Generated once
# per test invocation so the secret never lives in source.
_E2E_SECRET_HEX = secrets.token_hex(32)


async def _create_database_async(base_url: str, test_db: str) -> None:
    """Open one AUTOCOMMIT connection on the worker DB and CREATE the test DB."""
    engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as conn:
            _ = await conn.execute(text(f'CREATE DATABASE "{test_db}"'))
    finally:
        await engine.dispose()


async def _drop_database_async(base_url: str, test_db: str) -> None:
    """Drop the per-test DB, terminating leftover backends first."""
    engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
    try:
        async with engine.connect() as conn:
            # Fully static SQL with a single bound parameter; ruff S608 fires
            # on the previous multi-line `+` shape but no identifier
            # interpolation occurs.
            terminate_sql = (
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "  # noqa: S608
                "WHERE datname = :db AND pid <> pg_backend_pid()"
            )
            with suppress(Exception):
                _ = await conn.execute(
                    text(terminate_sql).bindparams(db=test_db),
                )
            with suppress(Exception):
                _ = await conn.execute(text(f'DROP DATABASE "{test_db}"'))
    finally:
        await engine.dispose()


@pytest.fixture(name="fresh_e2e_dsn")
def _fresh_e2e_dsn_fixture(worker_id: str) -> Iterator[str]:  # pyright: ignore[reportUnusedFunction]
    """Per-test database setup for the subprocess to migrate.

    The E2E test launches Granian as an unmodifiable subprocess, so we
    cannot monkeypatch :func:`build_engine` to inject ``connect_args`` for
    schema-pinning. asyncpg's URL form rejects libpq's ``?options=`` channel,
    so the only viable isolation strategy is a per-test **database**: the
    subprocess receives an unmodified DSN and writes to its default
    ``public`` schema. The DB is created via the per-worker DSN's role
    (granted ``CREATEDB`` during environment bootstrap) and dropped on
    teardown.

    asyncpg is the only Postgres driver in the venv; the create/drop helpers
    run inside :func:`asyncio.run` so the fixture remains synchronous (the
    test body wraps :class:`subprocess.Popen` and :func:`time.sleep`).
    """
    from tests.conftest import worker_database_url  # noqa: PLC0415

    base_url = worker_database_url(worker_id)
    test_db = f"e2etest_{worker_id}_{secrets.token_hex(4)}"

    asyncio.run(_create_database_async(base_url, test_db))

    # Rewrite the DSN's database segment to point at the freshly created DB.
    # The conftest's worker DSN ends with ``/comradarr_test``; we swap the
    # database name without touching role/host/port.
    fresh_dsn = base_url.rsplit("/", 1)[0] + f"/{test_db}"

    try:
        yield fresh_dsn
    finally:
        asyncio.run(_drop_database_async(base_url, test_db))


def _poll_health(port: int, deadline: float) -> bool:
    """Poll ``GET /health`` on ``127.0.0.1:<port>`` until 200 or deadline.

    Returns ``True`` on first 200; ``False`` if the deadline is reached
    without a successful response.
    """
    url = f"http://127.0.0.1:{port}/health"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as response:  # noqa: S310  # pyright: ignore[reportAny]
                status: int = response.status  # pyright: ignore[reportAny]
                if status == 200:
                    return True
        except urllib.error.URLError, ConnectionError, TimeoutError:
            pass
        time.sleep(_HEALTH_POLL_INTERVAL_SECONDS)
    return False


def test_boot_applies_migrations_and_serves_health(
    fresh_e2e_dsn: str,
) -> None:
    """Subprocess boot: /health 200 within budget, applied event in stdout, clean SIGTERM."""
    env: dict[str, str] = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
        "DATABASE_URL": fresh_e2e_dsn,
        "COMRADARR_RUN_MIGRATIONS_ON_STARTUP": "1",
        "COMRADARR_RUN_MODE": "dev",  # 127.0.0.1 binding; safe for tests.
        "COMRADARR_SECRET_KEY": _E2E_SECRET_HEX,
    }

    proc = subprocess.Popen(  # noqa: S603 — fixed argv, no shell
        [sys.executable, "-m", "comradarr"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    captured_stdout = ""
    booted = False
    try:
        deadline = time.monotonic() + _BOOT_TIMEOUT_SECONDS
        booted = _poll_health(_GRANIAN_PORT, deadline)
    finally:
        # If the subprocess already exited (e.g. boot crash), drain stdout
        # without sending SIGTERM. Otherwise, gracefully terminate so Granian's
        # signal handler flushes structlog buffers before exit.
        if proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
            try:
                captured_stdout, _ = proc.communicate(timeout=_TERM_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                proc.kill()
                captured_stdout, _ = proc.communicate()
                pytest.fail(
                    f"subprocess did not exit within {_TERM_TIMEOUT_SECONDS}s of SIGTERM; "
                    + f"captured stdout: {captured_stdout!r}",
                )
        else:
            captured_stdout, _ = proc.communicate()

    assert booted, (
        f"subprocess did not serve /health within {_BOOT_TIMEOUT_SECONDS}s; "
        f"exit code={proc.returncode!r}; stdout: {captured_stdout!r}"
    )

    # Clean exit: 0 (graceful) or -SIGTERM on POSIX is also acceptable
    # because Granian forwards the signal to its workers and the parent
    # may exit with the signal-coded code.
    assert proc.returncode in {0, -signal.SIGTERM}, (
        f"unclean exit code {proc.returncode}; stdout: {captured_stdout!r}"
    )

    # Migration applied event must appear in captured stdout. structlog's
    # default formatter writes the event name as a stable token across both
    # JSON and console renderers.
    assert "db.lifespan.migrations.applied" in captured_stdout, (
        f"expected db.lifespan.migrations.applied in stdout; got: {captured_stdout!r}"
    )
    assert "to_revision" in captured_stdout
    assert _HEAD_REVISION in captured_stdout, (
        f"expected baseline head revision {_HEAD_REVISION} adjacent to applied event; "
        f"got: {captured_stdout!r}"
    )
