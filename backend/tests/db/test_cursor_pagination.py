"""Cursor encode/decode roundtrip (plan §3 Milestone 10 step 50).

The pagination contract is the keyset cursor must survive a base64url
round-trip without losing precision or aliasing different cursors to the
same token. We assert the equivalent property for the four ``sort_value``
shapes the runtime emits — string, int, datetime ISO, ``None`` — and
check that a tampered token raises a structured decode error rather than
silently producing junk.

``hypothesis`` is not in the dev dependency group, so the property-based
form documented in plan §3 Milestone 10 step 50 ships as a hand-rolled
table of representative values; the invariant we are guarding (encode then
decode is the identity) is tight enough that a small but well-chosen
table covers it. If the dev group later adds hypothesis, this file is the
first place to reach for ``@given``.
"""

import uuid

import msgspec
import pytest

from comradarr.repositories._pagination import Cursor, decode, encode

_FIXED_UUIDS: tuple[uuid.UUID, ...] = (
    uuid.UUID("00000000-0000-7000-8000-000000000000"),
    uuid.UUID("0190d8e4-0e30-7e3b-9c8c-1f7df7d9aa11"),
    uuid.UUID("ffffffff-ffff-7fff-bfff-ffffffffffff"),
)


@pytest.mark.parametrize(
    ("sort_value", "row_id"),
    [
        ("alpha", _FIXED_UUIDS[0]),
        ("", _FIXED_UUIDS[0]),
        ("a string with / + = and unicode ☃", _FIXED_UUIDS[1]),
        (0, _FIXED_UUIDS[0]),
        (1_000_000, _FIXED_UUIDS[1]),
        (-42, _FIXED_UUIDS[2]),
        ("2026-04-26T13:00:00+00:00", _FIXED_UUIDS[1]),
        (None, _FIXED_UUIDS[2]),
    ],
)
def test_cursor_encode_decode_roundtrip(sort_value: object, row_id: uuid.UUID) -> None:
    """``decode(encode(c)) == c`` for representative ``(sort_value, id)`` pairs."""
    original = Cursor(sort_value=sort_value, id=row_id)
    token = encode(original)
    restored = decode(token)
    assert restored == original, (
        f"cursor round-trip mismatch: original={original} token={token!r} restored={restored}"
    )


def test_encoded_token_is_url_safe_ascii() -> None:
    """The encoded token uses only base64url-safe characters (no '+', '/', '=')."""
    cursor = Cursor(sort_value="alpha", id=_FIXED_UUIDS[0])
    token = encode(cursor)
    forbidden = set("+/=")
    assert not (set(token) & forbidden), (
        f"encoded token {token!r} contains non-url-safe chars from {forbidden}"
    )


def test_tampered_token_raises_decode_error() -> None:
    """A token whose body is corrupted raises a structured msgspec error."""
    cursor = Cursor(sort_value="alpha", id=_FIXED_UUIDS[0])
    token = encode(cursor)
    # Flip the middle byte's case to invalidate the JSON inside.
    tampered = token[:-4] + "ZZZZ"
    with pytest.raises((msgspec.DecodeError, msgspec.ValidationError, ValueError)):
        _ = decode(tampered)
