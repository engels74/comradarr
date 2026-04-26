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
# A high-entropy 32-byte key the test injects into the denylist via
# monkeypatch so the denylist gate is the FIRST gate to trip. Every entry
# currently in leaked_keys.dat is low-entropy ASCII ("changeme..." etc.)
# and would fail the distinct-bytes / Shannon-entropy gate before the
# denylist check fires -- a canonical test trigger isolates the denylist
# branch deterministically without polluting the production corpus.
# Distinct=30, Shannon entropy=4.88 bits/byte (verified at corpus pin).
_DENYLISTED_TEST_KEY_HEX: str = "b990f4fe440cf1ee24f211f854629fb7d6c31bec7d02f12e3a171f322a40b9eb"


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


def test_boot_fails_closed_denylisted_secret_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Scenario (a): denylisted COMRADARR_SECRET_KEY raises ConfigurationError.

    The denylist gate is the LAST gate in :func:`validate_secret_key`, so an
    organic denylist hit requires a high-entropy 32-byte key (the structural
    + entropy gates trigger first for the low-entropy ASCII entries in
    ``leaked_keys.dat``). We monkeypatch the cached denylist frozenset to
    add a known high-entropy test key, then confirm load_settings raises.
    """
    from comradarr.security import secret_key as secret_key_mod

    test_key_bytes = bytes.fromhex(_DENYLISTED_TEST_KEY_HEX)
    monkeypatch.setattr(secret_key_mod, "_denylist_cache", frozenset({test_key_bytes}))

    with pytest.raises(ConfigurationError, match="denylist"):
        _ = load_settings(
            env={
                "COMRADARR_SECRET_KEY": _DENYLISTED_TEST_KEY_HEX,
                "DATABASE_URL": _VALID_DSN,
                "COMRADARR_AUDIT_ADMIN_PASSWORD": _STRONG_AUDIT_ADMIN_PASSWORD,
            }
        )


@pytest.mark.parametrize(
    ("overrides", "needle"),
    [
        # Scenario (b) — registry validation fails on the current key: a
        # 32-byte all-zero key fails the structural shape gate inside
        # validate_secret_key_registry. The wrapper prefixes the error with
        # "secret key registry: current key (vN) failed validation".
        (
            {"COMRADARR_SECRET_KEY": "0" * 64},
            "registry",
        ),
        # Scenario (c) — audit_admin_database_url with a non-asyncpg shape:
        # the explicit AUDIT_ADMIN_DATABASE_URL gate in load_settings rejects
        # any non-asyncpg driver before the lifespan probe runs. (The "wrong
        # password" PRD wording maps to a misconfigured admin DSN; the
        # asyncpg-prefix check is the load_settings-level gate that catches
        # it deterministically without a real Postgres connection.)
        (
            {"AUDIT_ADMIN_DATABASE_URL": "postgresql://comradarr_audit_admin:wrong@h:5/db"},
            "postgresql+asyncpg",
        ),
        # Iter 1 Amendment 1 mirror — missing audit-admin password is the
        # adjacent boot gate (the LOGIN role can't authenticate without it).
        (
            {"COMRADARR_AUDIT_ADMIN_PASSWORD": ""},
            "COMRADARR_AUDIT_ADMIN_PASSWORD",
        ),
    ],
    ids=[
        "registry_validation_failure",
        "non_asyncpg_audit_admin_dsn",
        "missing_audit_admin_password",
    ],
)
def test_boot_fails_closed_on_invalid_inputs(
    overrides: dict[str, str],
    needle: str,
) -> None:
    """Phase 3 boot-fails-closed gate: misconfiguration raises before app construction.

    Scenarios (b) and (c) trip the load_settings-level gates; scenario (d)
    (audit_action enum missing) lives in
    :func:`test_boot_lifespan_enum_probe_fails_closed` because the enum
    gate runs inside the lifespan probe.
    """
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


async def test_boot_lifespan_enum_probe_fails_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Scenario (d): audit_action enum probe failure prevents lifespan acceptance.

    Monkeypatches :func:`comradarr.core.lifespan._probe_audit_action_enum` to
    raise ConfigurationError so the boot-time enum-membership gate is
    exercised without a real Postgres connection. Litestar's lifespan runs
    inside an ``anyio.create_task_group`` so a raised ``ConfigurationError``
    surfaces as a ``BaseExceptionGroup`` with the original error as the lone
    sub-exception. The assertion walks the group to confirm the lifespan
    never accepted a request and the underlying cause is the enum-probe
    failure.
    """
    from comradarr.core import lifespan as lifespan_mod

    async def _failing_probe(_engine: object) -> None:
        raise ConfigurationError(
            "audit_action enum is missing expected members: ['rotation_started']; "
            + "run pending migrations"
        )

    async def _ok_engine_probe(_engine: object, *, role: str) -> None:
        # Bypass the SELECT 1 check so the test isolates the enum-probe path.
        del role

    monkeypatch.setattr(lifespan_mod, "_probe_engine", _ok_engine_probe)
    monkeypatch.setattr(lifespan_mod, "_probe_audit_action_enum", _failing_probe)

    settings = stub_settings(overrides={"COMRADARR_RUN_DB_PROBES_ON_STARTUP": "true"})
    app = create_app(settings=settings)

    with pytest.raises(BaseExceptionGroup) as exc_info:
        async with AsyncTestClient(app=app):
            pass

    matched, _rest = exc_info.value.split(ConfigurationError)
    assert matched is not None, "ConfigurationError sub-exception missing from group"
    inner = matched.exceptions[0]
    assert isinstance(inner, ConfigurationError)
    assert "audit_action enum is missing" in str(inner)


