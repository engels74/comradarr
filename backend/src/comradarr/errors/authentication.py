"""Authentication error classes (PRD §21)."""

from typing import ClassVar

from comradarr.errors.base import ComradarrError


class AuthenticationInvalidCredentials(ComradarrError):
    """Submitted credentials don't match any user/key (HTTP 401)."""

    code: ClassVar[str] = "authentication.invalid_credentials"
    default_message: ClassVar[str] = "Invalid credentials"
    status_code: ClassVar[int] = 401


class AuthenticationSessionExpired(ComradarrError):
    """Session token expired or revoked (HTTP 401)."""

    code: ClassVar[str] = "authentication.session_expired"
    default_message: ClassVar[str] = "Session expired"
    status_code: ClassVar[int] = 401


class AuthenticationApiKeyRevoked(ComradarrError):
    """Provided API key has been revoked (HTTP 401)."""

    code: ClassVar[str] = "authentication.api_key_revoked"
    default_message: ClassVar[str] = "API key revoked"
    status_code: ClassVar[int] = 401


class AuthenticationLocalLoginDisabled(ComradarrError):
    """Local password login is disabled by operator configuration (HTTP 403)."""

    code: ClassVar[str] = "authentication.local_login_disabled"
    default_message: ClassVar[str] = "Local login is disabled"
    status_code: ClassVar[int] = 403


class AuthenticationApiKeyNotFound(ComradarrError):
    """API key id does not exist or was already revoked (HTTP 404)."""

    code: ClassVar[str] = "authentication.api_key_not_found"
    default_message: ClassVar[str] = "API key not found"
    status_code: ClassVar[int] = 404


class AuthenticationAccountLinkingBlocked(ComradarrError):
    """OIDC account linking blocked by require_separate policy (HTTP 409)."""

    code: ClassVar[str] = "authentication.account_linking_blocked"
    default_message: ClassVar[str] = "Account linking blocked by policy"
    status_code: ClassVar[int] = 409
