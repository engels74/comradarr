"""``role_permissions`` table — role-to-permission mapping (PRD §26).

In v1 this table contains only the admin role's entries (which cover every
defined permission). Post-v1 additions (operator, viewer, custom roles) are
inserts into this table, not schema changes — see PRD §26.

Composite PK ``(role_name, permission_name)`` keeps each grant unique without
an extra index.
"""

from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base


class RolePermission(Base):
    """A grant of one permission to one role (PRD §26)."""

    __tablename__: str = "role_permissions"

    role_name: Mapped[str] = mapped_column(String, primary_key=True)
    permission_name: Mapped[str] = mapped_column(String, primary_key=True)
    granted_at: Mapped[datetime] = mapped_column(nullable=False)
