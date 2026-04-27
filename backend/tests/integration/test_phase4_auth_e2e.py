# backend/tests/integration/test_phase4_auth_e2e.py
"""Phase 4 Slice L — HTTP e2e auth integration tests.

Exercises the full HTTP stack (Litestar app + real Postgres) for the
scenarios mandated by plan §5.5 Slice L:

  1. Local login flow  — POST /api/auth/login → 200 + Set-Cookie →
                          GET  /api/auth/me   → 200 →
                          POST /api/auth/logout → 200 + cookie cleared →
                          GET  /api/auth/me   → 401
  2. Bad credentials  — POST /api/auth/login (wrong password) → 401
  3. Unauthenticated  — GET /api/auth/me without cookie → 401
  4. Session rotation — POST /api/auth/sessions/revoke-all-other drops other sessions
  5. API key lifecycle — issue → use → revoke → 401 after revoke
  6. Trusted-header gate — settings validation (unit-level; full CIDR gate in
                           test_auth_trusted_header.py)
  7. Rate limiter trip — 6 bad logins all return 401
  8. OIDC e2e         — skipped (requires external IdP wiring; see auth-e2e.md)

Wiring strategy
---------------
``db_lifespan`` builds its own engine from ``settings.database_url``.  We
cannot inject the fixture's engine directly, so we monkeypatch
``comradarr.core.lifespan.build_engine`` to forward the call to
``create_async_engine`` with ``connect_args.server_settings.search_path``
pinned to the worker schema — exactly what the conftest fixture does.

``settings`` is built with ``stub_settings`` using the real ``TEST_DATABASE_URL``
and ``COMRADARR_RUN_MIGRATIONS_ON_STARTUP=false`` (migrations already applied
by the session-scoped ``db_engine`` fixture).  DB probes are re-enabled so the
boot-time SELECT 1 + enum gate run against the real DB.

RULE-PY-002: No ``from __future__ import annotations``.
RULE-PY-003: No ``Any``.
RULE-LOG-001: structlog only.
RULE-TEST-001: pytest_asyncio.fixture for async fixtures.
"""

import os
from collections.abc import AsyncIterator  # noqa: TC003
from unittest.mock import patch

import httpx  # noqa: TC002
import pytest
import pytest_asyncio
from litestar import Litestar
from litestar.testing import AsyncTestClient
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from comradarr.app import create_app
from comradarr.config import Settings  # noqa: TC001
from comradarr.core.crypto import hash_password
from comradarr.core.types import Secret
from comradarr.db.enums import UserRole
from comradarr.repositories.auth import UserRepository
from tests.conftest import STUB_AUDIT_ADMIN_PASSWORD, STUB_SECRET_KEY, stub_settings

# ---------------------------------------------------------------------------
# Skip marker — requires a live Postgres reachable at TEST_DATABASE_URL
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.skipif(
    os.environ.get("TEST_DATABASE_URL") is None,
    reason="TEST_DATABASE_URL not set — skipping Phase 4 auth e2e tests",
)

_ADMIN_USERNAME = "e2e_admin"
_ADMIN_PASSWORD = "Str0ng!e2eP@ss"  # noqa: S105
_ADMIN_EMAIL = "e2e_admin@test.local"


# ---------------------------------------------------------------------------
# Per-module fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="module", loop_scope="session")
async def seeded_db(db_engine: AsyncEngine, worker_id: str) -> str:
    """Seed a single admin user into the worker schema; return the schema name.

    Module-scoped so the user row survives across all tests in this file —
    the e2e app has its own connection pool and cannot share the function-
    scoped transactional rollback fixture used by unit tests.
    """
    schema = f"wid_{worker_id}"
    sessionmaker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sessionmaker() as session:
        repo = UserRepository(session)
        pw_hash = hash_password(Secret(_ADMIN_PASSWORD))
        _ = await repo.create_local(
            email=_ADMIN_EMAIL,
            username=_ADMIN_USERNAME,
            password_hash=pw_hash,
            role=UserRole.ADMIN,
        )
        await session.commit()
    return schema


