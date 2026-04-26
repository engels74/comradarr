"""Background vacuum that DELETEs audit rows past the retention horizon (Phase 3).

:class:`AuditRetentionVacuum` is the only code in the project that issues
``DELETE FROM audit_log``. It runs under the ``comradarr_audit_admin`` role
(GRANT matrix permits SELECT, DELETE on ``audit_log``; INSERT is forbidden,
so the writer and the vacuum cannot be confused at the database boundary).

The vacuum supports three runtime states, exported as
:data:`AuditRetentionVacuumHealth`:

* ``"running"`` — horizon is set, the loop iterates and deletes expired rows.
* ``"skipped_indefinite"`` — horizon is :data:`None`; the loop emits the
  ``audit.retention.skipped`` event once per tick and never DELETEs.
* ``"crashed"`` — assigned by the lifespan task done-callback when
  :meth:`run` raises a non-:class:`asyncio.CancelledError` exception. The
  exception is also re-raised into the lifespan task so the app boot fails
  loudly rather than silently losing the vacuum.
"""

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal, NoReturn, cast, final

import structlog
from sqlalchemy import CursorResult, delete

from comradarr.db.models.audit_log import AuditLog

if TYPE_CHECKING:
    from datetime import timedelta

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


AuditRetentionVacuumHealth = Literal["running", "crashed", "skipped_indefinite"]

_logger = structlog.stdlib.get_logger(__name__)


@final
class AuditRetentionVacuum:
    """Long-lived loop that prunes audit rows older than ``now - horizon``."""

    __slots__: tuple[str, ...] = ("_horizon", "_interval", "_sessionmaker")

    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        *,
        horizon: timedelta | None,
        interval: int,
    ) -> None:
        self._sessionmaker = sessionmaker
        self._horizon = horizon
        self._interval = interval

    async def run_once(self) -> int:
        """Single retention pass; returns the number of rows deleted.

        ``horizon=None`` is the "retain forever" mode — emits a structured
        ``audit.retention.skipped`` event and returns ``0`` without issuing
        a DELETE. Callers that want the loop form should use :meth:`run`.
        """
        if self._horizon is None:
            _logger.info("audit.retention.skipped", reason="horizon_none")
            return 0

        cutoff = datetime.now(UTC) - self._horizon
        async with self._sessionmaker() as session:
            result = await session.execute(delete(AuditLog).where(AuditLog.timestamp < cutoff))
            await session.commit()
        # ``session.execute(delete(...))`` returns a CursorResult at runtime; the
        # generic Result[Any] type stub does not expose ``rowcount``, hence cast.
        deleted = cast("CursorResult[object]", result).rowcount or 0
        _logger.info(
            "audit.retention.swept",
            deleted=deleted,
            cutoff=cutoff.isoformat(),
        )
        return deleted

    async def run(self) -> NoReturn:
        """Forever-loop ``run_once`` then ``asyncio.sleep(interval)``.

        Raises only :class:`asyncio.CancelledError` (lifespan teardown);
        every other exception propagates so the lifespan done-callback can
        flip ``app.state.audit_retention_vacuum_health`` to ``"crashed"``.
        """
        while True:
            _ = await self.run_once()
            await asyncio.sleep(self._interval)
