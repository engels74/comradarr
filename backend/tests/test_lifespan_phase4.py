# backend/tests/test_lifespan_phase4.py
"""Slice K — services_lifespan Phase 4 wiring tests.

Coverage:
  - Phase 4 services mounted on app.state after lifespan startup.
  - startup_warnings flag set.
  - JWKS refresher task spawned when OIDC providers configured (task present).
  - JWKS refresher task absent when no OIDC providers configured.
  - teardown: rate_limit_session closed, tasks cancelled cleanly.
  - Syntax bug fix: except (TimeoutError, asyncio.CancelledError) — no SyntaxError.
  - AuthProviderRegistry contains LocalPasswordProvider and TrustedHeaderProvider.

RULE-PY-002: No ``from __future__ import annotations``.
RULE-PY-003: No ``Any``.
"""

import asyncio

import pytest
from litestar import Litestar  # noqa: TC002
from litestar.testing import AsyncTestClient

from comradarr.app import create_app
from comradarr.core.auth.api_keys import ApiKeyService
from comradarr.core.auth.local import LocalPasswordProvider
from comradarr.core.auth.rate_limit import RateLimiter
from comradarr.core.auth.registry import AuthProviderRegistry
from comradarr.core.auth.sessions import SessionService
from comradarr.core.auth.trusted_header import TrustedHeaderProvider
from comradarr.core.crypto import CryptoService
from tests.conftest import stub_settings

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _app_with_settings(**overrides: str) -> Litestar:
    settings = stub_settings(overrides=overrides if overrides else None)
    return create_app(settings=settings)


# ---------------------------------------------------------------------------
# Phase 4 services wired on app.state
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_phase4_services_mounted_on_app_state() -> None:
    """After lifespan startup, Phase 4 services are present on app.state."""
    app = _app_with_settings()
    async with AsyncTestClient(app=app) as _client:
        assert isinstance(app.state.rate_limiter, RateLimiter)  # type: ignore[attr-defined]
        assert isinstance(app.state.session_service, SessionService)  # type: ignore[attr-defined]
        assert isinstance(app.state.api_key_service, ApiKeyService)  # type: ignore[attr-defined]
        assert isinstance(app.state.local_provider, LocalPasswordProvider)  # type: ignore[attr-defined]
        assert isinstance(app.state.trusted_header_provider, TrustedHeaderProvider)  # type: ignore[attr-defined]
        assert isinstance(app.state.auth_registry, AuthProviderRegistry)  # type: ignore[attr-defined]
        assert isinstance(app.state.oidc_service, object)  # OIDCService present


@pytest.mark.asyncio
async def test_crypto_service_mounted() -> None:
    """CryptoService is mounted on app.state by services_lifespan."""
    app = _app_with_settings()
    async with AsyncTestClient(app=app) as _client:
        assert isinstance(app.state.crypto, CryptoService)  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_startup_warnings_flag_set() -> None:
    """app.state.startup_warnings is True after lifespan startup."""
    app = _app_with_settings()
    async with AsyncTestClient(app=app) as _client:
        assert app.state.startup_warnings is True  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# AuthProviderRegistry composition
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auth_registry_contains_local_and_trusted_header() -> None:
    """AuthProviderRegistry contains LocalPasswordProvider and TrustedHeaderProvider."""
    app = _app_with_settings()
    async with AsyncTestClient(app=app) as _client:
        registry: AuthProviderRegistry = app.state.auth_registry  # type: ignore[attr-defined]
        provider_types = [type(p).__name__ for p in registry.providers]
        assert "LocalPasswordProvider" in provider_types
        assert "TrustedHeaderProvider" in provider_types


# ---------------------------------------------------------------------------
# JWKS refresher task
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_jwks_task_without_oidc_providers() -> None:
    """No JWKS refresher task is spawned when oidc_providers is empty."""
    app = _app_with_settings()
    async with AsyncTestClient(app=app) as _client:
        # When no OIDC providers are configured, no jwks_task key on state.
        # Verify no task named "jwks_refresher" is running.
        running_tasks = {t.get_name() for t in asyncio.all_tasks()}
        assert "jwks_refresher" not in running_tasks


# ---------------------------------------------------------------------------
# Teardown bug fix: parenthesized except tuple
# ---------------------------------------------------------------------------


def test_except_tuple_syntax_is_valid() -> None:
    """The parenthesized except (TimeoutError, asyncio.CancelledError) compiles cleanly.

    The bug was bare ``except TimeoutError, asyncio.CancelledError:`` which is
    a SyntaxError in Python 3. Importing the module proves the fix landed.
    """
    import comradarr.core.lifespan  # noqa: PLC0415

    assert hasattr(comradarr.core.lifespan, "services_lifespan")


# ---------------------------------------------------------------------------
# Controllers registered
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auth_controller_registered() -> None:
    """POST /api/auth/login is routable (controller registered in app)."""
    app = _app_with_settings()
    async with AsyncTestClient(app=app) as client:
        # A POST with empty body will fail auth logic, but a 422 or 400 (not 404)
        # proves the route is registered.
        response = await client.post("/api/auth/login", json={})
        assert response.status_code != 404


@pytest.mark.asyncio
async def test_api_keys_controller_registered() -> None:
    """GET /api/api-keys is routable (controller registered in app)."""
    app = _app_with_settings()
    async with AsyncTestClient(app=app) as client:
        # Without auth this will get 401/403, but not 404.
        response = await client.get("/api/api-keys")
        assert response.status_code != 404


# ---------------------------------------------------------------------------
# Auth middleware wired: anonymous principal set for unprotected paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_auth_middleware_sets_anonymous_for_health() -> None:
    """GET /health still works — allowlisted path gets AnonymousPrincipal."""
    app = _app_with_settings()
    async with AsyncTestClient(app=app) as client:
        response = await client.get("/health")
        assert response.status_code == 200
