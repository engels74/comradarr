"""Connector error classes (PRD §21).

Connector errors carry an instance-level :attr:`retryable` flag the RFC 9457
handler surfaces as the ``retryable`` extension member so frontends and the
sync engine can decide whether a backoff retry is appropriate without parsing
``code``.
"""

from typing import TYPE_CHECKING, ClassVar

from comradarr.errors.base import ComradarrError

if TYPE_CHECKING:
    from collections.abc import Mapping


class ConnectorError(ComradarrError):
    """Base for all upstream-connector failures (Sonarr / Radarr / Prowlarr).

    Catching :class:`ConnectorError` catches every connector-class failure
    without having to enumerate concrete subclasses.
    """

    code: ClassVar[str] = "connector.error"
    default_message: ClassVar[str] = "Connector error"
    status_code: ClassVar[int] = 502

    retryable: bool

    def __init__(
        self,
        message: str | None = None,
        *,
        retryable: bool = False,
        context: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message, context=context)
        self.retryable = retryable


class ConnectorUnavailable(ConnectorError):
    """Upstream connector unreachable / network error (HTTP 502, retryable)."""

    code: ClassVar[str] = "connector.unavailable"
    default_message: ClassVar[str] = "Connector unavailable"
    status_code: ClassVar[int] = 502

    def __init__(
        self,
        message: str | None = None,
        *,
        retryable: bool = True,
        context: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message, retryable=retryable, context=context)


class ConnectorApiError(ConnectorError):
    """Upstream connector returned an error response (HTTP 502)."""

    code: ClassVar[str] = "connector.api_error"
    default_message: ClassVar[str] = "Connector API error"
    status_code: ClassVar[int] = 502


class ConnectorUrlRejected(ConnectorError):
    """Connector URL failed the URL classifier (HTTP 400, never retryable)."""

    code: ClassVar[str] = "connector.url_rejected"
    default_message: ClassVar[str] = "Connector URL rejected"
    status_code: ClassVar[int] = 400

    def __init__(
        self,
        message: str | None = None,
        *,
        retryable: bool = False,
        context: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message, retryable=retryable, context=context)
