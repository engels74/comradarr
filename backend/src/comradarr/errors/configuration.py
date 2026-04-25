"""Pre-lifespan configuration error.

Raised by :func:`comradarr.config.load_settings` and by
``backend/migrations/env.py`` when environment-variable validation fails.

Subclasses :class:`Exception` directly — *not* :class:`ComradarrError` — because
it is raised before the Litestar app exists and therefore has no HTTP-status
semantics. The RFC 9457 envelope handler in ``comradarr.errors.handlers`` does
not see this error type.
"""


class ConfigurationError(Exception):
    """Settings validation failed before Litestar lifespan could start."""
