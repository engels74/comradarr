"""AuditWriter behavioral coverage (Phase 3 M5 step 14).

Validates the four contracts the writer is responsible for:

1. ``record(...)`` actually inserts a row (basic INSERT path).
2. :class:`Secret` payloads inside ``context`` are redacted before JSONB
   serialization (single source of truth: :func:`redact_secrets`).
3. ``request_id`` bound on structlog contextvars lands as the row's
   ``correlation_id`` column.
4. The writer + the GRANT matrix together prevent UPDATE/DELETE on
   ``audit_log`` from the application role — the role-permission matrix
   already covers the schema-level case in
   ``tests/db/test_role_permissions.py``; this module exercises the
   matching behavioral assertion through the writer call site.

The tests run under the ``db_engine`` fixture (per-worker schema, alembic
head). The writer is given a fresh ``async_sessionmaker`` bound to that
engine; we read rows back through a separate connection so the assertions
see committed state.
"""

import uuid
from typing import TYPE_CHECKING

import pytest
import pytest_asyncio
import structlog
from sqlalchemy import delete, select, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.ext.asyncio import async_sessionmaker

from comradarr.core.types import Secret
from comradarr.db.enums import AuditAction
from comradarr.db.models.audit_log import AuditLog
from comradarr.services.audit import AuditWriter

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def _clear_structlog_contextvars() -> object:  # pyright: ignore[reportUnusedFunction]
    """Reset structlog contextvars between tests so request_id doesn't leak."""
    structlog.contextvars.clear_contextvars()
    yield
    structlog.contextvars.clear_contextvars()


@pytest_asyncio.fixture(autouse=True)
async def _clean_audit_log(db_engine: AsyncEngine) -> None:  # pyright: ignore[reportUnusedFunction]
    """Wipe ``audit_log`` before each test so ``scalar_one()`` is deterministic.

    The audit-writer tests share a per-worker schema with sibling suites
    (notably ``tests/test_audit_retention_vacuum.py``) which seed and partially
    clean the same table. Running ``delete(AuditLog)`` at the top of every
    test here neutralizes residual rows from prior tests on the same xdist
    worker without coupling to retention-vacuum's bookkeeping. The schema-level
    role guard (only ``comradarr_audit_admin`` may DELETE in production) is
    bypassed by the test ``db_engine`` running as the privileged superuser.
    """
    sm = async_sessionmaker(db_engine, expire_on_commit=False)
    async with sm() as session:
        _ = await session.execute(delete(AuditLog))
        await session.commit()


async def test_record_inserts_row(db_engine: AsyncEngine) -> None:
    """record() persists exactly one row visible to a follow-up SELECT."""
    sm = async_sessionmaker(db_engine, expire_on_commit=False)
    writer = AuditWriter(sm)

    await writer.record(
        action=AuditAction.LOGIN_SUCCESS,
        actor_user_id=None,
        context={"path": "/api/login"},
        ip="127.0.0.1",
        user_agent="pytest",
    )

    async with sm() as session:
        result = await session.execute(
            select(AuditLog).where(AuditLog.action == AuditAction.LOGIN_SUCCESS)
        )
        row = result.scalar_one()
    assert row.context == {"path": "/api/login"}
    assert row.ip == "127.0.0.1"
    assert row.user_agent == "pytest"


async def test_record_redacts_secret_in_context(db_engine: AsyncEngine) -> None:
    """A Secret nested in context is replaced with the literal '<Secret>' marker."""
    sm = async_sessionmaker(db_engine, expire_on_commit=False)
    writer = AuditWriter(sm)

    await writer.record(
        action=AuditAction.PASSWORD_CHANGED,
        actor_user_id=None,
        context={
            "field": "password",
            "value": Secret("hunter2"),
            "nested": {"token": Secret(b"\xde\xad")},
        },
        ip=None,
        user_agent=None,
    )

    async with sm() as session:
        result = await session.execute(
            select(AuditLog).where(AuditLog.action == AuditAction.PASSWORD_CHANGED)
        )
        row = result.scalar_one()
    assert row.context == {
        "field": "password",
        "value": "<Secret>",
        "nested": {"token": "<Secret>"},
    }


async def test_record_captures_correlation_id(db_engine: AsyncEngine) -> None:
    """structlog contextvars ``request_id`` ends up in the row's correlation_id column."""
    sm = async_sessionmaker(db_engine, expire_on_commit=False)
    writer = AuditWriter(sm)

    request_id = uuid.uuid4()
    _ = structlog.contextvars.bind_contextvars(request_id=str(request_id))

    await writer.record(
        action=AuditAction.SESSION_REVOKED,
        actor_user_id=None,
        context={},
        ip=None,
        user_agent=None,
    )

    async with sm() as session:
        result = await session.execute(
            select(AuditLog).where(AuditLog.action == AuditAction.SESSION_REVOKED)
        )
        row = result.scalar_one()
    assert row.correlation_id == request_id


async def test_app_role_cannot_update_or_delete(db_engine: AsyncEngine) -> None:
    """End-to-end gate: even after a writer-driven INSERT the app role cannot mutate."""
    sm = async_sessionmaker(db_engine, expire_on_commit=False)
    writer = AuditWriter(sm)
    await writer.record(
        action=AuditAction.LOGIN_FAILED,
        actor_user_id=None,
        context={"reason": "bad_password"},
        ip=None,
        user_agent=None,
    )

    async with db_engine.connect() as conn:
        async with conn.begin():
            _ = await conn.execute(text('SET LOCAL ROLE "comradarr_app"'))
            with pytest.raises(ProgrammingError):
                _ = await conn.execute(
                    text("UPDATE audit_log SET context = '{}'::jsonb"),
                )
        async with conn.begin():
            _ = await conn.execute(text('SET LOCAL ROLE "comradarr_app"'))
            with pytest.raises(ProgrammingError):
                _ = await conn.execute(text("DELETE FROM audit_log"))
