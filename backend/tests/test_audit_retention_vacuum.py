"""AuditRetentionVacuum behavioral coverage (Phase 3 M5 step 14).

Three contracts:

1. With a finite ``horizon``, ``run_once`` deletes rows older than
   ``now - horizon`` and leaves rows inside the window untouched.
2. Under the ``comradarr_app`` role, ``DELETE FROM audit_log`` raises
   ``InsufficientPrivilege`` — a behavioral mirror of the schema-level
   carve-out enforced by ``test_role_permissions.test_app_cannot_delete_*``.
3. With ``horizon=None``, the vacuum emits the structured
   ``audit.retention.skipped`` event and never issues a DELETE — the
   "retain forever" mode lights up but stays inert.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest
import structlog
from sqlalchemy import delete, func, insert, select, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import async_sessionmaker

from comradarr.db.enums import AuditAction
from comradarr.db.models.audit_log import AuditLog
from comradarr.services.audit import AuditRetentionVacuum
from comradarr.services.audit import vacuum as vacuum_module

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _reset_vacuum_logger(monkeypatch: pytest.MonkeyPatch) -> None:  # pyright: ignore[reportUnusedFunction]
    """Replace ``vacuum._logger`` with a fresh ``BoundLoggerLazyProxy`` per test.

    structlog's ``cache_logger_on_first_use=True`` (set by Litestar's
    ``StructlogPlugin`` during sibling tests) caches the resolved BoundLogger
    against the processor list reference current at first use.
    :func:`structlog.testing.capture_logs` mutates ``get_config()["processors"]``
    in-place, but the cached logger may hold a different list reference and
    miss the collector. Re-binding the module-level ``_logger`` to a fresh
    lazy proxy forces resolution against the current config (post-mutation
    by ``capture_logs``) and unblocks the assertion under any test order.
    """
    fresh_logger = structlog.stdlib.get_logger(vacuum_module.__name__)
    monkeypatch.setattr(vacuum_module, "_logger", fresh_logger)


async def _seed_row(
    sessionmaker: async_sessionmaker[AsyncSession],
    *,
    timestamp: datetime,
) -> uuid.UUID:
    row_id = uuid.uuid4()
    async with sessionmaker() as session:
        _ = await session.execute(
            insert(AuditLog).values(
                id=row_id,
                timestamp=timestamp,
                action=AuditAction.LOGIN_SUCCESS,
                actor_user_id=None,
                context={},
                ip=None,
                user_agent=None,
                correlation_id=None,
            )
        )
        await session.commit()
    return row_id


async def test_run_once_deletes_rows_older_than_horizon(
    db_engine: AsyncEngine,
) -> None:
    """run_once removes rows older than now-horizon and keeps fresher ones."""
    sm = async_sessionmaker(db_engine, expire_on_commit=False)

    # Reset to a known empty state so the count assertion is deterministic
    # under any cross-test order.
    async with sm() as session:
        _ = await session.execute(delete(AuditLog))
        await session.commit()

    horizon = timedelta(days=7)
    now = datetime.now(UTC)
    old_row = await _seed_row(sm, timestamp=now - timedelta(days=30))
    fresh_row = await _seed_row(sm, timestamp=now - timedelta(days=1))

    vacuum = AuditRetentionVacuum(sm, horizon=horizon, interval=3600)
    deleted = await vacuum.run_once()

    assert deleted == 1
    async with sm() as session:
        result = await session.execute(select(AuditLog.id))
        ids = {row[0] for row in result.all()}
    assert old_row not in ids
    assert fresh_row in ids


async def test_app_role_cannot_delete_from_audit_log(db_engine: AsyncEngine) -> None:
    """The carve-out blocks DELETE under comradarr_app — proves vacuum needs audit_admin."""
    async with db_engine.connect() as conn, conn.begin():
        _ = await conn.execute(text('SET LOCAL ROLE "comradarr_app"'))
        with pytest.raises(ProgrammingError):
            _ = await conn.execute(text("DELETE FROM audit_log"))


async def test_run_once_with_horizon_none_skips(db_engine: AsyncEngine) -> None:
    """horizon=None emits audit.retention.skipped and returns 0 without DELETEing.

    Capture path: ``structlog.testing.capture_logs()`` is the structlog-native
    sink — it drops a list-collector processor at the head of the chain and
    short-circuits emission, so the assertion sees the event regardless of
    whether the project has the stdlib bridge wired (caplog) or the default
    PrintLogger configured. Avoids the cross-test order dependency where
    ``caplog`` only sees structlog output if a sibling test has already
    swapped in :class:`structlog.stdlib.LoggerFactory`.
    """
    sm = async_sessionmaker(db_engine, expire_on_commit=False)
    # Seed an ancient row that any finite horizon would purge — the
    # horizon=None branch must leave it intact.
    ancient = datetime.now(UTC) - timedelta(days=10_000)
    row_id = await _seed_row(sm, timestamp=ancient)

    vacuum = AuditRetentionVacuum(sm, horizon=None, interval=3600)

    with structlog.testing.capture_logs() as captured:
        deleted = await vacuum.run_once()

    assert deleted == 0
    assert any(entry.get("event") == "audit.retention.skipped" for entry in captured), (
        f"expected audit.retention.skipped event; captured: {captured!r}"
    )

    async with sm() as session:
        result = await session.execute(
            select(func.count()).select_from(AuditLog).where(AuditLog.id == row_id)
        )
        assert result.scalar_one() == 1
