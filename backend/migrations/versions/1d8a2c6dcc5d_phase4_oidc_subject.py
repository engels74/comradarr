"""phase4 oidc_subject — add ``users.oidc_subject`` + partial unique index.

Adds a nullable ``oidc_subject`` column to ``users`` for OIDC linkage
(Slice G consumer).  A partial unique index enforces that no two OIDC-
provisioned rows share the same ``sub`` claim while allowing NULL for
local / trusted-header accounts.

Revision ID: 1d8a2c6dcc5d
Revises: b2c3d4e5f6a7
Create Date: 2026-04-26 18:00:00.000000

Partial index rationale
-----------------------

``CREATE UNIQUE INDEX ... WHERE provisioning_provider = 'oidc'`` lets
PostgreSQL enforce ``(oidc_subject, oidc_provider)``-uniqueness only for
OIDC rows without forcing every local/trusted-header row to carry a
non-NULL sentinel in the column.  A full unique index would require all
NULL-valued rows to be evaluated against one another — Postgres treats
NULL ≠ NULL, so that would actually work, but the explicit WHERE clause
makes the intent legible to operators and avoids a footgun if a future
migration changes the NULL semantics.

Downgrade
---------

Drops the partial unique index then drops the column.  No data is
migrated back (the column is new in this phase).

RULE-MIGR-001 attestation: this file does NOT use ``op.batch_alter_table``.
RULE-LOG-001 attestation: this file emits NO log lines.
"""

from typing import TYPE_CHECKING

import sqlalchemy as sa
from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "1d8a2c6dcc5d"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEX_NAME: str = "ix_users_oidc_subject_where_oidc"


def upgrade() -> None:
    """Add ``oidc_subject`` column + partial unique index on OIDC rows."""
    op.add_column("users", sa.Column("oidc_subject", sa.String(), nullable=True))
    op.create_index(
        _INDEX_NAME,
        "users",
        ["oidc_subject"],
        unique=True,
        postgresql_where=sa.text("provisioning_provider = 'oidc'"),
    )


def downgrade() -> None:
    """Drop partial unique index then drop ``oidc_subject`` column."""
    op.drop_index(_INDEX_NAME, table_name="users")
    op.drop_column("users", "oidc_subject")
