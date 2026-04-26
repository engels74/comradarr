"""``users`` table — local + provisioned account rows (PRD §8 / Appendix B).

Phase 4 owns the runtime auth machinery; Phase 2 ships only the schema. The
``password_hash`` column carries an explicit non-hashable sentinel for
trusted-header / OIDC accounts (see PRD §15) so local password authentication
is structurally impossible against those rows even if local login is enabled.

The role is persisted as a PG-native ENUM (``user_role``) because column
distinct-cardinality is bounded and small, and Phase 4's role-based access
checks read this column on every authenticated request — the ENUM keeps
storage compact and lets the authorization layer rely on a typed value.
"""

import uuid  # noqa: TC003 — SQLAlchemy resolves `Mapped[uuid.UUID]` at runtime
from datetime import datetime  # noqa: TC003 — SQLAlchemy resolves `Mapped[datetime]` at runtime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from comradarr.db.base import Base, uuid_v7_pk_default
from comradarr.db.enums import ProvisioningProvider, UserRole


class User(Base):
    """A user account — local password, trusted-header, or OIDC provisioned."""

    __tablename__: str = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        default=uuid_v7_pk_default,
    )
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(UserRole, native_enum=True, name="user_role"),
        nullable=False,
        default=UserRole.VIEWER,
    )
    # Non-local accounts carry a sentinel here (see PRD §15); the column stays
    # nullable so trusted-header / OIDC rows can omit it entirely until the
    # Phase 4 provisioning code lands.
    password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    provisioning_provider: Mapped[ProvisioningProvider] = mapped_column(
        SAEnum(ProvisioningProvider, native_enum=True, name="provisioning_provider"),
        nullable=False,
        default=ProvisioningProvider.LOCAL,
    )
    created_at: Mapped[datetime] = mapped_column(nullable=False)
    updated_at: Mapped[datetime] = mapped_column(nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(nullable=True)
