"""Settings repr / Secret-leak coverage (plan §5.3.1 Settings rewrap)."""

import pytest

from comradarr.config import derive_audit_admin_url, load_settings
from comradarr.core.types import Secret
from comradarr.errors.configuration import ConfigurationError
from tests.conftest import (
    STUB_AUDIT_ADMIN_PASSWORD,
    STUB_DATABASE_URL,
    STUB_SECRET_KEY,
    stub_settings,
)


def test_settings_repr_does_not_leak_secrets() -> None:
    s = stub_settings()
    rendered = repr(s)
    # Secret-wrapped fields render as the literal redaction marker.
    assert rendered.count("<Secret>") >= 2  # database_url + audit_admin_password
    # The actual DSN body must not appear (it's behind Secret[str]).
    assert STUB_DATABASE_URL not in rendered
    assert "stub:stub@localhost" not in rendered
    # The audit-admin password must not appear.
    assert STUB_AUDIT_ADMIN_PASSWORD not in rendered
    # NOTE: comradarr_secret_key remains as bare bytes per Phase 3 scope -- the
    # full Secret rewrap of the signing key is deferred (see plan §"Phase 30
    # owns full rewrap"). Phase 3 M2 only wraps database_url + audit_admin_password.
    _ = STUB_SECRET_KEY  # kept imported so the scope reminder above stays grep-able


def test_database_url_is_secret_wrapped() -> None:
    s = stub_settings()
    assert isinstance(s.database_url, Secret)
    assert s.database_url.expose() == STUB_DATABASE_URL


def test_audit_admin_password_is_secret_wrapped_and_required() -> None:
    s = stub_settings()
    assert isinstance(s.audit_admin_password, Secret)
    assert s.audit_admin_password.expose() == STUB_AUDIT_ADMIN_PASSWORD


def test_audit_admin_password_missing_raises() -> None:
    env = {
        "COMRADARR_SECRET_KEY": STUB_SECRET_KEY,
        "DATABASE_URL": STUB_DATABASE_URL,
        # COMRADARR_AUDIT_ADMIN_PASSWORD intentionally omitted
    }
    with pytest.raises(ConfigurationError, match="COMRADARR_AUDIT_ADMIN_PASSWORD is required"):
        _ = load_settings(env=env)


def test_audit_admin_password_too_short_raises() -> None:
    env = {
        "COMRADARR_SECRET_KEY": STUB_SECRET_KEY,
        "DATABASE_URL": STUB_DATABASE_URL,
        "COMRADARR_AUDIT_ADMIN_PASSWORD": "short",
    }
    with pytest.raises(ConfigurationError, match="at least 32 characters"):
        _ = load_settings(env=env)


def test_audit_admin_url_optional_default_none() -> None:
    s = stub_settings()
    assert s.audit_admin_database_url is None


def test_audit_admin_url_when_set_is_wrapped() -> None:
    explicit = "postgresql+asyncpg://comradarr_audit_admin:pwd@db:5432/comradarr"
    s = stub_settings(overrides={"AUDIT_ADMIN_DATABASE_URL": explicit})
    assert isinstance(s.audit_admin_database_url, Secret)
    assert s.audit_admin_database_url.expose() == explicit


def test_audit_admin_url_wrong_driver_raises() -> None:
    with pytest.raises(ConfigurationError, match="postgresql\\+asyncpg"):
        _ = stub_settings(
            overrides={"AUDIT_ADMIN_DATABASE_URL": "postgresql://x@host/db"},
        )


def test_audit_retention_days_default_none() -> None:
    s = stub_settings()
    assert s.comradarr_audit_retention_days is None
    assert s.audit_retention_timedelta() is None


def test_audit_retention_days_set() -> None:
    s = stub_settings(overrides={"COMRADARR_AUDIT_RETENTION_DAYS": "30"})
    assert s.comradarr_audit_retention_days == 30
    td = s.audit_retention_timedelta()
    assert td is not None
    assert td.days == 30


def test_audit_retention_days_zero_normalizes_to_none() -> None:
    # 0 means indefinite (would otherwise purge the table on every tick).
    s = stub_settings(overrides={"COMRADARR_AUDIT_RETENTION_DAYS": "0"})
    assert s.comradarr_audit_retention_days is None
    assert s.audit_retention_timedelta() is None


def test_audit_vacuum_interval_default() -> None:
    s = stub_settings()
    assert s.comradarr_audit_vacuum_interval_seconds == 3600


def test_audit_vacuum_interval_override() -> None:
    s = stub_settings(overrides={"COMRADARR_AUDIT_VACUUM_INTERVAL_SECONDS": "300"})
    assert s.comradarr_audit_vacuum_interval_seconds == 300


def test_derive_audit_admin_url_substitutes_userinfo() -> None:
    app_url = Secret("postgresql+asyncpg://comradarr_app:apppwd@db:5432/comradarr")
    pwd = Secret("audit-admin-password-very-long-32+")
    derived = derive_audit_admin_url(app_url, pwd)
    assert derived == (
        "postgresql+asyncpg://comradarr_audit_admin:audit-admin-password-very-long-32+"
        "@db:5432/comradarr"
    )


def test_derive_audit_admin_url_rejects_non_app_userinfo() -> None:
    app_url = Secret("postgresql+asyncpg://someone_else:pwd@db:5432/comradarr")
    pwd = Secret("x" * 32)
    with pytest.raises(ConfigurationError, match="cannot derive audit-admin DSN"):
        _ = derive_audit_admin_url(app_url, pwd)
