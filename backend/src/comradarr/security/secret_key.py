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
        parsed = _parse_denylist_lines(_DENYLIST_PATH.read_text(encoding="utf-8").splitlines())
        # Corpus self-check: every entry must be a complete 32-byte key. A
        # 31-byte typo (or any short entry) is unreachable because
        # ``validate_secret_key`` rejects sub-32-byte inputs at the length
        # gate before the denylist check fires — a silent dead entry.
        wrong = sorted({len(k) for k in parsed if len(k) != _MIN_LENGTH})
        if wrong:
            raise ConfigurationError(
                "leaked_keys.dat: corrupt corpus — entries with byte lengths "
                + f"{wrong!r} (every entry must be exactly {_MIN_LENGTH} bytes)"
            )
        _denylist_cache = parsed
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


def validate_secret_key_registry(versions: dict[int, bytes], current_version: int) -> None:
    """Validate the **current** key against denylist + entropy gates.

    Phase 3 §5.3 + Iter 1 Critic C1: only ``versions[current_version]`` is
    re-validated here. Retired keys are decryption-only and intentionally
    skip the entropy/denylist gates so a key that was acceptable on the day
    it was minted but later landed on the denylist (e.g. corpus growth)
    still decrypts old rows. Phase 30 owns the full-registry sweep that
    triggers re-encryption to retire such keys safely.

    Raises :class:`ConfigurationError` when ``current_version`` is missing
    from ``versions``, or when the current key fails any
    :func:`validate_secret_key` gate.
    """
    if current_version not in versions:
        raise ConfigurationError(
            f"secret key registry: current_version={current_version} not present in versions"
        )
    current_key = versions[current_version]
    try:
        validate_secret_key(current_key)
    except ConfigurationError as exc:
        raise ConfigurationError(
            f"secret key registry: current key (v{current_version}) failed validation: {exc}"
        ) from exc