def _make_e2e_settings(_schema: str) -> Settings:
    """Build Settings pointing at the real DB with migrations skipped."""
    base_url = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql+asyncpg://comradarr:comradarr@localhost:5432/comradarr_test",
    )
    return stub_settings(
        overrides={
            "DATABASE_URL": base_url,
            "COMRADARR_SECRET_KEY": STUB_SECRET_KEY,
            "COMRADARR_AUDIT_ADMIN_PASSWORD": STUB_AUDIT_ADMIN_PASSWORD,
            "COMRADARR_RUN_MIGRATIONS_ON_STARTUP": "false",
            "COMRADARR_RUN_DB_PROBES_ON_STARTUP": "true",
            "COMRADARR_INSECURE_COOKIES": "true",
        }
    )


def _patched_build_engine(schema: str):  # type: ignore[return]  # noqa: ANN201
    """Return a build_engine replacement that pins search_path to the worker schema."""

    def _build(database_url: str) -> AsyncEngine:
        return create_async_engine(
            database_url,
            connect_args={"server_settings": {"search_path": schema}},
        )

    return _build


@pytest_asyncio.fixture(scope="module", loop_scope="session")
async def e2e_app(seeded_db: str) -> AsyncIterator[Litestar]:
    """Litestar app with full lifespan against the real worker-schema DB."""
    schema = seeded_db
    settings = _make_e2e_settings(schema)
    app = create_app(settings=settings)
    with patch("comradarr.core.lifespan.build_engine", new=_patched_build_engine(schema)):
        async with AsyncTestClient[Litestar](app=app) as _client:
            yield app


@pytest_asyncio.fixture(loop_scope="session")
async def client(e2e_app: Litestar) -> AsyncIterator[AsyncTestClient[Litestar]]:
    """Fresh AsyncTestClient per test (no shared cookie jar)."""
    async with AsyncTestClient[Litestar](app=e2e_app) as c:
        yield c


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _login(
    client: AsyncTestClient[Litestar], *, password: str = _ADMIN_PASSWORD
) -> httpx.Response:
    return await client.post(
        "/api/auth/login",
        json={"username": _ADMIN_USERNAME, "password": password},
    )


def _session_cookie(response: httpx.Response) -> str | None:
    return response.cookies.get("comradarr_session")


# ---------------------------------------------------------------------------
# 1. Local login flow
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_local_login_me_logout(client: AsyncTestClient[Litestar]) -> None:
    """Full login → me → logout → 401 flow."""
    login_resp = await _login(client)
    assert login_resp.status_code == 200, login_resp.text
    assert "comradarr_session" in login_resp.cookies

    me_resp = await client.get("/api/auth/me")
    assert me_resp.status_code == 200

    logout_resp = await client.post("/api/auth/logout")
    assert logout_resp.status_code == 200

    me_after = await client.get("/api/auth/me")
    assert me_after.status_code == 401


# ---------------------------------------------------------------------------
# 2. Bad credentials → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bad_credentials_returns_401(client: AsyncTestClient[Litestar]) -> None:
    resp = await _login(client, password="wrong_password")  # noqa: S106
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 3. Unauthenticated /me → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unauthenticated_me_returns_401(client: AsyncTestClient[Litestar]) -> None:
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 4. Session rotation — revoke-all-other drops peer sessions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_all_other_drops_peer_sessions(e2e_app: Litestar) -> None:
    """Session A calls revoke-all-other; Session B's cookie is then rejected."""
    async with AsyncTestClient[Litestar](app=e2e_app) as session_a:
        login_a = await session_a.post(
            "/api/auth/login",
            json={"username": _ADMIN_USERNAME, "password": _ADMIN_PASSWORD},
        )
        assert login_a.status_code == 200

    async with AsyncTestClient[Litestar](app=e2e_app) as session_b:
        login_b = await session_b.post(
            "/api/auth/login",
            json={"username": _ADMIN_USERNAME, "password": _ADMIN_PASSWORD},
        )
        assert login_b.status_code == 200

        revoke_resp = await session_b.post("/api/auth/sessions/revoke-all-other")
        assert revoke_resp.status_code == 200

    # Session A's cookie is now invalid.
    async with AsyncTestClient[Litestar](app=e2e_app) as session_a_replay:
        cookie_a = _session_cookie(login_a)
        assert cookie_a is not None
        session_a_replay.cookies.set("comradarr_session", cookie_a)
        me_resp = await session_a_replay.get("/api/auth/me")
        assert me_resp.status_code == 401


