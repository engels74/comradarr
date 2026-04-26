"""Application boot smoke tests (Phase 1 §10.2 + Phase 3 §5.3.5)."""

import secrets as _secrets
from typing import cast

import pytest
from litestar import Litestar
from litestar.testing import AsyncTestClient

from comradarr.app import create_app
from comradarr.config import load_settings
from comradarr.errors.configuration import ConfigurationError
from tests.conftest import stub_settings

_STRONG_AUDIT_ADMIN_PASSWORD: str = _secrets.token_urlsafe(48)
_VALID_DSN: str = "postgresql+asyncpg://comradarr_app:p@localhost:5432/db"


def test_create_app_returns_litestar() -> None:
    """create_app(stub_settings()) returns a Litestar instance."""
    app = create_app(settings=stub_settings())
    assert isinstance(app, Litestar)


async def test_health_endpoint_200() -> None:
    """GET /health returns 200 with status='ok' + components mapping."""
    app = create_app(settings=stub_settings())
    async with AsyncTestClient(app=app) as client:
        response = await client.get("/health")
        assert response.status_code == 200
        body = cast("dict[str, object]", response.json())
        assert body["status"] == "ok"
        assert isinstance(body["components"], dict)


def test_missing_secret_key_raises_configuration_error() -> None:
    """load_settings(env={}) raises ConfigurationError on missing secret."""
    with pytest.raises(ConfigurationError) as exc_info:
        _ = load_settings(env={})
    # The message names a check; never echoes the (missing) key.
    assert "COMRADARR_SECRET_KEY" in str(exc_info.value)


def test_weak_secret_key_raises_configuration_error() -> None:
    """All-zero 32-byte key is rejected; the error message names a check."""
    weak_key = "0" * 32
    with pytest.raises(ConfigurationError) as exc_info:
        _ = load_settings(
            env={
                "COMRADARR_SECRET_KEY": weak_key,
                "DATABASE_URL": "postgresql+asyncpg://stub:stub@localhost:1/stub",
            }
        )
    message = str(exc_info.value)
    # Message names a check (entropy / denylist / structural); never echoes the key bytes.
    assert weak_key not in message
    assert "COMRADARR_SECRET_KEY" in message


def test_non_asyncpg_dsn_raises_configuration_error() -> None:
    """A bare postgresql:// DSN is rejected by RULE-DB-002."""
    with pytest.raises(ConfigurationError) as exc_info:
        _ = load_settings(
            env={
                "COMRADARR_SECRET_KEY": _secrets.token_urlsafe(48),
                "DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
            }
        )
    message = str(exc_info.value)
    assert "postgresql+asyncpg" in message


@pytest.mark.parametrize(
    ("overrides", "needle"),
    [
        # Missing audit-admin password — Iter 1 Amendment 1 gate.
        (
            {"COMRADARR_AUDIT_ADMIN_PASSWORD": ""},
            "COMRADARR_AUDIT_ADMIN_PASSWORD",
        ),
        # Too-short audit-admin password — under the 32-char floor.
        (
            {"COMRADARR_AUDIT_ADMIN_PASSWORD": "x" * 31},
            "at least 32 characters",
        ),
        # Non-asyncpg AUDIT_ADMIN_DATABASE_URL — RULE-DB-002 mirror.
        (
            {"AUDIT_ADMIN_DATABASE_URL": "postgresql://u:p@h:5/db"},
            "postgresql+asyncpg",
        ),
        # Weak audit-admin password (just-long-enough + audit_admin_url passes
        # the asyncpg gate). The boot still fails because DATABASE_URL is
        # absent — the ordering check in load_settings raises before the
        # audit-admin password gate is reached.
        (
            {"DATABASE_URL": ""},
            "DATABASE_URL",
        ),
    ],
    ids=[
        "missing_audit_admin_password",
        "short_audit_admin_password",
        "non_asyncpg_audit_admin_dsn",
        "missing_database_url",
    ],
)
def test_boot_fails_closed_on_invalid_inputs(
    overrides: dict[str, str],
    needle: str,
) -> None:
    """Phase 3 boot-fails-closed gate: misconfiguration raises before app construction."""
    base: dict[str, str] = {
        "COMRADARR_SECRET_KEY": _secrets.token_urlsafe(48),
        "DATABASE_URL": _VALID_DSN,
        "COMRADARR_AUDIT_ADMIN_PASSWORD": _STRONG_AUDIT_ADMIN_PASSWORD,
    }
    base.update(overrides)
    # Empty-string env vars are equivalent to "unset" for our boot gates.
    env: dict[str, str] = {k: v for k, v in base.items() if v}

    with pytest.raises(ConfigurationError) as exc_info:
        _ = load_settings(env=env)
    assert needle in str(exc_info.value)


def test_state_slots_after_create_app() -> None:
    """create_app() returns an instance whose state.settings carries audit-admin password."""
    from comradarr.config import Settings

    app = create_app(settings=stub_settings())
    settings = cast("Settings", app.state.settings)
    # Secret repr is the audit gate — never echoes the underlying password.
    assert repr(settings.audit_admin_password) == "<Secret>"
    assert len(settings.audit_admin_password.expose()) >= 32
