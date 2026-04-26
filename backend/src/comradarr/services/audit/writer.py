"""Append-only audit row writer (Phase 3 §5.3.3).

:class:`AuditWriter` is the **only** sanctioned way for application code to
add a row to ``audit_log``. Two invariants are enforced here so they cannot
drift across callers:

* **Type-aware secret redaction** — :func:`comradarr.core.types.redact_secrets`
  walks the ``context`` dict and replaces every :class:`Secret` payload with
  the literal ``"<Secret>"`` marker BEFORE the dict is JSONB-serialized. The
  same walker also feeds the structlog chain
  (:mod:`comradarr.core.logging`); centralizing the call here keeps the two
  surfaces in lock-step.
* **Correlation id propagation** — the writer reads ``request_id`` from
  structlog contextvars (bound by
  :func:`comradarr.api.middleware.correlation.correlation_id_middleware`) and
  stores it as the row's ``correlation_id`` column so a later operator can
  ``JOIN`` audit trails to the structured log stream they came from.

The class runs under the ``comradarr_app`` role; its INSERT-only privilege
on ``audit_log`` is the schema-level part of the carve-out (UPDATE + DELETE
are owned by ``comradarr_audit_admin`` — see
:class:`comradarr.services.audit.vacuum.AuditRetentionVacuum`).
"""

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast, final

import structlog
from sqlalchemy import insert

from comradarr.core.types import redact_secrets
from comradarr.db.models.audit_log import AuditLog

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from comradarr.db.enums import AuditAction


_logger = structlog.stdlib.get_logger(__name__)


@final
class AuditWriter:
    """Async writer for ``audit_log`` rows. Holds a sessionmaker only — stateless."""

    __slots__: tuple[str, ...] = ("_sessionmaker",)

    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession]) -> None:
        self._sessionmaker = sessionmaker

    async def record(
        self,
        *,
        action: AuditAction,
        actor_user_id: uuid.UUID | None,
        context: dict[str, object],
        ip: str | None,
        user_agent: str | None,
    ) -> None:
        """Insert a single row, redacting :class:`Secret` payloads in ``context``."""
        # ``redact_secrets`` returns a fresh dict; the caller's mapping is
        # never mutated. ``cast`` is the only type-aware way to assert the
        # walker's return shape stays a dict (it can return list/tuple/dict
        # depending on the input type).
        redacted = cast("dict[str, object]", redact_secrets(context))

        bound = structlog.contextvars.get_contextvars()
        correlation_id = _coerce_correlation_id(bound.get("request_id"))

        # ``timestamp`` is NOT NULL with no DB-side default, so the writer
        # mints it Python-side via ``datetime.now(UTC)``. RULE-DT-001
        # (timezone-aware UTC) is satisfied by the explicit tzinfo argument.
        async with self._sessionmaker() as session:
            _ = await session.execute(
                insert(AuditLog).values(
                    timestamp=datetime.now(UTC),
                    action=action,
                    actor_user_id=actor_user_id,
                    context=redacted,
                    ip=ip,
                    user_agent=user_agent,
                    correlation_id=correlation_id,
                )
            )
            await session.commit()

        # Emit ONLY action + correlation_id; the audit row body is privileged
        # data and must not echo into the structured log stream.
        _logger.info(
            "audit.recorded",
            action=action.value,
            correlation_id=str(correlation_id) if correlation_id is not None else None,
        )


def _coerce_correlation_id(raw: object) -> uuid.UUID | None:
    """Best-effort UUID coercion; non-UUID context values yield ``None``."""
    if raw is None:
        return None
    if isinstance(raw, uuid.UUID):
        return raw
    if isinstance(raw, str):
        try:
            return uuid.UUID(raw)
        except ValueError:
            return None
    return None
