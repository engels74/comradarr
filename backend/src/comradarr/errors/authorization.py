"""Authorization error classes (PRD §21)."""

from typing import ClassVar

from comradarr.errors.base import ComradarrError


class AuthorizationForbidden(ComradarrError):
    """Authenticated identity is not allowed to perform this action (HTTP 403)."""

    code: ClassVar[str] = "authorization.forbidden"
    default_message: ClassVar[str] = "Forbidden"
    status_code: ClassVar[int] = 403


class AuthorizationPermissionRequired(ComradarrError):
    """Required permission missing — UX should expose which permission (HTTP 403)."""

    code: ClassVar[str] = "authorization.permission_required"
    default_message: ClassVar[str] = "Permission required"
    status_code: ClassVar[int] = 403
