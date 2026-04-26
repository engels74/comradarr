"""CryptoService — AES-256-GCM, per-row AAD, Argon2id helpers (plan §5.3.2/§5.3.4).

The service is the SINGLE entry point for cryptographic operations across the
backend. Three reasons for centralizing:

* AAD discipline: every encrypted column on every table MUST bind its
  ``(table, row_pk, column)`` triple as Additional Authenticated Data so a
  ciphertext copied between rows or columns fails to decrypt loudly. The
  triple is built by :meth:`CryptoService.aad_for` — the only sanctioned
  source of AAD bytes.
* Key-version registry: the active version (``current_key_version``) is
  used for new encrypts; historical versions in ``secret_key_versions``
  remain decryptable until rotated out. A blob whose ``key_version`` is
  unknown raises :class:`CryptoUnknownKeyVersion` rather than silently
  re-encrypting under the current key (loud failure beats data loss).
* Argon2id parameters: hashing must be done with one pinned set of
  parameters so verify+rehash semantics work. The single
  :data:`_INTERACTIVE_PARAMS` instance is the only :class:`PasswordHasher`
  in the process; every entry point delegates to it.

Phase 30 (snapshot key derivation) is intentionally a `NotImplementedError`
so a forgotten wiring site fails loudly at runtime instead of silently
returning a default-zero key.
"""

import os
from typing import TYPE_CHECKING, Final, NoReturn

import argon2
import argon2.exceptions
import msgspec
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from comradarr.core.types import Secret
from comradarr.errors.crypto import CryptoAuthenticationFailed, CryptoUnknownKeyVersion

if TYPE_CHECKING:
    from collections.abc import Mapping

    from comradarr.config import Settings


_NONCE_BYTES: Final = 12  # 96 bits — AES-GCM RFC 5116 recommendation.
_TAG_BYTES: Final = 16  # 128-bit authentication tag.

# OWASP-recommended interactive Argon2id profile (plan §5.3.4): 64 MiB cost,
# 3 time iterations, 4-way parallelism, 32-byte hash, 16-byte salt. The single
# module-scope PasswordHasher is what every entry point delegates to so verify
# and check_needs_rehash use the same canonical parameter set.
_INTERACTIVE_PARAMS: Final = argon2.PasswordHasher(
    time_cost=3,
    memory_cost=64 * 1024,  # 65536 KiB == 64 MiB
    parallelism=4,
    hash_len=32,
    salt_len=16,
    type=argon2.Type.ID,
)


class EncryptedBlob(msgspec.Struct, frozen=True, kw_only=True):
    """Serializable wrapper for AES-256-GCM ciphertext + metadata.

    The blob is what gets persisted (4 columns per :func:`db.encrypted.EncryptedField`)
    or shipped over the wire. It carries enough information to find the
    decrypt key (``key_version``) but no plaintext-shaped fields.
    """

    nonce: bytes
    ciphertext: bytes
    tag: bytes
    key_version: int


