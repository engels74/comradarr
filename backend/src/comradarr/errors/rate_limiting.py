# backend/src/comradarr/errors/rate_limiting.py
"""Rate-limiting error classes (PRD §15)."""

from typing import ClassVar

from comradarr.errors.base import ComradarrError


class RateLimitExceeded(ComradarrError):
    """IP or username rate limit exceeded (HTTP 429).

    Middleware maps this to 429 + ``Retry-After`` header.
    ``context["retry_after"]`` carries the number of seconds the caller
    should wait before retrying (derived from the violated window length).
    """

    code: ClassVar[str] = "rate_limit.exceeded"
    default_message: ClassVar[str] = "Rate limit exceeded"
    status_code: ClassVar[int] = 429
