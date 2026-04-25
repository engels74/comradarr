"""Master secret-key validation.

`validate_secret_key` enforces the structural + denylist gates from plan §5.1.1
Step 2.4. Every failure raises :class:`ConfigurationError` carrying the failed
check name; the key value is never echoed.

The denylist payload is loaded lazily from ``security/leaked_keys.dat`` and
cached in a frozen ``frozenset[bytes]`` at first call.
"""

import math
import pathlib
from typing import TYPE_CHECKING

from comradarr.errors.configuration import ConfigurationError

if TYPE_CHECKING:
    from collections.abc import Iterable

_DENYLIST_PATH = pathlib.Path(__file__).with_name("leaked_keys.dat")
_MIN_LENGTH = 32
_MIN_DISTINCT_BYTES = 8
_MIN_SHANNON_ENTROPY_BITS_PER_BYTE = 4.0

_denylist_cache: frozenset[bytes] | None = None


def _parse_denylist_lines(lines: Iterable[str]) -> frozenset[bytes]:
    parsed: set[bytes] = set()
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        try:
            parsed.add(bytes.fromhex(line))
        except ValueError as e:
            raise ConfigurationError(f"leaked_keys.dat: invalid hex line: {line!r}") from e
    return frozenset(parsed)


def _load_denylist() -> frozenset[bytes]:
    global _denylist_cache
    if _denylist_cache is None:
        _denylist_cache = _parse_denylist_lines(
            _DENYLIST_PATH.read_text(encoding="utf-8").splitlines()
        )
    return _denylist_cache


def _shannon_entropy_bits_per_byte(data: bytes) -> float:
    if not data:
        return 0.0
    counts: dict[int, int] = {}
    for b in data:
        counts[b] = counts.get(b, 0) + 1
    n = len(data)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def _is_strictly_monotonic(data: bytes) -> bool:
    if len(data) < 2:
        return False
    deltas = {data[i + 1] - data[i] for i in range(len(data) - 1)}
    # Strictly monotonic across the whole sequence — increment or decrement of 1.
    return deltas == {1} or deltas == {-1}


def validate_secret_key(key: bytes) -> None:
    """Validate a 32-byte master key. Raises :class:`ConfigurationError` on failure.

    Failure messages name the failed check; the key value is never included.
    """
    if len(key) < _MIN_LENGTH:
        raise ConfigurationError(
            f"secret key length: must be at least {_MIN_LENGTH} bytes, got {len(key)}"
        )
    if all(b == 0 for b in key):
        raise ConfigurationError("secret key shape: all-zero")
    if all(b == 0xFF for b in key):
        raise ConfigurationError("secret key shape: all-FF")
    if len(set(key)) == 1:
        raise ConfigurationError("secret key shape: repeating-single-byte")
    if _is_strictly_monotonic(key):
        raise ConfigurationError("secret key shape: monotonic byte sequence")
    if len(set(key)) < _MIN_DISTINCT_BYTES:
        raise ConfigurationError(f"secret key entropy: distinct bytes < {_MIN_DISTINCT_BYTES}")
    entropy = _shannon_entropy_bits_per_byte(key)
    if entropy < _MIN_SHANNON_ENTROPY_BITS_PER_BYTE:
        raise ConfigurationError(
            f"secret key entropy: Shannon entropy {entropy:.2f} < "
            + f"{_MIN_SHANNON_ENTROPY_BITS_PER_BYTE} bits/byte"
        )
    if key in _load_denylist():
        raise ConfigurationError("secret key denylist: matches a known leaked key")