class CryptoService:
    """AES-256-GCM encrypt/decrypt with per-row AAD + key-version registry.

    Constructed once at lifespan startup from :class:`Settings`; the long-
    lived AESGCM cipher objects are cached per key version so each
    encrypt/decrypt avoids the per-call ``AESGCM(key)`` construction
    overhead.
    """

    _keys: Mapping[int, AESGCM]
    _current_version: int

    def __init__(self, settings: Settings) -> None:
        self._keys = {version: AESGCM(key) for version, key in settings.secret_key_versions.items()}
        self._current_version = settings.current_key_version

    def encrypt(self, plaintext: Secret[bytes], aad: bytes) -> EncryptedBlob:
        """Encrypt ``plaintext.expose()`` under the current key + ``aad``.

        Returns a fully populated :class:`EncryptedBlob`. The 96-bit nonce is
        generated freshly from ``os.urandom(12)`` per call — never reuse a
        nonce under a given key (AES-GCM nonce reuse is catastrophic for
        confidentiality + integrity). 1000-iteration uniqueness is asserted
        in :file:`tests/test_crypto.py`.
        """
        cipher = self._keys[self._current_version]
        nonce = os.urandom(_NONCE_BYTES)
        sealed = cipher.encrypt(nonce, plaintext.expose(), aad)
        # cryptography's AESGCM appends the 16-byte tag to the ciphertext;
        # split here so the EncryptedBlob's per-column shape matches the
        # 4-column ``EncryptedField`` storage layout.
        ciphertext = sealed[:-_TAG_BYTES]
        tag = sealed[-_TAG_BYTES:]
        return EncryptedBlob(
            nonce=nonce,
            ciphertext=ciphertext,
            tag=tag,
            key_version=self._current_version,
        )

    def decrypt(self, blob: EncryptedBlob, aad: bytes) -> Secret[bytes]:
        """Decrypt ``blob`` under the registry-resolved key + ``aad``.

        Raises :class:`CryptoUnknownKeyVersion` if ``blob.key_version`` is
        not in the registry (loud failure beats silent re-encrypt). Raises
        :class:`CryptoAuthenticationFailed` on AES-GCM tag failure
        (tampered ciphertext / nonce / AAD, or wrong key bytes).
        """
        cipher = self._keys.get(blob.key_version)
        if cipher is None:
            raise CryptoUnknownKeyVersion(
                context={"key_version": blob.key_version},
            )
        sealed = blob.ciphertext + blob.tag
        try:
            plaintext = cipher.decrypt(blob.nonce, sealed, aad)
        except InvalidTag as exc:
            raise CryptoAuthenticationFailed from exc
        return Secret(plaintext)

    @staticmethod
    def aad_for(table: str, row_pk: str, column: str) -> bytes:
        """Canonical AAD for a single encrypted column on a single row.

        ``f"{table}:{row_pk}:{column}"`` UTF-8-encoded. Identical inputs
        produce identical bytes; any mismatch (e.g. a ciphertext copied
        between rows) raises :class:`CryptoAuthenticationFailed` on
        decrypt — which is exactly the loud-fail behavior the AAD design
        targets.
        """
        return f"{table}:{row_pk}:{column}".encode()


def hash_password(plaintext: Secret[str]) -> str:
    """Hash a password under the pinned interactive parameters.

    Returns the PHC-encoded hash (``$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>``)
    suitable for column storage.
    """
    return _INTERACTIVE_PARAMS.hash(plaintext.expose())


def verify_password(stored_hash: str, candidate: Secret[str]) -> bool:
    """Verify ``candidate`` against ``stored_hash``; return plain ``bool``.

    ``argon2.PasswordHasher.verify`` raises :class:`VerifyMismatchError` on
    mismatch — squashed to ``False`` here so callers can branch on a bool.
    Any other argon2 exception bubbles (e.g. ``InvalidHashError`` indicates
    a corrupted column, which is a loud-fail situation).
    """
    try:
        return _INTERACTIVE_PARAMS.verify(stored_hash, candidate.expose())
    except argon2.exceptions.VerifyMismatchError:
        return False


def needs_rehash(stored_hash: str) -> bool:
    """Return True if ``stored_hash`` was produced under stale parameters."""
    return _INTERACTIVE_PARAMS.check_needs_rehash(stored_hash)


def hash_bootstrap_token(plaintext: Secret[str]) -> str:
    """Argon2id hash of the bootstrap setup token (separate grep entry point).

    Bootstrap tokens use the SAME :data:`_INTERACTIVE_PARAMS` as user
    passwords; this is a separate function so a code reviewer can grep for
    every site that touches a bootstrap token vs every site that touches a
    user password.
    """
    return _INTERACTIVE_PARAMS.hash(plaintext.expose())


def verify_bootstrap_token(stored_hash: str, candidate: Secret[str]) -> bool:
    """Verify a bootstrap token (mirrors :func:`verify_password`)."""
    try:
        return _INTERACTIVE_PARAMS.verify(stored_hash, candidate.expose())
    except argon2.exceptions.VerifyMismatchError:
        return False


def derive_snapshot_key(*_args: object, **_kwargs: object) -> NoReturn:
    """Phase 30 ownership marker — raises until snapshot key derivation lands.

    Calling this in any current Phase wires a forgotten code path to a loud
    runtime error rather than a silent default-zero key.
    """
    msg = "derive_snapshot_key is owned by Phase 30; not yet implemented"
    raise NotImplementedError(msg)