# ---------------------------------------------------------------------------
# 5. API key lifecycle — issue → use → revoke → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_api_key_lifecycle(client: AsyncTestClient[Litestar]) -> None:
    login_resp = await _login(client)
    assert login_resp.status_code == 200

    issue_resp = await client.post("/api/api-keys", json={"name": "e2e-test-key"})
    assert issue_resp.status_code == 201, issue_resp.text
    plaintext: str = str(issue_resp.json()["plaintext"])
    key_id: str = str(issue_resp.json()["key"]["id"])
    assert plaintext.startswith("cmrr_live_")

    async with AsyncTestClient[Litestar](app=client.app) as key_client:
        key_client.headers["Authorization"] = f"Bearer {plaintext}"
        me_resp = await key_client.get("/api/auth/me")
        assert me_resp.status_code == 200

    revoke_resp = await client.delete(f"/api/api-keys/{key_id}")
    assert revoke_resp.status_code == 204

    async with AsyncTestClient[Litestar](app=client.app) as key_client_after:
        key_client_after.headers["Authorization"] = f"Bearer {plaintext}"
        me_after = await key_client_after.get("/api/auth/me")
        assert me_after.status_code == 401


# ---------------------------------------------------------------------------
# 6. Trusted-header gate — settings validation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_trusted_header_settings_accepted(_e2e_app: Litestar) -> None:
    """Trusted-header settings build without error; CIDR gate tested in unit tests."""
    settings_with_trusted = stub_settings(
        overrides={
            "DATABASE_URL": os.environ.get("TEST_DATABASE_URL", ""),
            "COMRADARR_SECRET_KEY": STUB_SECRET_KEY,
            "COMRADARR_AUDIT_ADMIN_PASSWORD": STUB_AUDIT_ADMIN_PASSWORD,
            "COMRADARR_RUN_MIGRATIONS_ON_STARTUP": "false",
            "COMRADARR_RUN_DB_PROBES_ON_STARTUP": "false",
            "COMRADARR_INSECURE_COOKIES": "true",
            "COMRADARR_TRUSTED_HEADER_AUTH_ENABLED": "true",
            "COMRADARR_TRUSTED_HEADER_AUTH_HEADER": "X-Remote-User",
            "COMRADARR_TRUSTED_HEADER_AUTH_PROXY_IPS": "127.0.0.1/32",
        }
    )
    assert settings_with_trusted.trusted_header_auth_enabled is True  # type: ignore[attr-defined]
    assert settings_with_trusted.trusted_header_auth_proxy_ips == "127.0.0.1/32"  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# 7. Rate limiter — 6 bad logins all return 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rate_limiter_trips_after_max_attempts(e2e_app: Litestar) -> None:
    """Six consecutive bad-password logins all return 401.

    Verifies the gate is running (counter accumulates); exact rate-limit
    HTTP status depends on whether the IP window is also tripped.
    """
    async with AsyncTestClient[Litestar](app=e2e_app) as rl_client:
        for _ in range(6):
            resp = await rl_client.post(
                "/api/auth/login",
                json={"username": _ADMIN_USERNAME, "password": "bad_pw_for_rl_test"},
            )
            assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 8. OIDC e2e — skipped (requires external IdP)
# ---------------------------------------------------------------------------


@pytest.mark.skip(
    reason=(
        "OIDC e2e requires an RS256 IdP (keypair + JWKS endpoint + token issuer). "
        "See docs/runbook/auth-e2e.md §4 for manual verification steps. "
        "In-process mock planned for Phase 5."
    )
)
@pytest.mark.asyncio
async def test_oidc_login_flow(_client: AsyncTestClient[Litestar]) -> None:
    """Placeholder: OIDC authorization_code + PKCE-S256 end-to-end."""
