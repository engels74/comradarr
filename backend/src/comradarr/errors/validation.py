"""Validation error class (PRD §21).

The RFC 9457 handler surfaces :attr:`errors` as the ``errors`` extension
member — a list of structured per-field error descriptors so frontends can
attach messages to specific fields without parsing free-form ``detail``.
"""

from typing import TYPE_CHECKING, ClassVar

from comradarr.errors.base import ComradarrError

if TYPE_CHECKING:
    from collections.abc import Mapping


class ValidationError(ComradarrError):
    """Request body / query validation failed (HTTP 422)."""

    code: ClassVar[str] = "validation.failed"
    default_message: ClassVar[str] = "Validation failed"
    status_code: ClassVar[int] = 422

    errors: list[Mapping[str, object]]

    def __init__(
        self,
        message: str | None = None,
        *,
        errors: list[Mapping[str, object]] | None = None,
        context: Mapping[str, object] | None = None,
    ) -> None:
        super().__init__(message, context=context)
        self.errors = errors if errors is not None else []
