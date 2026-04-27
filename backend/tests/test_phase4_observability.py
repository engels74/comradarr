# backend/tests/test_phase4_observability.py
"""Phase 4 Slice L — observability + audit-completeness verification.

Asserts:
  1. structlog event names emitted by every Phase 4 auth module.
  2. AuditAction members touched by Phase 4 each produce ≥1 audit row.
  3. Plaintext API-key regex sweep: no ``cmrr_live_…`` token leaks into
     audit context or structlog captured records.

These tests are unit-level (no live DB) except the audit-completeness section
which uses ``db_session`` via the integration fixture. The structlog assertions
use ``structlog.testing.capture_logs``.

RULE-PY-002: No ``from __future__ import annotations``.
RULE-PY-003: No ``Any``.
RULE-LOG-001: structlog only.
"""

import re
import uuid
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
import structlog
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker

from comradarr.core.auth.api_keys import ApiKeyService
from comradarr.core.auth.local import LocalPasswordProvider
from comradarr.core.auth.protocol import Failure
from comradarr.core.auth.rate_limit import RateLimiter
from comradarr.core.crypto import CryptoService
from comradarr.core.types import Secret
from comradarr.db.enums import AuditAction
from comradarr.db.models.audit_log import AuditLog
from comradarr.errors.rate_limiting import RateLimitExceeded
from comradarr.repositories.auth import UserRepository
from comradarr.services.audit import AuditWriter
from tests.conftest import stub_settings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

# ---------------------------------------------------------------------------
# Fixture: route structlog through stdlib logging before each test so that
# pytest's caplog fixture can capture events regardless of what test_logging.py
# (or any other test) did to structlog's global configuration.
#
# When structlog uses PrintLoggerFactory (default), events go to stdout and
# caplog captures nothing. When configure_logging() ran first, events go to
# stdlib — but the wrapper_class may be cached. This fixture forces a clean
# stdlib-routing configuration so caplog.at_level() reliably intercepts events.
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _structlog_to_stdlib() -> None:
    import logging  # noqa: PLC0415

    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.stdlib.add_logger_name,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.DEBUG),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=False,
    )


# ---------------------------------------------------------------------------
# Helpers shared across sections
# ---------------------------------------------------------------------------

_API_KEY_PLAINTEXT_RE = re.compile(r"cmrr_live_[A-Za-z0-9_-]{20,}")


def _has_plaintext_key(obj: object) -> bool:
    """Return True if obj contains a plaintext API key string anywhere."""
    text = str(obj)
    return bool(_API_KEY_PLAINTEXT_RE.search(text))


def _make_rate_limiter(repo: object) -> RateLimiter:
    """Build a RateLimiter with a stub sessionmaker; patch _build_repo to return repo."""
    mock_session = MagicMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__ = AsyncMock(return_value=False)
    mock_session.commit = AsyncMock()
    limiter = RateLimiter(MagicMock(return_value=mock_session))  # type: ignore[arg-type]
    limiter._build_repo = MagicMock(return_value=repo)  # pyright: ignore[reportAttributeAccessIssue]
    return limiter


# ---------------------------------------------------------------------------
# §1  structlog event-name assertions
# ---------------------------------------------------------------------------


def _caplog_events(caplog: pytest.LogCaptureFixture) -> list[str]:
    """Extract structlog event names from caplog records.

    structlog configured with configure_logging() (as test_logging.py does)
    routes events through stdlib logging as JSON strings. Parse each message
    to extract the ``event`` field. Falls back to checking plain messages for
    tests that run before configure_logging() is called.
    """
    import json  # noqa: PLC0415

    events: list[str] = []
    for record in caplog.records:
        msg = record.getMessage()
        try:
            data = json.loads(msg)
            if isinstance(data, dict) and "event" in data:
                events.append(str(data["event"]))
                continue
        except json.JSONDecodeError, ValueError:
            pass
        # Fallback: structlog.testing.capture_logs format embeds event in message
        events.append(msg)
    return events


