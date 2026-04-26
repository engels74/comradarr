"""``api_key_scopes`` table — per-API-key permission subsets (PRD §26).

Constrains what an API key can do relative to the owning user's permissions.
A key with no rows here inherits the full permission set of its owner's role.
A scope cannot grant permissions the owning user's current role does not
hold, so a role demotion automatically shrinks every key the user created
(enforcement lives in Phase 4's permission middleware).

Composite PK ``(api_key_id, permission_name)`` keeps each scope row unique
without an extra index. ``ON DELETE CASCADE`` on ``api_key_id`` ensures
revoking a key wipes its scope rows in the same transaction.
"""

import uuid  # noqa: TC003 — SQLAlchemy resolves `Mapped[uuid.UUID]` at runtime

from sqlalchemy import ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base


class ApiKeyScope(Base):
    """A single permission grant on one API key (PRD §26)."""

    __tablename__: str = "api_key_scopes"

    api_key_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("api_keys.id", ondelete="CASCADE"),
        primary_key=True,
    )
    permission_name: Mapped[str] = mapped_column(String, primary_key=True)
