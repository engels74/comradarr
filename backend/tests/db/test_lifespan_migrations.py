"""Lifespan migration branch coverage (plan §3 Milestone 10 step 47).

Each of the four ``db.lifespan.migrations.*`` event branches in
:mod:`comradarr.core.lifespan` is exercised end-to-end against a live
Postgres schema and asserted via ``structlog.testing.capture_logs``. The
event names + kwargs are part of the lifespan's observability contract
(documented in the lifespan module docstring) — drift either here or in
the lifespan body fails this test.

Branch matrix:

* **Branch 1 — flag ON, fresh schema** → ``db.lifespan.migrations.applied``
  with ``from_revision=None``, ``to_revision=<head>``, ``elapsed_ms`` (int).
* **Branch 2 — flag ON, already at head** → ``db.lifespan.migrations.noop``
  with ``reason="already_at_head"``.
* **Branch 3 — flag OFF** → ``db.lifespan.migrations.skipped`` with
  ``reason="flag_off"``; the runner is NOT invoked, so no DB connection
  is attempted (a stub DSN survives).
* **Branch 4 — failure path** → ``db.lifespan.migrations.failed`` at
  ``log_level="error"`` with an ``error=...`` kwarg; the lifespan
  re-raises so app boot fails.

Each branch builds its own per-test schema by appending a short suffix to
the per-worker DSN — the session-scoped ``db_engine`` fixture already has
head applied against ``wid_<worker>``, so we cannot reuse it for the
"fresh schema" branches without wrecking the session. The inline schema
helpers below mirror conftest's ``_schema_for`` / sweep discipline.

RULE-LOG-001 / RULE-LOG-002 attestation: assertions read ``event`` +
kwargs only — never f-string-formatted message bodies.

ANTI-126 attestation: only ``pytest_asyncio.fixture`` (none here, but
the suite sets ``asyncio_mode = "auto"``); no ``event_loop`` override.
"""

import secrets
from collections.abc import AsyncIterator, Callable
from contextlib import suppress
from unittest.mock import MagicMock

import pytest
import structlog
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.sql import text

from comradarr.config import Settings
from comradarr.core import lifespan as lifespan_module
from comradarr.core.lifespan import db_lifespan
from comradarr.db.migrations import run_migrations_in_lifespan

pytestmark = pytest.mark.integration


_HEAD_REVISION = "361c239a829d"


_StubSettingsFactory = Callable[..., Settings]


def _build_settings(
    *,
    database_url: str,
    run_migrations: bool,
    stub_settings_factory: _StubSettingsFactory,
) -> Settings:
    """Build a frozen Settings via the ``stub_settings`` fixture's overrides path.

    Tests receive the conftest's :func:`stub_settings` factory as a fixture and
    forward overrides through it so we go through ``load_settings`` (R7) — a
    direct ``Settings(...)`` would skip validation.
    """
    overrides: dict[str, str] = {
        "DATABASE_URL": database_url,
        "COMRADARR_RUN_MIGRATIONS_ON_STARTUP": "true" if run_migrations else "false",
    }
    return stub_settings_factory(overrides=overrides)


@pytest.fixture(name="stub_settings_factory")
def _stub_settings_factory_fixture() -> _StubSettingsFactory:  # pyright: ignore[reportUnusedFunction]
    """Re-export of conftest's :func:`stub_settings` callable for parametrized use."""
    from tests.conftest import stub_settings  # noqa: PLC0415

    return stub_settings


