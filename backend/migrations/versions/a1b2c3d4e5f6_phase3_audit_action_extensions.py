"""phase3 audit_action enum extensions.

Adds the 14 Phase 3 audit codes to the Postgres ``audit_action`` ENUM. The
v1 baseline (``361c239a829d``) created the type with the original 30 dotted
codes; Phase 3 extends it additively for the bootstrap / setup-claim /
login-lifecycle / manual-trigger / snapshot lifecycle events documented in
``comradarr.db.enums.AuditAction`` (Python source of truth).

Revision ID: a1b2c3d4e5f6
Revises: 361c239a829d
Create Date: 2026-04-26 14:30:00.000000

Why this revision is special
----------------------------

PostgreSQL 12+ permits ``ALTER TYPE ... ADD VALUE`` inside a transaction
block on the strict condition that the new value is **not used in the same
transaction**. This migration only declares the new enum members — every
column referencing the type is unchanged — so the values are added but not
referenced before the runner commits. That keeps the body compatible with
the runner's pinned ``transactional_ddl=True`` (ANTI-137 advisory-lock scope).

``IF NOT EXISTS`` makes the migration idempotent against a re-run after
partial application (e.g. operator re-running ``alembic upgrade head`` on a
database where some values already landed). The Python ``AuditAction`` enum
is the source of truth — the lifespan boot probe (``core.lifespan``)
re-validates the PG enum against it before emitting ``lifespan.db.ready``.

Downgrade
---------

Postgres has no ``ALTER TYPE ... DROP VALUE``. Removing an enum value would
require a full type-rebuild (``CREATE TYPE`` shadow + table column
``USING`` cast + ``DROP TYPE``), which is a destructive operation we do not
want to bake into reversible Alembic history. The ``downgrade()`` is an
intentional no-op; rolling back the Python enum reference is sufficient
for application-side compatibility, and the unused PG-side values are
harmless.

RULE-MIGR-001 attestation: this file does NOT use ``op.batch_alter_table``.
RULE-LOG-001 attestation: this file emits NO log lines.
"""

from typing import TYPE_CHECKING

from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "361c239a829d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Phase 3 §5.3.3 step 12 — additive enum members. Order is illustrative; the
# PG enum stores values without ordering semantics so the literal-text body
# is the contract, not the sort order.
_PHASE3_AUDIT_ACTION_VALUES: tuple[str, ...] = (
    "bootstrap_token.generated",
    "setup_claim.granted",
    "setup_claim.rejected",
    "admin_account.created",
    "setup.completed",
    "login.success",
    "login.failed",
    "password.changed",
    "api_key.first_used",
    "http_boundary.changed",
    "manual_search.triggered",
    "manual_sync.triggered",
    "snapshot.exported",
    "snapshot.imported",
)


def upgrade() -> None:
    """Add each Phase 3 audit code to the ``audit_action`` ENUM, idempotently."""
    # PG 12+ accepts ``ALTER TYPE ADD VALUE`` inside a transaction so long as
    # the new value is not used in the same transaction. This migration only
    # declares the values — no INSERT/UPDATE references them — so we stay
    # compatible with the runner's pinned ``transactional_ddl=True`` without
    # needing ``autocommit_block`` (which fights the outer advisory-lock
    # transaction; see runner notes in ``comradarr.db.migrations``).
    for value in _PHASE3_AUDIT_ACTION_VALUES:
        # Server-rendered literal: values are checked-in module constants
        # (NOT user input), so f-string interpolation is safe. No bind
        # parameters because PG's ALTER TYPE parser does not accept them in
        # the value slot.
        op.execute(f"ALTER TYPE audit_action ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    """Documented no-op — Postgres does not support ``ALTER TYPE DROP VALUE``."""
    # Intentional: see module docstring "Downgrade" section. Removing an
    # enum value safely would require a full type-rebuild, which we refuse
    # to bake into reversible history. Operators rolling back this revision
    # leave the new PG values in place; the matching Python reference rolls
    # back via the ``AuditAction`` enum source on the application side.
