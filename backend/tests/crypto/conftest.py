"""Per-worker, per-test :class:`CryptoService` fixture (Phase 3 Iter 1 Independent #2).

The default fixture builds a deterministic-but-unique registry: the v1 key
is ``sha256(f"phase3-test-key-{worker_id}-{node_id}")`` so every test
function sees its own AES-GCM key bag and no two tests can share ciphertext
even when running under ``pytest -n auto``. The hash output is 32 bytes —
exactly the AES-256 length the CryptoService consumes — so we can hand it
straight to :class:`comradarr.core.crypto.CryptoService` without padding.

The registry is wrapped in a small structural shim (``_StubKeyRegistry``)
so we can bypass the runtime denylist + entropy gates (``validate_secret_key``)
that ``Settings`` would otherwise apply at load time. Test keys are
deliberately deterministic; failing them through the validator would force
either a global validator-bypass flag (bad — it'd weaken production gates)
or per-test seeded randomness (bad — flakes when sha256 lands on a banned
shape). The shim is the minimum surface area :class:`CryptoService.__init__`
actually reads (``secret_key_versions`` + ``current_key_version``).
"""

import hashlib
from typing import TYPE_CHECKING, cast

import pytest

from comradarr.core.crypto import CryptoService

if TYPE_CHECKING:
    from comradarr.config import Settings


class _StubKeyRegistry:
    """Two-field structural shim — only the two attributes CryptoService reads."""

    __slots__: tuple[str, ...] = ("current_key_version", "secret_key_versions")

    secret_key_versions: dict[int, bytes]
    current_key_version: int

    def __init__(self, secret_key_versions: dict[int, bytes], current_key_version: int) -> None:
        self.secret_key_versions = secret_key_versions
        self.current_key_version = current_key_version


def _derive_test_key(worker_id: str, node_id: str) -> bytes:
    """Derive a deterministic 32-byte AES key from the xdist worker + node id."""
    return hashlib.sha256(f"phase3-test-key-{worker_id}-{node_id}".encode()).digest()


@pytest.fixture(scope="function")
def crypto_service(request: pytest.FixtureRequest, worker_id: str) -> CryptoService:
    """Build a per-test :class:`CryptoService` with worker-and-node-isolated keys.

    Each test function receives a fresh registry so a misbehaving test can't
    bleed ciphertext into a sibling — and parallel xdist workers see fully
    distinct key material so two tests with the same node id but on
    different workers still observe disjoint registries.
    """
    node_id = cast("str", request.node.nodeid)  # pyright: ignore[reportUnknownMemberType]
    versions = {1: _derive_test_key(worker_id, node_id)}
    stub = cast("object", _StubKeyRegistry(versions, 1))
    return CryptoService(cast("Settings", stub))
