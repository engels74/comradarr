"""phase3 flip ``comradarr_audit_admin`` from NOLOGIN to LOGIN.

The v1 baseline (``361c239a829d`` line 627–629) created
``comradarr_audit_admin`` ``NOLOGIN`` because Phase 2 only needed it as a
GRANT target — the role existed to own the SELECT/DELETE privileges on
``audit_log`` while the application connection (``comradarr_app``) carried
the INSERT carve-out.

Phase 3 adds an actual *connection* under that role so the retention
vacuum (:class:`comradarr.services.audit.vacuum.AuditRetentionVacuum`) can
issue DELETEs against ``audit_log`` without ever sharing a session with
the writer (which runs under ``comradarr_app``). For that we need LOGIN +
a password. This revision flips the role in place rather than dropping &
recreating it — the GRANT matrix (the actual security gate) is unchanged.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-04-26 14:35:00.000000

Operator contract
-----------------

The password is read from the ``COMRADARR_AUDIT_ADMIN_PASSWORD``
environment variable AT MIGRATION TIME and passed through SQLAlchemy's
``text()`` parameter binding. It is NEVER inlined into the rendered SQL
or Alembic history — both because that would leak the credential into
``alembic_version`` table dumps / log streams, and because the v1 plan
explicitly forbids passwords in revision files.

Required envelope:

* ``COMRADARR_AUDIT_ADMIN_PASSWORD`` — required, ≥32 characters. The
  application-side validator (:mod:`comradarr.config`) enforces the
  length gate at boot; this migration trusts it but re-checks the
  non-empty invariant defensively (a bad ENV would otherwise issue
  ``ALTER ROLE ... PASSWORD ''`` which is a footgun).

Downgrade
---------

Restore ``NOLOGIN`` (leave the password set — clearing it requires a
separate ``ALTER ROLE ... PASSWORD NULL`` and the role is unusable
either way once LOGIN is removed). Documented behavior: a downgrade is
the on-call's break-glass path when the audit-admin engine misbehaves;
the writer/vacuum split degrades to a single-engine deployment until
the next upgrade cycle.

RULE-MIGR-001 attestation: this file does NOT use ``op.batch_alter_table``.
RULE-LOG-001 attestation: this file emits NO log lines and explicitly
suppresses the rendered-SQL echo of the ALTER ROLE statement so the
password never lands in alembic-runner output.
"""

import logging
import os
from typing import TYPE_CHECKING

from alembic import op
from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_PASSWORD_ENV_VAR: str = "COMRADARR_AUDIT_ADMIN_PASSWORD"  # noqa: S105 — env var name, not a credential
_MIN_PASSWORD_LEN: int = 32


def _read_password() -> str:
    """Read + validate the audit-admin password from the environment.

    Phase 3 §5.3 / Iter 1 Amendment 1: the password is operator-supplied,
    required at migration time, and must clear the same length gate the
    application loader enforces (32 chars). Mismatch raises ``RuntimeError``
    so the migration aborts before any DDL is issued.
    """
    raw = os.environ.get(_PASSWORD_ENV_VAR)
    if not raw:
        raise RuntimeError(
            f"{_PASSWORD_ENV_VAR} is required to upgrade past phase3 audit-admin "
            f"login revision; see docs/runbook/postgres-roles.md"
        )
    if len(raw) < _MIN_PASSWORD_LEN:
        raise RuntimeError(
            f"{_PASSWORD_ENV_VAR} must be at least {_MIN_PASSWORD_LEN} characters; "
            f"see docs/runbook/postgres-roles.md"
        )
    return raw


def _escape_sql_literal(value: str) -> str:
    """Escape a single-quoted Postgres SQL literal by doubling embedded ``'``.

    Postgres' DDL parser consumes the password at statement-prepare time —
    bind parameters in the ``PASSWORD`` slot of ``ALTER ROLE`` are rejected
    on most drivers (asyncpg + psycopg both refuse). The plan's executor
    note (Iter 1 Critic ship-it) authorizes literal injection guarded by
    SQL-quote escaping. Combined with the alembic-runner log suppression
    in :func:`upgrade`, the password remains out of every observable
    surface (history, logs, server-side error frames).
    """
    return value.replace("'", "''")


def upgrade() -> None:
    """Flip ``comradarr_audit_admin`` to ``LOGIN`` with the operator's password."""
    password = _read_password()

    # Suppress the alembic.runtime.migration logger for the duration of this
    # ALTER ROLE so the rendered SQL (which contains the password literal)
    # never lands in stdout/log files. Restored unconditionally in
    # ``finally:`` so a failure mid-statement still re-enables migration
    # logging for any subsequent revisions in the same upgrade batch.
    alembic_logger = logging.getLogger("alembic.runtime.migration")
    previous_level = alembic_logger.level
    alembic_logger.setLevel(logging.WARNING)
    try:
        # Escaped literal injection (see ``_escape_sql_literal`` for why
        # bind parameters cannot be used here). The escaping closes the
        # SQL-injection vector even though the password is operator-
        # controlled — defense in depth against operator typos.
        escaped = _escape_sql_literal(password)
        op.execute(
            text(f"ALTER ROLE comradarr_audit_admin WITH LOGIN PASSWORD '{escaped}'"),
        )
    finally:
        alembic_logger.setLevel(previous_level)


def downgrade() -> None:
    """Restore ``NOLOGIN``; leave the password set (LOGIN flag is the gate)."""
    op.execute(text("ALTER ROLE comradarr_audit_admin WITH NOLOGIN"))
