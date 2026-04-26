"""Cursor-based keyset pagination helper (plan §3 Milestone 9 step 36).

Comradarr's list endpoints page by ``(sort_value, id)`` keysets — never by
``OFFSET`` — because OFFSET pagination on append-heavy tables (mirror_*,
audit_log) degrades linearly and skips rows when concurrent writes happen
between page fetches. The keyset shape ``(sort_value, id)`` is stable under
inserts and gives O(log n) lookups via the index.

The cursor token shipped to clients is a base64url-encoded msgspec JSON blob
of the :class:`Cursor` struct. ``msgspec.json`` keeps encode/decode allocation
flat, and ``frozen=True`` lets us treat cursors as hash-stable values.

``object`` is used for ``sort_value`` because the sort column type varies
(``datetime``, ``str``, ``int``); RULE-PY-003 forbids ``Any`` and DECIDE-TYPING
in rules.md pins ``object`` as the project-approved alternative for
serialization-shaped values.
"""

import base64
import uuid  # noqa: TC003 — msgspec resolves the annotation at runtime

import msgspec
from sqlalchemy import ColumnElement, Select, tuple_

from comradarr.db.base import (
    Base,  # noqa: TC001 — runtime use: model.__mapper__ is read inside apply()
)


class Cursor(msgspec.Struct, frozen=True, kw_only=True):
    """Keyset cursor — sort-column value paired with the row's UUIDv7 id."""

    sort_value: object
    id: uuid.UUID


def encode(cursor: Cursor) -> str:
    """Encode a cursor as an unpadded base64url-safe ASCII token."""
    return base64.urlsafe_b64encode(msgspec.json.encode(cursor)).decode("ascii").rstrip("=")


def decode(token: str) -> Cursor:
    """Decode a cursor token; pads back to a multiple of 4 before b64 decode."""
    return msgspec.json.decode(
        base64.urlsafe_b64decode(token + "==="),
        type=Cursor,
    )


def apply(
    stmt: Select[tuple[Base]],
    model: type[Base],
    sort_column: ColumnElement[object],
    cursor: Cursor | None,
    *,
    limit: int,
) -> Select[tuple[Base]]:
    """Return ``stmt`` extended with the keyset predicate, ORDER BY, and LIMIT.

    The result LIMITs to ``limit + 1`` so the caller can detect a "has next
    page" boundary by inspecting whether the extra row was returned, then
    drop it before returning rows to the consumer. Ordering is
    ``(sort_column, model.id)`` so the cursor tuple maps 1:1 to the index
    used by Postgres for the keyset scan.
    """
    id_column = model.__mapper__.primary_key[0]
    if cursor is not None:
        stmt = stmt.where(
            tuple_(sort_column, id_column) > (cursor.sort_value, cursor.id),
        )
    return stmt.order_by(sort_column, id_column).limit(limit + 1)
