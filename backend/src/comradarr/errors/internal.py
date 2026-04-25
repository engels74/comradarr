"""Internal-error class (PRD §21).

:class:`InternalUnexpected` is raised when something fails that the domain
hierarchy did not anticipate. The unhandled-exception handler in
``comradarr.errors.handlers`` returns the same RFC 9457 envelope shape with
``code='internal.unexpected'`` and a generic ``detail`` so internals never
leak to clients.
"""

from typing import ClassVar

from comradarr.errors.base import ComradarrError


class InternalUnexpected(ComradarrError):
    """Unexpected server-side failure (HTTP 500). Detail is generic by policy."""

    code: ClassVar[str] = "internal.unexpected"
    default_message: ClassVar[str] = "Internal server error"
    status_code: ClassVar[int] = 500