async def test_state_slots_after_create_app() -> None:
    """Phase 3 lifespan slots are populated after entering the lifespan.

    Architect rework (Phase 3 §5.3.5 Iter 1 Critic): the previous form only
    asserted ``app.state.settings`` -- which never enters services_lifespan
    and therefore never proves the Phase 3 wiring (crypto, audit_writer,
    retention vacuum, audit-admin engine) actually runs. This rewrite enters
    the lifespan via AsyncTestClient so every slot is observed in its
    post-startup state.
    """
    from sqlalchemy.ext.asyncio import AsyncEngine

    from comradarr.config import Settings
    from comradarr.core.crypto import CryptoService
    from comradarr.services.audit import AuditRetentionVacuum, AuditWriter

    app = create_app(settings=stub_settings())
    async with AsyncTestClient(app=app):
        settings = cast("Settings", app.state.settings)
        # Secret repr is the audit gate — never echoes the underlying password.
        assert repr(settings.audit_admin_password) == "<Secret>"
        assert len(settings.audit_admin_password.expose()) >= 32

        # Phase 3 §5.3.5 reserved slots — populated by services_lifespan.
        # Casts are required because Litestar's ``app.state`` is Any-typed by
        # design (it's a dynamic slot bag); the isinstance assertions below
        # are the runtime gate that proves the wiring shape.
        crypto = cast("object", app.state.crypto)
        audit_writer = cast("object", app.state.audit_writer)
        retention_vacuum = cast("object", app.state.audit_retention_vacuum)
        audit_admin_engine = cast("object", app.state.audit_admin_engine)
        vacuum_health = cast("object", app.state.audit_retention_vacuum_health)
        vacuum_error = cast("object", app.state.audit_retention_vacuum_error)

        assert isinstance(crypto, CryptoService)
        assert isinstance(audit_writer, AuditWriter)
        assert isinstance(retention_vacuum, AuditRetentionVacuum)
        assert isinstance(audit_admin_engine, AsyncEngine)
        # Initial vacuum health: stub_settings() leaves retention unset, so
        # _initial_vacuum_health(False) yields 'skipped_indefinite'.
        assert vacuum_health == "skipped_indefinite"
        assert vacuum_error is None
