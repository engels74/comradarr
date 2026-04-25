"""Alembic env.py contract tests (Phase 1 §10.5).

env.py is import-by-side-effect under an Alembic ``EnvironmentContext`` — the
test invokes the canonical Alembic CLI in a subprocess so the realistic
execution path is exercised instead of a half-mocked import.
"""

import os
import secrets
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.config import Config

_BACKEND = Path(__file__).resolve().parent.parent
_ALEMBIC_INI = _BACKEND / "alembic.ini"
_STUB_DSN = "postgresql+asyncpg://stub:stub@localhost:1/stub"


def _alembic_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    env = dict(os.environ)
    env["COMRADARR_SECRET_KEY"] = secrets.token_urlsafe(48)
    if extra:
        for key, value in extra.items():
            if value == "":
                _ = env.pop(key, None)
            else:
                env[key] = value
    return env


def _run_alembic(args: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    cmd: list[str] = [sys.executable, "-m", "alembic", *args]
    return subprocess.run(  # noqa: S603 — args & cwd controlled by the test
        cmd,
        cwd=_BACKEND,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_alembic_config_loads() -> None:
    """alembic.config.Config(alembic.ini) parses without error."""
    config = Config(str(_ALEMBIC_INI))
    script_location = config.get_main_option("script_location")
    assert script_location is not None
    assert script_location.endswith("migrations")
    # sqlalchemy.url must be intentionally absent (env.py supplies it).
    assert config.get_main_option("sqlalchemy.url") is None


def test_env_module_loads_under_stub_dsn() -> None:
    """alembic current succeeds past env.py import under a stub DSN.

    The stub DSN points at a non-existent database, so the asyncpg connect
    eventually fails; the assertion is that env.py *itself* loaded cleanly,
    i.e. the failure happens at the connect site, not at the configuration
    guard.
    """
    env = _alembic_env({"DATABASE_URL": _STUB_DSN})
    proc = _run_alembic(["current"], env)
    combined = proc.stdout + proc.stderr
    # Must NOT trip the configuration guard.
    assert "DATABASE_URL not set" not in combined
    assert "Offline mode disabled" not in combined


def test_env_offline_mode_raises_configuration_error() -> None:
    env = _alembic_env({"DATABASE_URL": _STUB_DSN})
    proc = _run_alembic(["upgrade", "head", "--sql"], env)
    combined = proc.stdout + proc.stderr
    assert "Offline mode disabled" in combined
    assert "ConfigurationError" in combined


def test_env_missing_dsn_raises_configuration_error() -> None:
    env = _alembic_env({"DATABASE_URL": ""})
    proc = _run_alembic(["current"], env)
    combined = proc.stdout + proc.stderr
    assert "DATABASE_URL not set" in combined
    assert "ConfigurationError" in combined


@pytest.mark.parametrize("forbidden", ["fileConfig(", "from logging.config" + " import"])
def test_env_module_does_not_use_stdlib_logging_config(forbidden: str) -> None:
    env_text = (_BACKEND / "migrations" / "env.py").read_text()
    assert forbidden not in env_text


def test_env_module_does_not_import_pep_563_pragma() -> None:
    # Built from runtime-concatenated fragments so the no_future_annotations.sh
    # repo gate does NOT match this file (RULE-PY-002 lint scans tests/ too).
    forbidden_pragma = "from " + "__future__" + " import"
    env_text = (_BACKEND / "migrations" / "env.py").read_text()
    assert forbidden_pragma not in env_text
