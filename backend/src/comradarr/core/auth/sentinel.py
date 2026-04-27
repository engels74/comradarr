# backend/src/comradarr/core/auth/sentinel.py
"""Sentinel password-hash constants for provisioned (non-local) user accounts.

These constants are the ONLY sanctioned import path for both:
- Writers: ``UserRepository.create_provisioned`` (Slice D)
- Readers: ``LocalPasswordProvider`` (Slice E) — must structurally reject
  any login attempt for a user whose ``password_hash`` equals one of these.

The values begin with ``!`` which is outside the Argon2id output alphabet,
making them impossible to produce via ``hash_password`` and unambiguous as
sentinels in a ``==`` check (RULE-AUTHZ-MATCH-001: exact-string equality).
"""

from typing import Final

LOCKED_TRUSTED_HEADER_HASH: Final[str] = "!locked-trusted-header!"
LOCKED_OIDC_HASH: Final[str] = "!locked-oidc!"
