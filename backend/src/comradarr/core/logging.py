# pyright: reportAny=false, reportExplicitAny=false
"""Structlog configuration (RECIPE-STRUCTLOG).

Defines the canonical processor chain — ``merge_contextvars`` →
``add_logger_name`` → ``add_log_level`` → ``StackInfoRenderer`` →
``format_exc_info`` → :func:`header_redaction_processor` →
:func:`secret_pattern_redaction_processor` → :func:`dedup_throttle_processor`
→ ``TimeStamper`` → ``JSONRenderer`` (json) or ``ConsoleRenderer`` (console)
— and two entrypoints:

* :func:`configure_logging` — direct structlog setup for code that runs BEFORE
  Litestar lifespan (CLI tools, Alembic migration scripts).
* :func:`build_structlog_config` — wraps the same chain into a Litestar
  :class:`StructlogConfig` for the :class:`StructlogPlugin` (plan §6.3).

Both call :func:`_set_dedup_per_minute` so the in-memory token-bucket
:func:`dedup_throttle_processor` (Q5) picks up the configured rate from
:class:`comradarr.config.Settings`.
"""

import logging
import re
import threading
import time
from typing import TYPE_CHECKING

import structlog
from litestar.logging.config import StructLoggingConfig
from litestar.plugins.structlog import StructlogConfig

if TYPE_CHECKING:
    from structlog.types import EventDict, Processor, WrappedLogger

    from comradarr.config import Settings


_REDACTED = "<redacted>"

# Header keys whose VALUE always carries credentials. Lowercased on compare.
_REDACTED_HEADER_KEYS: frozenset[str] = frozenset(
    {
        "authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "x-csrf-token",
    }
)


def header_redaction_processor(
    _logger: WrappedLogger, _method_name: str, event_dict: EventDict
) -> EventDict:
    """Mask values whose KEY is a well-known auth header (case-insensitive)."""
    for key in list(event_dict):
        if key.lower() in _REDACTED_HEADER_KEYS:
            event_dict[key] = _REDACTED
    return event_dict


# TODO(Phase 3): integrate Secret[T] type-aware redaction once §5.3.1 lands.
# These patterns redact the entire matching value (never a substring). Each
# pattern is applied independently; order is irrelevant.
_SECRET_VALUE_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Argon2id hash header: $argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>
    re.compile(r"^\$argon2id\$"),
    # JWT: three base64url segments separated by '.'
    re.compile(r"^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$"),
    # Comradarr live-tier API key prefix
    re.compile(r"^cmrr_live_[A-Za-z0-9_-]{16,}$"),
    # AES-GCM ciphertext blob (Phase 3 §5.3.1 spec): version-prefixed base64url
    re.compile(r"^v\d+:[A-Za-z0-9_-]{32,}$"),
)


def secret_pattern_redaction_processor(
    _logger: WrappedLogger, _method_name: str, event_dict: EventDict
) -> EventDict:
    """Mask string values matching well-known secret-bearing patterns."""
    for key, value in list(event_dict.items()):
        if isinstance(value, str) and any(p.search(value) for p in _SECRET_VALUE_PATTERNS):
            event_dict[key] = _REDACTED
    return event_dict


class _Bucket:
    """Single-event-name token bucket. Caller holds the module-level lock."""

    __slots__: tuple[str, ...] = ("capacity", "last_refill", "tokens")

    capacity: int
    tokens: float
    last_refill: float

    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self.tokens = float(capacity)
        self.last_refill = time.monotonic()

    def try_consume(self, refill_per_sec: float) -> bool:
        now = time.monotonic()
        self.tokens = min(
            float(self.capacity),
            self.tokens + (now - self.last_refill) * refill_per_sec,
        )
        self.last_refill = now
        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True
        return False


_DEDUP_LOCK = threading.Lock()
_DEDUP_BUCKETS: dict[str, _Bucket] = {}
_dedup_per_minute_capacity: int = 100


