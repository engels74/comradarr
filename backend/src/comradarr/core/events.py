"""Typed event-name enum — cross-stack SSE / event-bus contract.

Phase 11 enumerates this per PRD §13 / §20 — it owns the event bus + the
cross-stack SSE contract the frontend keys off. Committing real members in
Phase 1 would force Phase 11 to land breaking-change semantics for any
rename, so Phase 1 ships a single placeholder so the file/import surface is
real and reviewers see the slot.
"""

from enum import StrEnum


class EventName(StrEnum):
    """Canonical event-name surface. Phase 11 fills with real members.

    Modelled as :class:`enum.StrEnum` (Python 3.11+ canonical replacement for
    the legacy ``class Foo(str, Enum)`` idiom — ruff UP042). Members are
    plain ``str`` values for cross-stack SSE compatibility.
    """

    # Phase 11: enumerate per PRD §13 / §20 — owns the event bus + cross-stack SSE contract.
    _PLACEHOLDER = "__placeholder__"
