"""Generic repository base (plan §3 Milestone 9 step 35).

The base class only owns the ``AsyncSession`` reference; every concrete
repository is responsible for its own model-specific queries. Keeping the
base intentionally small avoids the trap of cramming reusable-but-rarely-used
helpers into a god class — concrete repositories compose plain ``select()``
statements per :ref:`PATTERN-QUERY` and let SQLAlchemy 2.0 do the heavy
lifting.

Subclasses override or add domain-specific methods. The session is **not**
owned by the repository: callers (Litestar handlers, Phase 4 auth code, etc.)
are responsible for transaction boundaries.
"""

from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 — runtime DI: Litestar resolves AsyncSession at request time
)


class BaseRepository:
    """Carry an ``AsyncSession`` for a domain repository to operate on."""

    session: AsyncSession

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
