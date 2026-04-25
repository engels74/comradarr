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
