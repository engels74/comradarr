"""UUIDv7 monotonicity gate (plan §3 Milestone 10 step 49 + plan §6 R8).

UUIDv7 keys are monotonic-or-equal across same-millisecond generations because
the high 48 bits encode the Unix timestamp in milliseconds and the remaining
bits include a counter that strictly increases within a tick. The project
relies on this property for index locality on append-heavy tables (mirror_*,
audit_log, planned_commands) — a non-monotonic generator would re-introduce
the page-fragmentation problem v4 keys cause and undermine RULE-DB-005.

Plan §6 R8 pins the contract as "monotonic-or-equal across batches" rather
than "strictly monotonic" because in degenerate cases (clock-skew, fast
loops within a single millisecond) the implementation may emit identical
adjacent values — that is fine for B-tree append locality; what is NOT
fine is going *backwards*, which would cause page splits.
"""

from typing import TYPE_CHECKING

from comradarr.db.base import uuid_v7_pk_default

if TYPE_CHECKING:
    import uuid

_TOTAL_SAMPLES = 1000
_BATCH_SIZE = 100


def test_uuid_v7_monotonic_or_equal_within_batch() -> None:
    """1000 UUIDv7s in a tight loop are monotonic-or-equal pairwise."""
    samples: list[uuid.UUID] = [uuid_v7_pk_default() for _ in range(_TOTAL_SAMPLES)]
    # strict=False: samples[1:] is intentionally one element shorter than samples;
    # zip pairs each (samples[i], samples[i+1]) and stops at the natural end.
    for previous, current in zip(samples, samples[1:], strict=False):
        assert current >= previous, (
            f"UUIDv7 went backwards: {previous} → {current} "
            "(violates RULE-DB-005 monotonicity contract)"
        )


def test_uuid_v7_monotonic_across_batches() -> None:
    """Last id of batch N is <= first id of batch N+1 across 10 batches."""
    batches: list[list[uuid.UUID]] = [
        [uuid_v7_pk_default() for _ in range(_BATCH_SIZE)]
        for _ in range(_TOTAL_SAMPLES // _BATCH_SIZE)
    ]
    for batch_idx in range(len(batches) - 1):
        last_of_current = batches[batch_idx][-1]
        first_of_next = batches[batch_idx + 1][0]
        assert first_of_next >= last_of_current, (
            f"cross-batch regression at boundary {batch_idx}->{batch_idx + 1}: "
            f"last={last_of_current} first_of_next={first_of_next}"
        )


def test_uuid_v7_version_field() -> None:
    """Generated UUIDs are tagged version 7 (sanity check on the generator)."""
    for _ in range(64):
        sample = uuid_v7_pk_default()
        assert sample.version == 7, (
            f"uuid_v7_pk_default returned version={sample.version}, expected 7 — "
            "RULE-DB-005 requires UUIDv7 surrogate keys"
        )
