"""CryptoService + Argon2id helpers + EncryptedFieldCodec coverage (Phase 3 M4).

The eight tests below exercise every loud-fail seam the design depends on:

* Round-trip + AAD swap — proves AES-256-GCM is wired end-to-end and that the
  ``aad_for`` triple actually binds the ``(table, row_pk, column)`` to the
  ciphertext.
* Unknown key version — proves a registry trim that drops a still-referenced
  version surfaces as a typed exception rather than silent recryption.
* Nonce freshness — 1000 iterations under a single key with no collisions
  (probabilistic but tight enough to fail loudly on a fixed-nonce regression).
* Argon2id round-trip + needs_rehash + pinned PHC parameters — proves the
  module-scope :data:`_INTERACTIVE_PARAMS` is the single source of truth and
  that a parameter drift is detected.
* derive_snapshot_key NotImplementedError — proves the Phase 30 ownership
  marker raises rather than silently returning a default key.
"""

import re
from typing import TYPE_CHECKING, cast, final

import argon2
import pytest

from comradarr.core.crypto import (
    CryptoService,
    EncryptedBlob,
    derive_snapshot_key,
    hash_bootstrap_token,
    hash_password,
    needs_rehash,
    verify_bootstrap_token,
    verify_password,
)
from comradarr.core.types import Secret
from comradarr.db.encrypted import EncryptedFieldCodec
from comradarr.errors.crypto import (
    CryptoAuthenticationFailed,
    CryptoError,
    CryptoUnknownKeyVersion,
)

if TYPE_CHECKING:
    from comradarr.config import Settings


@final
class _StubKeyRegistry:
    """Minimal Settings-shaped object with just the two fields CryptoService reads.

    CryptoService.__init__ touches only ``secret_key_versions`` and
    ``current_key_version``. Building a full :class:`Settings` for a key-version
    test would force the registry through the runtime denylist + entropy
    validators, which would in turn reject the deterministic byte sequences
    the AAD-swap and unknown-key-version tests rely on.
    """

    __slots__: tuple[str, ...] = ("current_key_version", "secret_key_versions")

    secret_key_versions: dict[int, bytes]
    current_key_version: int

    def __init__(self, secret_key_versions: dict[int, bytes], current_key_version: int) -> None:
        self.secret_key_versions = secret_key_versions
        self.current_key_version = current_key_version


def _crypto_service(
    *,
    versions: dict[int, bytes] | None = None,
    current: int | None = None,
) -> CryptoService:
    """Build a :class:`CryptoService` from a deterministic two-version registry."""
    if versions is None:
        versions = {1: b"\x01" * 32, 2: b"\x02" * 32}
    if current is None:
        current = 1
    # Two-step cast through ``object`` because :class:`_StubKeyRegistry` is a
    # structural shim — it has no nominal relationship to :class:`Settings`,
    # and basedpyright would otherwise warn that the types do not overlap.
    stub = cast("object", _StubKeyRegistry(versions, current))
    return CryptoService(cast("Settings", stub))


# ---------------------------------------------------------------------------
# CryptoService — encrypt / decrypt / aad_for
# ---------------------------------------------------------------------------


def test_round_trip_with_aad() -> None:
    """``encrypt`` then ``decrypt`` under matching AAD recovers the plaintext."""
    crypto = _crypto_service()
    plaintext = b"my-very-secret-api-key-bytes"
    aad = crypto.aad_for("connectors", "row-a", "api_key")
    blob = crypto.encrypt(Secret(plaintext), aad)
    assert blob.key_version == 1
    assert len(blob.nonce) == 12  # 96-bit AES-GCM RFC 5116 nonce
    assert len(blob.tag) == 16  # 128-bit auth tag
    recovered = crypto.decrypt(blob, aad)
    assert recovered.expose() == plaintext


def test_decryption_fails_on_aad_swap() -> None:
    """A ciphertext encrypted under row-a's AAD must NOT decrypt under row-b's."""
    crypto = _crypto_service()
    aad_a = crypto.aad_for("connectors", "row-a", "api_key")
    aad_b = crypto.aad_for("connectors", "row-b", "api_key")
    blob = crypto.encrypt(Secret(b"plaintext"), aad_a)
    with pytest.raises(CryptoAuthenticationFailed):
        _ = crypto.decrypt(blob, aad_b)


def test_unknown_key_version_raises() -> None:
    """An :class:`EncryptedBlob` whose ``key_version`` is missing fails loud."""
    crypto = _crypto_service()
    blob = EncryptedBlob(
        nonce=b"\x00" * 12,
        ciphertext=b"\x00" * 16,
        tag=b"\x00" * 16,
        key_version=99,  # never registered
    )
    with pytest.raises(CryptoUnknownKeyVersion):
        _ = crypto.decrypt(blob, b"any-aad")


def test_nonce_freshness_1000_iterations() -> None:
    """1000 encrypts under a single key produce 1000 distinct nonces."""
    crypto = _crypto_service()
    aad = crypto.aad_for("connectors", "row-a", "api_key")
    nonces: set[bytes] = set()
    for _ in range(1000):
        blob = crypto.encrypt(Secret(b"x"), aad)
        nonces.add(blob.nonce)
    assert len(nonces) == 1000


