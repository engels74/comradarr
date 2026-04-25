"""Application boot smoke tests (Phase 1 §10.2)."""

from typing import cast

import pytest
from litestar import Litestar
from litestar.testing import AsyncTestClient

from comradarr.app import create_app
from comradarr.config import load_settings
from comradarr.errors.configuration import ConfigurationError
from tests.conftest import stub_settings


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
    import secrets as _secrets

    with pytest.raises(ConfigurationError) as exc_info:
        _ = load_settings(
            env={
                "COMRADARR_SECRET_KEY": _secrets.token_urlsafe(48),
                "DATABASE_URL": "postgresql://user:pass@localhost:5432/db",
            }
        )
    message = str(exc_info.value)
    assert "postgresql+asyncpg" in message