def _set_dedup_per_minute(value: int) -> None:
    """Reset the in-memory dedup state to the new per-minute capacity."""
    global _dedup_per_minute_capacity
    with _DEDUP_LOCK:
        _dedup_per_minute_capacity = max(1, value)
        _DEDUP_BUCKETS.clear()


def dedup_throttle_processor(
    _logger: WrappedLogger, _method_name: str, event_dict: EventDict
) -> EventDict:
    """Token-bucket throttle keyed by structlog ``event`` name.

    Capacity = ``settings.comradarr_log_dedup_per_minute`` events. Refill rate
    is capacity/60 events/sec. Excess events raise :class:`structlog.DropEvent`,
    which structlog interprets as "discard silently". Phase 20 owns the
    production tuning + Prometheus integration (Q5).
    """
    event = event_dict.get("event")
    if not isinstance(event, str):
        return event_dict
    capacity = _dedup_per_minute_capacity
    refill_per_sec = capacity / 60.0
    with _DEDUP_LOCK:
        bucket = _DEDUP_BUCKETS.get(event)
        if bucket is None or bucket.capacity != capacity:
            bucket = _Bucket(capacity)
            _DEDUP_BUCKETS[event] = bucket
        allowed = bucket.try_consume(refill_per_sec)
    if not allowed:
        raise structlog.DropEvent
    return event_dict


def _build_processor_chain(log_format: str) -> list[Processor]:
    """RECIPE-STRUCTLOG canonical chain. Last entry is the renderer."""
    chain: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        header_redaction_processor,
        secret_pattern_redaction_processor,
        dedup_throttle_processor,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]
    if log_format == "json":
        chain.append(structlog.processors.JSONRenderer())
    else:
        chain.append(structlog.dev.ConsoleRenderer(colors=True))
    return chain


def _resolve_level(name: str) -> int:
    return logging.getLevelNamesMapping().get(name.upper(), logging.INFO)


def configure_logging(settings: Settings) -> None:
    """Configure structlog per RECIPE-STRUCTLOG; quiets noisy libraries.

    Direct entrypoint for code that runs BEFORE Litestar lifespan (CLI tools,
    Alembic migration scripts). Inside the Litestar app, the
    :class:`StructlogPlugin` built by :func:`build_structlog_config` performs
    an equivalent setup.
    """
    _set_dedup_per_minute(settings.comradarr_log_dedup_per_minute)

    level_value = _resolve_level(settings.comradarr_log_level)
    logging.basicConfig(level=level_value, format="%(message)s", force=True)
    structlog.configure(
        processors=_build_processor_chain(settings.comradarr_log_format),
        wrapper_class=structlog.make_filtering_bound_logger(level_value),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Quiet noisy libraries — PRD §20.
    for name in ("sqlalchemy.engine", "granian"):
        logging.getLogger(name).setLevel(logging.WARNING)


def build_structlog_config(settings: Settings) -> StructlogConfig:
    """Return :class:`StructlogConfig` wired to RECIPE-STRUCTLOG (plan §6.3).

    ``logger_factory=structlog.stdlib.LoggerFactory()`` is required because the
    canonical processor chain uses ``structlog.stdlib.add_logger_name`` which
    reads ``logger.name`` — Litestar's default ``BytesLoggerFactory`` returns a
    ``BytesLogger`` that has no such attribute and would raise
    ``AttributeError`` on every log call. Routing through the stdlib
    ``logging`` module is also the easiest way to keep
    ``logging.basicConfig``-quieted libraries (sqlalchemy.engine, granian)
    obeying our level overrides.
    """
    _set_dedup_per_minute(settings.comradarr_log_dedup_per_minute)
    return StructlogConfig(
        structlog_logging_config=StructLoggingConfig(
            processors=_build_processor_chain(settings.comradarr_log_format),
            logger_factory=structlog.stdlib.LoggerFactory(),
            cache_logger_on_first_use=True,
        ),
    )