def test_aad_for_is_canonical_utf8() -> None:
    """``aad_for`` produces the documented ``f'{table}:{row_pk}:{column}'`` shape."""
    aad = CryptoService.aad_for("connectors", "01J0…", "api_key")
    assert aad == "connectors:01J0…:api_key".encode()


# ---------------------------------------------------------------------------
# Argon2id helpers — _INTERACTIVE_PARAMS shared across every entrypoint
# ---------------------------------------------------------------------------


def test_argon2_round_trip() -> None:
    """``hash_password`` then ``verify_password`` returns ``True`` on match."""
    candidate = Secret("correct horse battery staple")
    stored = hash_password(candidate)
    assert verify_password(stored, Secret("correct horse battery staple")) is True
    assert verify_password(stored, Secret("wrong password")) is False


def test_argon2_needs_rehash_detects_drift() -> None:
    """A hash produced under stale parameters must report ``needs_rehash=True``."""
    stale = argon2.PasswordHasher(
        time_cost=2,  # below pinned 3
        memory_cost=64 * 1024,
        parallelism=4,
        hash_len=32,
        salt_len=16,
        type=argon2.Type.ID,
    )
    drifted_hash = stale.hash("password")
    assert needs_rehash(drifted_hash) is True
    # And a hash from the canonical params reports needs_rehash=False.
    fresh = hash_password(Secret("password"))
    assert needs_rehash(fresh) is False


def test_argon2_pinned_params() -> None:
    """The PHC header carries the OWASP-pinned ``m=65536,t=3,p=4`` cost vector."""
    encoded = hash_password(Secret("anything"))
    match = re.match(
        r"^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$",
        encoded,
    )
    assert match is not None, f"unexpected PHC header: {encoded!r}"
    memory, time_cost, parallelism = (int(g) for g in match.groups())
    assert memory == 64 * 1024  # 65536 KiB == 64 MiB
    assert time_cost == 3
    assert parallelism == 4


def test_bootstrap_token_round_trip() -> None:
    """Bootstrap helpers share the pinned params and round-trip cleanly."""
    candidate = Secret("bootstrap-token-value")
    stored = hash_bootstrap_token(candidate)
    assert verify_bootstrap_token(stored, Secret("bootstrap-token-value")) is True
    assert verify_bootstrap_token(stored, Secret("not-the-token")) is False


# ---------------------------------------------------------------------------
# Phase 30 ownership marker
# ---------------------------------------------------------------------------


def test_derive_snapshot_key_raises_notimplemented() -> None:
    """Calling :func:`derive_snapshot_key` MUST raise — Phase 30 owns it."""
    with pytest.raises(NotImplementedError, match="Phase 30"):
        _ = derive_snapshot_key()
    # Positional + keyword args are also rejected loudly.
    with pytest.raises(NotImplementedError):
        _ = derive_snapshot_key("ignored", purpose="ignored")


# ---------------------------------------------------------------------------
# EncryptedFieldCodec — adapter binding CryptoService to a (table, column) pair
# ---------------------------------------------------------------------------


def test_codec_round_trip_returns_secret_bytes() -> None:
    """``encode`` then ``decode`` recovers the original :class:`Secret` bytes."""
    crypto = _crypto_service()
    codec = EncryptedFieldCodec(crypto, "connectors", "api_key")
    plaintext = Secret(b"k1")
    nonce, ciphertext, tag, key_version = codec.encode(plaintext, "row-a")
    recovered = codec.decode(nonce, ciphertext, tag, key_version, "row-a")
    assert recovered is not None
    assert recovered.expose() == b"k1"


def test_codec_decode_returns_none_for_all_null_columns() -> None:
    """All-NULL columns are the sanctioned "no value stored" shape."""
    crypto = _crypto_service()
    codec = EncryptedFieldCodec(crypto, "connectors", "api_key")
    assert codec.decode(None, None, None, None, "row-a") is None


def test_codec_decode_rejects_partial_columns() -> None:
    """Partial NULL combos must raise :class:`CryptoError`, never round-trip."""
    crypto = _crypto_service()
    codec = EncryptedFieldCodec(crypto, "connectors", "api_key")
    nonce, ciphertext, tag, key_version = codec.encode(Secret(b"k1"), "row-a")
    # Drop nonce only — a partial write must fail loud.
    with pytest.raises(CryptoError, match="incomplete"):
        _ = codec.decode(None, ciphertext, tag, key_version, "row-a")
    # Drop key_version only — same outcome.
    with pytest.raises(CryptoError, match="incomplete"):
        _ = codec.decode(nonce, ciphertext, tag, None, "row-a")


def test_codec_aad_swap_between_rows_fails_authentication() -> None:
    """Copying a ciphertext to a different row_pk fails AES-GCM authentication."""
    crypto = _crypto_service()
    codec = EncryptedFieldCodec(crypto, "connectors", "api_key")
    nonce, ciphertext, tag, key_version = codec.encode(Secret(b"k1"), "row-a")
    with pytest.raises(CryptoAuthenticationFailed):
        _ = codec.decode(nonce, ciphertext, tag, key_version, "row-b")
