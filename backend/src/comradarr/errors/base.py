"""ComradarrError — base for every domain exception that maps to RFC 9457.

Subclasses live in ``comradarr.errors.{authentication,authorization,connector,
validation,internal}`` per PRD §21. The translation layer in
``comradarr.errors.handlers`` is the only code that constructs Problem Details
response bodies — services raise, the handler translates.

The hierarchy is intentionally shallow: catching :class:`ComradarrError`
catches every domain error; catching a per-domain base
(``ConnectorError``, ``AuthenticationError``-style) catches a category. Deep
hierarchies invite "swallow the wrong base class" bugs (PRD §21).
"""

from typing import TYPE_CHECKING, ClassVar

if TYPE_CHECKING:
    from collections.abc import Mapping


class ComradarrError(Exception):
    """Base of the Comradarr domain-error hierarchy.

    Subclasses set:
    * :attr:`code` — stable dotted identifier (e.g.
      ``"authentication.invalid_credentials"``); becomes the terminal segment of
      the ``urn:comradarr:<code>`` ``type`` URI and the i18n catalog key.
    * :attr:`default_message` — short English summary, used as ``title``.
    * :attr:`status_code` — HTTP status the translation layer maps to.

    Instances may carry :attr:`context` — domain-specific structured data
    surfaced as the problem+json ``context`` extension member.
    """

    code: ClassVar[str] = "comradarr.unknown"
    default_message: ClassVar[str] = "Unknown error"
    status_code: ClassVar[int] = 500

    context: Mapping[str, object]

    def __init__(
        self,
        message: str | None = None,
        *,
        context: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message or self.default_message)
        self.context = context if context is not None else {}
