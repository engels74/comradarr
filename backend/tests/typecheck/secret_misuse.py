"""Intentional ``Secret``-misuse fixture for basedpyright (Phase 3 §5.3.6 gate).

Passing a :class:`Secret[bytes]` into a ``bytes``-only sink must be rejected
by basedpyright. The companion test
:mod:`tests.test_secret_typecheck` shells basedpyright over this file and
asserts the diagnostic fires; the runtime ``Secret.__bytes__`` raise-twin
is the defense-in-depth complement to this static gate.

This file is *excluded* from the suite-wide basedpyright run via
``[tool.basedpyright].exclude`` so the recommended-mode pass over ``src/`` +
``tests/`` stays clean. It exists only to be invoked by the gate test —
never import it from anywhere else.
"""

from comradarr.core.types import Secret


def consume(value: bytes) -> int:
    """Bytes-only sink — stands in for any std-lib API expecting raw bytes."""
    return len(value)


_secret: Secret[bytes] = Secret(b"hunter2")
# basedpyright must flag the next line: Secret[bytes] is NOT bytes (no
# implicit conversion; ``__bytes__`` raises at runtime). The expected rule
# is ``reportArgumentType``.
_ = consume(_secret)
