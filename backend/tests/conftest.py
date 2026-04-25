"""Phase 1 test fixtures (RECIPE-PYTEST-DB skeleton + stub_settings factory).

The xdist worker-id helper exists for Phase 2's per-worker DB isolation, but it
is wired here so the contract is locked in Phase 1 (R7 mitigation: every
positive test goes through ``stub_settings()`` to avoid leaking the developer's
real environment into ``load_settings``). Phase 2 lights up
:func:`worker_database_url` against a real Postgres instance.

The module also seeds COMRADARR_SECRET_KEY + DATABASE_URL into ``os.environ``
BEFORE any test module imports :mod:`comradarr.app`. The C9 contract makes the
module-level ``app: Litestar = create_app()`` binding REQUIRE env vars at
import time; without this seed, every ``from comradarr.app import …`` in a
test file would raise :class:`ConfigurationError` during pytest collection.
"""

import os
import secrets
from typing import TYPE_CHECKING, cast

import pytest

# Stable, high-entropy stub secret key for the *whole* test session — generated
# once at import-time so each worker observes a consistent value across xdist
# fan-out. Real Phase 2 DB tests will re-seed per worker.
_STUB_SECRET_KEY: str = secrets.token_urlsafe(48)
_STUB_DATABASE_URL: str = "postgresql+asyncpg://stub:stub@localhost:1/stub"

# Seed env BEFORE first comradarr.* import so the module-level
# ``app = create_app()`` in comradarr/app.py sees a valid Settings.
_ = os.environ.setdefault("COMRADARR_SECRET_KEY", _STUB_SECRET_KEY)
_ = os.environ.setdefault("DATABASE_URL", _STUB_DATABASE_URL)

from comradarr.config import Settings, load_settings  # noqa: E402  — env seed must precede

if TYPE_CHECKING:
    from collections.abc import Mapping


def _xdist_worker_id(request: pytest.FixtureRequest) -> str:
    """Return the xdist worker id (``"gw0"``, ``"gw1"`` …) or ``"master"``."""
    worker: object = getattr(request.config, "workerinput", None)
    if isinstance(worker, dict):
        worker_typed = cast("dict[str, object]", worker)
        wid = worker_typed.get("workerid")
        if isinstance(wid, str):
            return wid
    return "master"


@pytest.fixture(name="worker_id")
def worker_id_fixture(request: pytest.FixtureRequest) -> str:
    """Expose the pytest-xdist worker id to tests (Phase 2 DB-key driver)."""
    return _xdist_worker_id(request)


def worker_database_url(worker_id: str) -> str:
    """Phase 2 hook: return the per-worker DSN. Phase 1 returns a stub DSN.

    Phase 2 will rewrite this to a real
    ``postgresql+asyncpg://...?application_name=<wid>`` against the test
    Postgres container; Phase 1 returns a stub DSN so unit tests that need
    ``database_url`` get an asyncpg-shaped string without touching a real DB.
    """
    return f"postgresql+asyncpg://stub_{worker_id}:stub@localhost:1/stub"


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
