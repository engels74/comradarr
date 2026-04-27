# backend/src/comradarr/core/auth/__init__.py
"""Auth provider abstractions — public re-exports (plan §5.4.1).

Import surface for the auth subsystem:
- Protocol + outcome types from ``protocol``
- Registry from ``registry``
- Sentinel constants from ``sentinel``
"""

from comradarr.core.auth.protocol import (
    AuthOutcome,
    AuthProvider,
    Failure,
    NotApplicable,
    Success,
)
from comradarr.core.auth.registry import AuthProviderRegistry
from comradarr.core.auth.sentinel import LOCKED_OIDC_HASH, LOCKED_TRUSTED_HEADER_HASH

__all__ = [
    "LOCKED_OIDC_HASH",
    "LOCKED_TRUSTED_HEADER_HASH",
    "AuthOutcome",
    "AuthProvider",
    "AuthProviderRegistry",
    "Failure",
    "NotApplicable",
    "Success",
]