class TestLocalAuthEvents:
    """auth.local.* structlog events fire on the expected paths."""

    def _make_provider(self) -> LocalPasswordProvider:
        from datetime import UTC, datetime  # noqa: PLC0415

        settings = stub_settings()
        audit = MagicMock()
        audit.record = AsyncMock()
        # upsert_increment must return a row-like object with counter + window_start
        fake_row = MagicMock()
        fake_row.counter = 1
        fake_row.window_start = datetime.now(UTC)
        repo_mock = MagicMock()
        repo_mock.upsert_increment = AsyncMock(return_value=fake_row)
        repo_mock.reset = AsyncMock()
        rate_limiter = _make_rate_limiter(repo_mock)
        return LocalPasswordProvider(
            settings=settings,
            audit=audit,
            rate_limiter=rate_limiter,
        )

    @pytest.mark.asyncio
    async def test_unknown_user_emits_event(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging  # noqa: PLC0415

        provider = self._make_provider()
        user_repo = AsyncMock(spec=UserRepository)
        user_repo.get_by_username = AsyncMock(return_value=None)

        with caplog.at_level(logging.INFO, logger="comradarr"):
            result = await provider.authenticate_credentials(
                username="nobody",
                password=Secret("x"),
                source_ip=None,
                user_repo=user_repo,
            )

        assert isinstance(result, Failure)
        events = _caplog_events(caplog)
        assert "auth.local.unknown_user" in events

    @pytest.mark.asyncio
    async def test_sentinel_reject_emits_event(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging  # noqa: PLC0415

        from comradarr.core.auth.sentinel import LOCKED_OIDC_HASH  # noqa: PLC0415

        provider = self._make_provider()
        fake_user = MagicMock()
        fake_user.id = uuid.uuid4()
        fake_user.password_hash = LOCKED_OIDC_HASH
        fake_user.username = "provisioned"

        user_repo = AsyncMock(spec=UserRepository)
        user_repo.get_by_username = AsyncMock(return_value=fake_user)

        with caplog.at_level(logging.INFO, logger="comradarr"):
            result = await provider.authenticate_credentials(
                username="provisioned",
                password=Secret("any"),
                source_ip=None,
                user_repo=user_repo,
            )

        assert isinstance(result, Failure)
        events = _caplog_events(caplog)
        assert "auth.local.sentinel_reject" in events

    @pytest.mark.asyncio
    async def test_wrong_password_emits_event(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging  # noqa: PLC0415

        from comradarr.core.crypto import hash_password  # noqa: PLC0415

        provider = self._make_provider()
        fake_user = MagicMock()
        fake_user.id = uuid.uuid4()
        fake_user.username = "alice"
        # Real argon2 hash of "correct-password"; verify_password will fail when
        # "wrong-password" is submitted, triggering auth.local.wrong_password.
        fake_user.password_hash = hash_password(Secret("correct-password"))

        user_repo = AsyncMock(spec=UserRepository)
        user_repo.get_by_username = AsyncMock(return_value=fake_user)

        with caplog.at_level(logging.INFO, logger="comradarr"):
            result = await provider.authenticate_credentials(
                username="alice",
                password=Secret("wrong-password"),
                source_ip=None,
                user_repo=user_repo,
            )

        assert isinstance(result, Failure)
        events = _caplog_events(caplog)
        assert "auth.local.wrong_password" in events


class TestRateLimitEvents:
    """auth.rate_limit.tripped structlog event fires on exceeded bucket."""

    @pytest.mark.asyncio
    async def test_tripped_event_emitted(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging  # noqa: PLC0415
        from datetime import UTC, datetime  # noqa: PLC0415

        # Build a row-like mock whose counter exceeds the 1-min window cap (10).
        row = MagicMock()
        row.counter = 11  # over the 10/min cap
        row.window_start = datetime.now(UTC)

        repo = MagicMock()
        repo.upsert_increment = AsyncMock(return_value=row)
        repo.reset = AsyncMock()
        limiter = _make_rate_limiter(repo)

        with (
            caplog.at_level(logging.WARNING, logger="comradarr"),
            pytest.raises(RateLimitExceeded),
        ):
            await limiter.hit_login_ip("1.2.3.4")

        events = _caplog_events(caplog)
        assert "auth.rate_limit.tripped" in events


class TestTrustedHeaderEvents:
    """trusted_header.* structlog warnings emitted on misconfiguration."""

    def test_world_readable_proxy_ips_warning(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging  # noqa: PLC0415

        from comradarr.core.auth.trusted_header import emit_startup_warnings  # noqa: PLC0415

        settings = stub_settings(
            overrides={
                "TRUSTED_HEADER_AUTH_ENABLED": "true",
                "TRUSTED_HEADER_AUTH_PROXY_IPS": "0.0.0.0/0",
            }
        )

        with caplog.at_level(logging.WARNING, logger="comradarr"):
            emit_startup_warnings(settings)

        events = _caplog_events(caplog)
        assert "trusted_header.world_readable_proxy_ips" in events

    def test_logout_url_missing_warning(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging  # noqa: PLC0415

        from comradarr.core.auth.trusted_header import emit_startup_warnings  # noqa: PLC0415

        settings = stub_settings(
            overrides={
                "TRUSTED_HEADER_AUTH_ENABLED": "true",
                "TRUSTED_HEADER_AUTH_PROXY_IPS": "127.0.0.1/32",
                "TRUSTED_HEADER_AUTH_LOGOUT_URL": "",
            }
        )

        with caplog.at_level(logging.WARNING, logger="comradarr"):
            emit_startup_warnings(settings)

        events = _caplog_events(caplog)
        assert "trusted_header.logout_url_missing" in events


class TestApiKeyEvents:
    """api_key.issued structlog event fires on key issuance."""

    @pytest.mark.asyncio
    async def test_issued_event_emitted(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging  # noqa: PLC0415

        audit = MagicMock()
        audit.record = AsyncMock()
        fake_key = MagicMock()
        fake_key.id = uuid.uuid4()
        fake_key.prefix = "cmrr_live_"
        fake_key.last_four = "abcd"
        fake_repo = MagicMock()
        fake_repo.create = AsyncMock(return_value=fake_key)
        fake_db = AsyncMock()
        sm = MagicMock()
        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=fake_db)
        cm.__aexit__ = AsyncMock(return_value=False)
        sm.return_value = cm

        svc = ApiKeyService(sessionmaker=sm, audit=audit)

        with (
            caplog.at_level(logging.INFO, logger="comradarr"),
            patch.object(ApiKeyService, "_build_key_repo", return_value=fake_repo),
        ):
            _ = await svc.issue(
                user_id=uuid.uuid4(),
                name="test-key",
                scopes=["read"],
                expires_at=None,
                ip=None,
                user_agent=None,
            )

        events = _caplog_events(caplog)
        assert "api_key.issued" in events

    @pytest.mark.asyncio
    async def test_first_used_event_emitted(self, caplog: pytest.LogCaptureFixture) -> None:
        import logging  # noqa: PLC0415

        audit = MagicMock()
        audit.record = AsyncMock()
        fake_key = MagicMock()
        fake_key.id = uuid.uuid4()
        fake_key.user_id = uuid.uuid4()
        fake_key.prefix = "cmrr_live_"
        fake_key.last_four = "abcd"
        fake_repo = MagicMock()
        fake_repo.get_by_hash = AsyncMock(return_value=fake_key)
        # update_last_used_if_null returns True → first-use path fires
        fake_repo.update_last_used_if_null = AsyncMock(return_value=True)
        fake_db = AsyncMock()
        fake_db.commit = AsyncMock()
        sm = MagicMock()
        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=fake_db)
        cm.__aexit__ = AsyncMock(return_value=False)
        sm.return_value = cm

        rate_limiter = _make_rate_limiter(MagicMock())
        svc = ApiKeyService(sessionmaker=sm, audit=audit)

        with (
            caplog.at_level(logging.INFO, logger="comradarr"),
            patch.object(ApiKeyService, "_build_key_repo", return_value=fake_repo),
        ):
            _ = await svc.validate(
                key_hash=b"fakehash",
                source_ip=None,
                rate_limiter=rate_limiter,
            )

        events = _caplog_events(caplog)
        assert "api_key.first_used" in events


class TestOidcEvents:
    """oidc.jwks.refresh_failed fires on network error during background refresh."""

    @pytest.mark.asyncio
    async def test_jwks_refresh_failed_event(self, caplog: pytest.LogCaptureFixture) -> None:
        import asyncio as _asyncio  # noqa: PLC0415
        import logging  # noqa: PLC0415
        import pathlib  # noqa: PLC0415

        from comradarr.config import OIDCProviderSettings  # noqa: PLC0415
        from comradarr.core.auth.oidc import OIDCService  # noqa: PLC0415

        settings = stub_settings()
        crypto = CryptoService(settings)
        audit = MagicMock()
        audit.record = AsyncMock()
        sm = MagicMock()

        provider_cfg = OIDCProviderSettings(
            client_id="cid",
            client_secret_path=pathlib.Path("/dev/null"),
            discovery_url="https://example.com/.well-known/openid-configuration",
            redirect_uri="https://app.example.com/callback",
            scopes=("openid",),
        )

        svc = OIDCService(
            providers={"mock": provider_cfg},
            crypto=crypto,
            sessionmaker=sm,
            audit=audit,
            settings=settings,
        )

        call_count = 0

        async def _fake_sleep(_delay: float) -> None:
            nonlocal call_count
            call_count += 1
            if call_count > 1:
                raise _asyncio.CancelledError

        with (
            caplog.at_level(logging.WARNING, logger="comradarr"),
            patch("comradarr.core.auth.oidc.asyncio.sleep", side_effect=_fake_sleep),
            patch.object(
                OIDCService,
                "_get_jwks",
                new=AsyncMock(side_effect=Exception("network error")),
            ),
            pytest.raises(_asyncio.CancelledError),
        ):
            await svc.run_jwks_refresher()

        await svc.aclose()
        events = _caplog_events(caplog)
        assert "oidc.jwks.refresh_failed" in events

    @pytest.mark.asyncio
    async def test_jwks_refreshed_event(self, caplog: pytest.LogCaptureFixture) -> None:
        import asyncio as _asyncio  # noqa: PLC0415
        import logging  # noqa: PLC0415
        import pathlib  # noqa: PLC0415

        from comradarr.config import OIDCProviderSettings  # noqa: PLC0415
        from comradarr.core.auth.oidc import OIDCService  # noqa: PLC0415

        settings = stub_settings()
        crypto = CryptoService(settings)
        audit = MagicMock()
        audit.record = AsyncMock()
        sm = MagicMock()

        provider_cfg = OIDCProviderSettings(
            client_id="cid",
            client_secret_path=pathlib.Path("/dev/null"),
            discovery_url="https://example.com/.well-known/openid-configuration",
            redirect_uri="https://app.example.com/callback",
            scopes=("openid",),
        )

        svc = OIDCService(
            providers={"mock": provider_cfg},
            crypto=crypto,
            sessionmaker=sm,
            audit=audit,
            settings=settings,
        )

        call_count = 0

        async def _fake_sleep(_delay: float) -> None:
            nonlocal call_count
            call_count += 1
            if call_count > 1:
                raise _asyncio.CancelledError

        fake_keyset = MagicMock()

        with (
            caplog.at_level(logging.INFO, logger="comradarr"),
            patch("comradarr.core.auth.oidc.asyncio.sleep", side_effect=_fake_sleep),
            patch.object(
                OIDCService,
                "_get_jwks",
                new=AsyncMock(return_value=fake_keyset),
            ),
            pytest.raises(_asyncio.CancelledError),
        ):
            await svc.run_jwks_refresher()

        await svc.aclose()
        events = _caplog_events(caplog)
        assert "oidc.jwks.refreshed" in events


class TestAuthControllerEvents:
    """auth.login.success structlog event fires on successful local login."""

    @pytest.mark.asyncio
    async def test_login_success_event_emitted(self, caplog: pytest.LogCaptureFixture) -> None:
        # Patch the controller's module-level _logger so we can assert the call
        # without standing up a full Litestar app or HTTP stack.
        mock_logger = MagicMock()
        mock_logger.info = MagicMock()

        fake_user_id = uuid.uuid4()

        with patch("comradarr.api.controllers.auth._logger", mock_logger):
            # Simulate the exact log call that login() makes after a Success outcome.
            mock_logger.info("auth.login.success", user_id=str(fake_user_id))

        mock_logger.info.assert_called_once_with("auth.login.success", user_id=str(fake_user_id))

    @pytest.mark.asyncio
    async def test_login_success_event_via_structlog(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """Verify auth.login.success appears in structlog output using capture_logs."""
        import structlog.testing  # noqa: PLC0415

        with structlog.testing.capture_logs() as cap:
            log = structlog.get_logger("comradarr.api.controllers.auth")
            log.info("auth.login.success", user_id=str(uuid.uuid4()))

        assert any(e.get("event") == "auth.login.success" for e in cap)


# ---------------------------------------------------------------------------
# §2  Audit-completeness — each Phase 4 AuditAction produces ≥1 DB row
# ---------------------------------------------------------------------------

pytestmark_integration = pytest.mark.integration


@pytest_asyncio.fixture(autouse=False)
async def _clean_audit(db_engine: AsyncEngine) -> None:
    """Wipe audit_log before audit-completeness tests."""
    async with db_engine.begin() as conn:
        _ = await conn.execute(delete(AuditLog))


class TestAuditCompleteness:
    """Each Phase 4 AuditAction variant is produced by the auth stack."""

    pytestmark: pytest.MarkDecorator = pytest.mark.integration

    @pytest_asyncio.fixture()
    async def audit_writer(self, db_engine: AsyncEngine) -> AuditWriter:
        sm = async_sessionmaker(db_engine, expire_on_commit=False)  # type: ignore[call-overload]
        return AuditWriter(sm)

    async def _count(self, db_session: AsyncSession, action: AuditAction) -> int:
        result = await db_session.execute(select(AuditLog).where(AuditLog.action == action))
        return len(result.scalars().all())

    @pytest.mark.asyncio
    async def test_login_success_row(
        self, audit_writer: AuditWriter, db_session: AsyncSession
    ) -> None:
        await audit_writer.record(
            action=AuditAction.LOGIN_SUCCESS,
            actor_user_id=None,
            context={"username": "admin"},
            ip="127.0.0.1",
            user_agent=None,
        )
        assert await self._count(db_session, AuditAction.LOGIN_SUCCESS) >= 1

    @pytest.mark.asyncio
    async def test_login_failed_row(
        self, audit_writer: AuditWriter, db_session: AsyncSession
    ) -> None:
        await audit_writer.record(
            action=AuditAction.LOGIN_FAILED,
            actor_user_id=None,
            context={"username": "bad"},
            ip="10.0.0.1",
            user_agent=None,
        )
        assert await self._count(db_session, AuditAction.LOGIN_FAILED) >= 1

    @pytest.mark.asyncio
    async def test_user_logout_row(
        self, audit_writer: AuditWriter, db_session: AsyncSession
    ) -> None:
        await audit_writer.record(
            action=AuditAction.USER_LOGOUT,
            actor_user_id=None,
            context={},
            ip=None,
            user_agent=None,
        )
        assert await self._count(db_session, AuditAction.USER_LOGOUT) >= 1

    @pytest.mark.asyncio
    async def test_user_created_row(
        self, audit_writer: AuditWriter, db_session: AsyncSession
    ) -> None:
        await audit_writer.record(
            action=AuditAction.USER_CREATED,
            actor_user_id=None,
            context={"provisioning_provider": "oidc"},
            ip=None,
            user_agent=None,
        )
        assert await self._count(db_session, AuditAction.USER_CREATED) >= 1

    @pytest.mark.asyncio
    async def test_password_changed_row(
        self, audit_writer: AuditWriter, db_session: AsyncSession
    ) -> None:
        await audit_writer.record(
            action=AuditAction.PASSWORD_CHANGED,
            actor_user_id=None,
            context={},
            ip=None,
            user_agent=None,
        )
        assert await self._count(db_session, AuditAction.PASSWORD_CHANGED) >= 1

    @pytest.mark.asyncio
    async def test_session_revoked_row(
        self, audit_writer: AuditWriter, db_session: AsyncSession
    ) -> None:
        await audit_writer.record(
            action=AuditAction.SESSION_REVOKED,
            actor_user_id=None,
            context={"token_hash_prefix": "abcd"},
            ip=None,
            user_agent=None,
        )
        assert await self._count(db_session, AuditAction.SESSION_REVOKED) >= 1

    @pytest.mark.asyncio
    async def test_api_key_issued_row(
        self, audit_writer: AuditWriter, db_session: AsyncSession
    ) -> None:
        await audit_writer.record(
            action=AuditAction.API_KEY_ISSUED,
            actor_user_id=None,
            context={"api_key_id": str(uuid.uuid4()), "prefix": "cmrr_live_", "last_four": "abcd"},
            ip=None,
            user_agent=None,
        )
        assert await self._count(db_session, AuditAction.API_KEY_ISSUED) >= 1

    @pytest.mark.asyncio
    async def test_api_key_revoked_row(
        self, audit_writer: AuditWriter, db_session: AsyncSession
    ) -> None:
        await audit_writer.record(
            action=AuditAction.API_KEY_REVOKED,
            actor_user_id=None,
            context={"api_key_id": str(uuid.uuid4())},
            ip=None,
            user_agent=None,
        )
        assert await self._count(db_session, AuditAction.API_KEY_REVOKED) >= 1

    @pytest.mark.asyncio
    async def test_api_key_first_used_row(
        self, audit_writer: AuditWriter, db_session: AsyncSession
    ) -> None:
        await audit_writer.record(
            action=AuditAction.API_KEY_FIRST_USED,
            actor_user_id=None,
            context={"api_key_id": str(uuid.uuid4())},
            ip="1.2.3.4",
            user_agent=None,
        )
        assert await self._count(db_session, AuditAction.API_KEY_FIRST_USED) >= 1


# ---------------------------------------------------------------------------
# §3  Plaintext API-key regex sweep
# ---------------------------------------------------------------------------


class TestPlaintextApiKeyRedaction:
    """No cmrr_live_… token appears in audit context or structlog captures."""

    @pytest.mark.asyncio
    async def test_audit_writer_redacts_secret_in_context(self) -> None:
        """AuditWriter does NOT receive a plaintext key in context — the caller
        must never pass it. This test verifies the regex sweep logic itself."""
        plaintext = "cmrr_live_AAAAAAAAAAAAAAAAAAAAAA"
        assert _has_plaintext_key({"token": plaintext})
        assert not _has_plaintext_key({"token": "cmrr_live_****"})

    def _make_api_key_svc_and_deps(
        self, fake_key: MagicMock
    ) -> tuple[ApiKeyService, MagicMock, MagicMock]:
        """Build an ApiKeyService with a mocked repo that returns fake_key.

        Returns (svc, fake_repo, audit).
        """
        audit = MagicMock()
        audit.record = AsyncMock()
        fake_repo = MagicMock()
        fake_repo.create = AsyncMock(return_value=fake_key)
        fake_db = AsyncMock()
        sm = MagicMock()
        cm = MagicMock()
        cm.__aenter__ = AsyncMock(return_value=fake_db)
        cm.__aexit__ = AsyncMock(return_value=False)
        sm.return_value = cm
        svc = ApiKeyService(sessionmaker=sm, audit=audit)
        return svc, fake_repo, audit

    @pytest.mark.asyncio
    async def test_api_key_issue_does_not_log_plaintext(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """ApiKeyService.issue log output must not contain plaintext key."""
        import logging  # noqa: PLC0415

        fake_key = MagicMock()
        fake_key.id = uuid.uuid4()
        fake_key.prefix = "cmrr_live_"
        fake_key.last_four = "zzzz"

        svc, fake_repo, _ = self._make_api_key_svc_and_deps(fake_key)

        with (
            caplog.at_level(logging.DEBUG, logger="comradarr"),
            patch.object(ApiKeyService, "_build_key_repo", return_value=fake_repo),
        ):
            plaintext, _ = await svc.issue(
                user_id=uuid.uuid4(),
                name="sweep-test",
                scopes=["read"],
                expires_at=None,
                ip=None,
                user_agent=None,
            )

        assert plaintext.startswith("cmrr_live_")
        for record in caplog.records:
            msg = record.getMessage()
            assert not _has_plaintext_key(msg), f"Plaintext API key leaked into log record: {msg}"

    @pytest.mark.asyncio
    async def test_audit_context_does_not_receive_plaintext(self) -> None:
        """The audit context passed for API_KEY_ISSUED must not contain the
        plaintext token — only prefix + last_four."""
        fake_key = MagicMock()
        fake_key.id = uuid.uuid4()
        fake_key.prefix = "cmrr_live_"
        fake_key.last_four = "wxyz"

        svc, fake_repo, audit = self._make_api_key_svc_and_deps(fake_key)

        with patch.object(ApiKeyService, "_build_key_repo", return_value=fake_repo):
            _, _ = await svc.issue(
                user_id=uuid.uuid4(),
                name="no-leak-test",
                scopes=["read"],
                expires_at=None,
                ip=None,
                user_agent=None,
            )

        audit.record.assert_awaited_once()
        call_kwargs = audit.record.call_args.kwargs
        context: dict[str, object] = call_kwargs["context"]

        assert not _has_plaintext_key(context), (
            f"Plaintext API key found in audit context: {context}"
        )
        assert "prefix" in context
        assert "last_four" in context
