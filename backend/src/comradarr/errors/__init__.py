"""Comradarr error hierarchy — public re-exports.

The full domain enumeration lives in the per-domain modules. Catching
:class:`ComradarrError` catches every domain error; catching a per-domain
base (e.g. :class:`ConnectorError`) catches a category. PRD §21 owns the
canonical code and HTTP-status table.
"""

from comradarr.errors.authentication import (
    AuthenticationApiKeyRevoked,
    AuthenticationInvalidCredentials,
    AuthenticationSessionExpired,
)
from comradarr.errors.authorization import (
    AuthorizationForbidden,
    AuthorizationPermissionRequired,
)
from comradarr.errors.base import ComradarrError
from comradarr.errors.configuration import ConfigurationError
from comradarr.errors.connector import (
    ConnectorApiError,
    ConnectorError,
    ConnectorUnavailable,
    ConnectorUrlRejected,
)
from comradarr.errors.crypto import (
    CryptoAuthenticationFailed,
    CryptoError,
    CryptoUnknownKeyVersion,
)
from comradarr.errors.internal import InternalUnexpected
from comradarr.errors.validation import ValidationError

__all__ = [
    "AuthenticationApiKeyRevoked",
    "AuthenticationInvalidCredentials",
    "AuthenticationSessionExpired",
    "AuthorizationForbidden",
    "AuthorizationPermissionRequired",
    "ComradarrError",
    "ConfigurationError",
    "ConnectorApiError",
    "ConnectorError",
    "ConnectorUnavailable",
    "ConnectorUrlRejected",
    "CryptoAuthenticationFailed",
    "CryptoError",
    "CryptoUnknownKeyVersion",
    "InternalUnexpected",
    "ValidationError",
]
