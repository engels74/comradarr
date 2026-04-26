"""Crypto error classes (plan §5.3.1 / Phase 3 M4).

Three classes form the crypto-domain error surface:

* :class:`CryptoError` — domain base; everything below it inherits.
* :class:`CryptoUnknownKeyVersion` — ``EncryptedBlob.key_version`` is not
  registered in :class:`Settings.secret_key_versions`. Indicates a registry
  trim that dropped a still-referenced version, or a corrupted blob.
* :class:`CryptoAuthenticationFailed` — AES-256-GCM ``InvalidTag`` on
  decrypt: ciphertext / tag / nonce / AAD has been tampered with, or the
  key the row was encrypted under is no longer the same byte sequence.

All three return HTTP 500 to clients via the problem-details handler — a
crypto failure is never the user's problem to fix; it's an operator alert.
"""

from typing import ClassVar

from comradarr.errors.base import ComradarrError


class CryptoError(ComradarrError):
    """Crypto-domain base; every crypto error inherits from this class."""

    code: ClassVar[str] = "crypto.unknown"
    default_message: ClassVar[str] = "Crypto operation failed"
    status_code: ClassVar[int] = 500


class CryptoUnknownKeyVersion(CryptoError):
    """``EncryptedBlob.key_version`` is not registered in the key registry."""

    code: ClassVar[str] = "crypto.unknown_key_version"
    default_message: ClassVar[str] = "Unknown key version"
    status_code: ClassVar[int] = 500


class CryptoAuthenticationFailed(CryptoError):
    """AES-256-GCM ``InvalidTag`` — ciphertext / tag / nonce / AAD mismatch."""

    code: ClassVar[str] = "crypto.authentication_failed"
    default_message: ClassVar[str] = "Crypto authentication failed"
    status_code: ClassVar[int] = 500