@pytest.fixture(name="fresh_schema")
async def _fresh_schema_fixture(  # pyright: ignore[reportUnusedFunction]
    worker_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncIterator[tuple[str, str]]:
    """Yield ``(database_url, schema)`` and pin lifespan engine to that schema.

    asyncpg rejects libpq's ``?options=`` URL form, so we cannot encode
    ``search_path`` in the DSN. Instead we monkeypatch
    :func:`comradarr.core.lifespan.build_engine` to inject
    ``connect_args.server_settings.search_path`` — exactly what the W4
    ``db_engine`` fixture in conftest does for its session-scoped engine.

    Using a unique schema per test keeps the four branches independent of
    the session-scoped ``db_engine`` (already at head against
    ``wid_<worker>``) and of each other.
    """
    from tests.conftest import worker_database_url  # noqa: PLC0415

    base_url = worker_database_url(worker_id)
    schema = f"liftest_{worker_id}_{secrets.token_hex(4)}"

    admin_engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
    try:
        async with admin_engine.connect() as admin_conn:
            _ = await admin_conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    finally:
        await admin_engine.dispose()

    def _build_engine_pinned(database_url: str) -> AsyncEngine:
        return create_async_engine(
            database_url,
            connect_args={
                "server_settings": {
                    "search_path": schema,
                    "application_name": "liftest_lifespan",
                },
            },
        )

    monkeypatch.setattr(lifespan_module, "build_engine", _build_engine_pinned)

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


def _make_app_stub(settings: Settings) -> object:
    """Build a Litestar-shaped stub the lifespan can read settings from.

    The lifespan reads ``app.state.settings`` and writes ``app.state.db_engine``
    + ``app.state.db_sessionmaker``. A :class:`MagicMock` with a real ``state``
    attribute satisfies both reads and writes without dragging in the full
    Litestar machinery (which would also try to mount the ASGI surface).
    """
    app = MagicMock()
    app.state.settings = settings  # pyright: ignore[reportAny]
    return app


async def test_branch_1_flag_on_fresh_schema_emits_applied(
    fresh_schema: tuple[str, str],
    stub_settings_factory: _StubSettingsFactory,
) -> None:
    """Flag ON, fresh schema → ``applied`` with ``from_revision=None`` + head + int elapsed_ms."""
    base_url, _ = fresh_schema
    settings = _build_settings(
        database_url=base_url,
        run_migrations=True,
        stub_settings_factory=stub_settings_factory,
    )
    app = _make_app_stub(settings)

    with structlog.testing.capture_logs() as captured:
        async with db_lifespan(app):  # pyright: ignore[reportArgumentType]
            pass

    applied = [
        entry for entry in captured if entry.get("event") == "db.lifespan.migrations.applied"
    ]
    assert len(applied) == 1, f"expected 1 applied event, captured: {captured}"
    event = applied[0]
    assert event["from_revision"] is None
    assert event["to_revision"] == _HEAD_REVISION
    assert isinstance(event["elapsed_ms"], int)
    assert event["elapsed_ms"] >= 0  # monotonic clock can return 0 ms on fast systems


async def test_branch_2_flag_on_already_at_head_emits_noop(
    fresh_schema: tuple[str, str],
    stub_settings_factory: _StubSettingsFactory,
) -> None:
    """Flag ON, already at head → ``noop`` with ``reason='already_at_head'``."""
    base_url, schema = fresh_schema
    settings = _build_settings(
        database_url=base_url,
        run_migrations=True,
        stub_settings_factory=stub_settings_factory,
    )

    # Pre-apply head outside the structlog capture window so the second
    # invocation observes ``from_revision == to_revision``. The pre-apply
    # engine pins ``search_path`` directly via ``connect_args`` (the
    # monkeypatched ``build_engine`` only applies inside the lifespan).
    pre_engine = create_async_engine(
        base_url,
        connect_args={
            "server_settings": {
                "search_path": schema,
                "application_name": "liftest_pre_apply",
            },
        },
    )
    try:
        await run_migrations_in_lifespan(pre_engine)
    finally:
        await pre_engine.dispose()

    app = _make_app_stub(settings)

    with structlog.testing.capture_logs() as captured:
        async with db_lifespan(app):  # pyright: ignore[reportArgumentType]
            pass

    noop = [entry for entry in captured if entry.get("event") == "db.lifespan.migrations.noop"]
    assert len(noop) == 1, f"expected 1 noop event, captured: {captured}"
    assert noop[0]["reason"] == "already_at_head"

    applied = [
        entry for entry in captured if entry.get("event") == "db.lifespan.migrations.applied"
    ]
    assert applied == [], "second invocation must NOT re-apply"


async def test_branch_3_flag_off_emits_skipped_and_skips_db(
    stub_settings_factory: _StubSettingsFactory,
) -> None:
    """Flag OFF → ``skipped`` with ``reason='flag_off'``; no DB connection attempted.

    The DSN points at port 1 (closed) — if the runner is invoked, the test
    fails with a connection error. The skipped branch never touches the DB,
    so the lifespan opens cleanly with the unreachable DSN.
    """
    settings = _build_settings(
        database_url="postgresql+asyncpg://stub:stub@localhost:1/stub",
        run_migrations=False,
        stub_settings_factory=stub_settings_factory,
    )
    app = _make_app_stub(settings)

    with structlog.testing.capture_logs() as captured:
        async with db_lifespan(app):  # pyright: ignore[reportArgumentType]
            pass

    skipped = [
        entry for entry in captured if entry.get("event") == "db.lifespan.migrations.skipped"
    ]
    assert len(skipped) == 1, f"expected 1 skipped event, captured: {captured}"
    assert skipped[0]["reason"] == "flag_off"

    applied = [
        entry for entry in captured if entry.get("event") == "db.lifespan.migrations.applied"
    ]
    noop = [entry for entry in captured if entry.get("event") == "db.lifespan.migrations.noop"]
    assert applied == []
    assert noop == []


async def test_branch_4_failure_path_emits_failed_and_reraises(
    stub_settings_factory: _StubSettingsFactory,
) -> None:
    """Broken DSN with flag ON → ``failed`` at error level + re-raise.

    The DSN is valid asyncpg syntax but points at an unroutable port; the
    lifespan's try/except catches the connection error, emits ``failed``
    with the stringified exception, disposes the engine, and re-raises.
    """
    settings = _build_settings(
        database_url="postgresql+asyncpg://stub:stub@localhost:1/stub",
        run_migrations=True,
        stub_settings_factory=stub_settings_factory,
    )
    app = _make_app_stub(settings)

    with structlog.testing.capture_logs() as captured, pytest.raises(Exception):  # noqa: PT011, B017
        async with db_lifespan(app):  # pyright: ignore[reportArgumentType]
            pass

    failed = [entry for entry in captured if entry.get("event") == "db.lifespan.migrations.failed"]
    assert len(failed) == 1, f"expected 1 failed event, captured: {captured}"
    event = failed[0]
    assert event.get("log_level") == "error"
    assert "error" in event
    assert isinstance(event["error"], str)
    assert event["error"]  # non-empty
