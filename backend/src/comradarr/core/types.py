"""Type-aware secret wrapper + structured-data redaction (plan §5.3.1).

`Secret[T]` is a thin wrapper that hides the underlying value from every
implicit string/bytes path (repr, str, hash, bytes, eq) so the only way to
extract it is via `.expose()` -- which is grep-able and reviewer-visible.
The basedpyright Secret-misuse fixture (Phase 3 §5.3.6) closes the static
gate; `__bytes__` raising TypeError is the runtime defense-in-depth twin.

`secret_msgspec_encoder` is the msgspec `enc_hook` that maps Secret instances
to `{"__redacted__": True}` during JSON serialization. Litestar's msgspec
config wires it in Phase 3 §5.3.4 so any DTO carrying a Secret field
serializes as the marker dict instead of leaking via field repr.

`redact_secrets` is the type-driven recursive walker that maps Secret values
to the literal string `"<Secret>"` while preserving structure for Mapping,
Sequence (excluding str/bytes/bytearray), and msgspec.Struct containers. It
is the SINGLE SOURCE OF TRUTH that the structlog Secret-aware processor
(§5.3.3) and the AuditWriter context redaction (§5.3.5) both delegate to;
keeping the walker centralized prevents drift between the two surfaces.
"""

from collections.abc import Mapping, Sequence
from typing import NoReturn, cast, final, override

import msgspec


@final
class Secret[T]:
    """Wrapper that prevents implicit leakage of the underlying value.

    Instances are never equal (``__eq__`` returns ``NotImplemented`` so the
    interpreter falls back to identity, and identity-on-distinct-objects is
    ``False``), unhashable (``__hash__`` raises ``TypeError`` so a Secret
    cannot be a dict key or set member), and refuse implicit ``bytes()``
    coercion.

    The only sanctioned extraction path is :meth:`expose`, which is grepable
    so a code review can find every site that touches the underlying value.
    """

    __slots__: tuple[str, ...] = ("_value",)

    def __init__(self, value: T) -> None:
        self._value: T = value

    def expose(self) -> T:
        """Return the wrapped value. Every call site is auditable via grep."""
        return self._value

    @override
    def __repr__(self) -> str:
        return "<Secret>"

    @override
    def __str__(self) -> str:
        return "<Secret>"

    @override
    def __eq__(self, other: object) -> bool:
        # Returning NotImplemented signals "I don't know how to compare" -- the
        # interpreter then falls back to identity comparison, which yields False
        # for distinct Secret instances and for Secret-vs-plain comparisons.
        return NotImplemented

    @override
    def __hash__(self) -> NoReturn:
        raise TypeError("Secret[T] is intentionally unhashable")

    def __bytes__(self) -> NoReturn:
        # Defense-in-depth: even if a caller bypasses the basedpyright gate
        # (cast, Any laundering), bytes(secret) still fails closed at runtime.
        raise TypeError("Secret[T] does not implement __bytes__; call .expose()")


def secret_msgspec_encoder(obj: object) -> dict[str, bool]:
    """msgspec `enc_hook` that maps Secret payloads to a redaction marker.

    Use ``isinstance(obj, Secret)`` -- never ``type(obj) is Secret`` -- so a
    hypothetical subclass continues to redact instead of accidentally falling
    through to the unsupported branch.
    """
    if isinstance(obj, Secret):
        return {"__redacted__": True}
    raise NotImplementedError(f"secret_msgspec_encoder: cannot encode {type(obj).__name__}")


def redact_secrets(value: object, *, _seen: set[int] | None = None) -> object:
    """Recursively redact every Secret[T] in `value`; preserve container shape.

    Descends Mapping, Sequence (excluding str/bytes/bytearray), and
    msgspec.Struct. The per-call ``_seen`` set carries object ids of in-flight
    containers so a self-referencing structure doesn't recurse forever; once
    a container exits the recursion its id is removed so sibling subtrees
    are still walked.

    The output is *structure-preserving*:

    * dict -> dict with redacted values
    * list -> list with redacted elements
    * tuple -> tuple with redacted elements (type preserved)
    * msgspec.Struct -> dict (shape is JSON-serializable; the audit writer
      and structlog renderer both expect dict containers downstream)

    Any value that is none of the above is returned unchanged.
    """
    if _seen is None:
        _seen = set()

    if isinstance(value, Secret):
        return "<Secret>"

    # Strings and bytes ARE Sequences -- but descending into them would
    # tear them apart character-by-character. Bail before the Sequence check.
    if isinstance(value, str | bytes | bytearray):
        return value

    obj_id = id(value)
    if obj_id in _seen:
        # Cycle break: return the original object so the caller observes the
        # back-edge as identity-equal to its predecessor.
        return value

    if isinstance(value, Mapping):
        mapping = cast("Mapping[object, object]", value)
        _seen.add(obj_id)
        try:
            return {k: redact_secrets(v, _seen=_seen) for k, v in mapping.items()}
        finally:
            _seen.discard(obj_id)

    if isinstance(value, Sequence):
        _seen.add(obj_id)
        try:
            redacted = [redact_secrets(item, _seen=_seen) for item in value]
            if isinstance(value, tuple):
                return tuple(redacted)
            return redacted
        finally:
            _seen.discard(obj_id)

    if isinstance(value, msgspec.Struct):
        _seen.add(obj_id)
        try:
            return {
                field.name: redact_secrets(cast("object", getattr(value, field.name)), _seen=_seen)
                for field in msgspec.structs.fields(value)
            }
        finally:
            _seen.discard(obj_id)

    return value
