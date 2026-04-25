"""Declarative base for every ORM model (PATTERN-MODEL).

* :class:`Base` is the SQLAlchemy 2.x declarative base. ``AsyncAttrs`` is mixed
  in so async-attribute access (``await obj.awaitable_attrs.relationship``)
  works on lazy-loaded relationships out of the box.
* :attr:`Base.type_annotation_map` makes ``datetime`` columns timezone-aware by
  default — the project never stores naïve datetimes.
* :func:`uuid_v7_pk_default` is the canonical primary-key default for every
  table that uses UUID surrogate keys (RULE-DB-005). UUIDv7 keys are
  monotonic, k-sortable, and avoid the index-fragmentation problem v4 keys
  cause on append-heavy tables.

Phase 2 lands the first concrete model under ``comradarr.db.models``.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase


class Base(AsyncAttrs, DeclarativeBase):
    """Project-wide declarative base. Models inherit from this."""

    type_annotation_map: dict[type, object] = {  # noqa: RUF012  # SQLA convention
        datetime: DateTime(timezone=True),
    }


def uuid_v7_pk_default() -> uuid.UUID:
    """Return a UUIDv7 — RULE-DB-005 surrogate-key default."""
    return uuid.uuid7()
