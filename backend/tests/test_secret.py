"""Unit coverage for Secret[T] + secret_msgspec_encoder + redact_secrets (§5.3.1)."""

import msgspec
import pytest

from comradarr.core.types import Secret, redact_secrets, secret_msgspec_encoder


def test_repr_redacts() -> None:
    s = Secret(b"super-sensitive-bytes")
    assert repr(s) == "<Secret>"


def test_str_redacts() -> None:
    s = Secret("super-sensitive-string")
    assert str(s) == "<Secret>"


def test_eq_returns_notimplemented() -> None:
    # __eq__ returning NotImplemented falls through to identity comparison,
    # which is False for distinct instances and for Secret-vs-plain.
    assert (Secret("a") == Secret("a")) is False
    assert (Secret("a") == "a") is False
    # Self-identity still holds because it is checked before __eq__ runs.
    s = Secret("a")
    assert s == s  # noqa: PLR0124 — identity is the deliberate check


def test_hash_forbidden() -> None:
    with pytest.raises(TypeError, match="unhashable"):
        _ = hash(Secret("a"))


def test_bytes_forbidden() -> None:
    with pytest.raises(TypeError, match="__bytes__"):
        _ = bytes(Secret(b"\x00\x01\x02"))


def test_msgspec_encoder_redacts() -> None:
    encoded = msgspec.json.encode(Secret(b"k"), enc_hook=secret_msgspec_encoder)
    assert encoded == b'{"__redacted__":true}'


def test_msgspec_encoder_rejects_non_secret() -> None:
    class Other:
        pass

    with pytest.raises(NotImplementedError, match="Other"):
        _ = secret_msgspec_encoder(Other())


def test_expose_returns_value() -> None:
    s = Secret(b"raw-bytes")
    assert s.expose() == b"raw-bytes"
    s2 = Secret("raw-string")
    assert s2.expose() == "raw-string"


def test_redact_secrets_descends_dict_list_struct_with_cycle_guard() -> None:
    # dict descent
    assert redact_secrets({"k": Secret(b"v"), "n": 1}) == {"k": "<Secret>", "n": 1}

    # list descent (and nested dict)
    assert redact_secrets([Secret(b"v"), 1, {"x": Secret("y")}]) == [
        "<Secret>",
        1,
        {"x": "<Secret>"},
    ]

    # tuple descent — type preserved
    result = redact_secrets((Secret(b"v"), 1))
    assert result == ("<Secret>", 1)
    assert isinstance(result, tuple)

    # msgspec.Struct descent → dict
    class Foo(msgspec.Struct, frozen=True, kw_only=True):
        s: Secret[str]
        n: int

    foo = Foo(s=Secret("v"), n=42)
    assert redact_secrets(foo) == {"s": "<Secret>", "n": 42}

    # str / bytes / bytearray are NOT descended into characters
    assert redact_secrets("plain-string") == "plain-string"
    assert redact_secrets(b"\x00\x01") == b"\x00\x01"
    assert redact_secrets(bytearray(b"\x00\x01")) == bytearray(b"\x00\x01")

    # Self-referencing list — must terminate
    lst: list[object] = []
    lst.append(lst)
    walked = redact_secrets(lst)
    assert isinstance(walked, list)

    # Self-referencing dict — must terminate
    d: dict[str, object] = {"k": None}
    d["k"] = d
    walked_d = redact_secrets(d)
    assert isinstance(walked_d, dict)


def test_redact_secrets_passthrough_for_scalars() -> None:
    assert redact_secrets(42) == 42
    assert redact_secrets(3.14) == 3.14
    assert redact_secrets(True) is True
    assert redact_secrets(None) is None
