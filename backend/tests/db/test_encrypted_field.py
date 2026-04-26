"""EncryptedField column-shape + NULL roundtrip (plan §3 Milestone 10 step 45).

Two independent checks:

1. **Static column-shape** (no DB) — :class:`OIDCProvider` exposes the four
   columns the :func:`EncryptedField` helper produces, with the names
   ``client_secret_{nonce,ciphertext,tag,key_version}`` and SQL types
   ``LargeBinary, LargeBinary, LargeBinary, SmallInteger``. This locks the
   schema contract Phase 3 (AES-256-GCM rollout) depends on without needing
   a live database.
2. **NULL roundtrip** (DB) — insert an ``OIDCProvider`` with all four
   encrypted columns left NULL, read it back, assert the columns come out
   NULL. Phase 2 ships *structural* columns only (no cipher); the four
   columns must be nullable so v1 schema rollouts that pre-date the cipher
   succeed. Phase 3 follow-up migration may tighten ``NOT NULL`` after the
   cipher backfills.

The roundtrip is wired through the ``db_session`` fixture, which gives us
savepoint-rollback isolation per RECIPE-PYTEST-DB. Marked ``integration``
so a pytest run filtered to unit tests skips this case.
"""

from typing import TYPE_CHECKING, cast

import pytest
import sqlalchemy as sa
from sqlalchemy import select

from comradarr.db.models.oidc_provider import OIDCProvider

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

_ENCRYPTED_COLUMN_SHAPE: tuple[tuple[str, type], ...] = (
    ("client_secret_nonce", sa.LargeBinary),
    ("client_secret_ciphertext", sa.LargeBinary),
    ("client_secret_tag", sa.LargeBinary),
    ("client_secret_key_version", sa.SmallInteger),
)


def test_encrypted_field_columns_have_expected_shape() -> None:
    """Static check — 4 columns with the canonical names and SQL types."""
    table = OIDCProvider.__table__
    for col_name, expected_type_cls in _ENCRYPTED_COLUMN_SHAPE:
        assert col_name in table.c, (
            f"OIDCProvider.{col_name} missing — EncryptedField('client_secret') "
            "should have produced it"
        )
        col = table.c[col_name]
        assert isinstance(col.type, expected_type_cls), (
            f"OIDCProvider.{col_name} has type {type(col.type).__name__}, "
            f"expected {expected_type_cls.__name__}"
        )
        assert cast("bool | None", col.nullable) is True, (
            f"OIDCProvider.{col_name} must be NULLABLE in v1 — Phase 3 "
            "follow-up tightens this after the cipher backfills"
        )


@pytest.mark.integration
async def test_encrypted_field_null_roundtrip(db_session: AsyncSession) -> None:
    """Insert with all 4 encrypted columns NULL; read back; assert NULLs."""
    provider = OIDCProvider(
        short_name="t-encrypted-null",
        issuer_url="https://issuer.example/",
        client_id="t-client",
        display_name="Test Encrypted Null",
        scope_list=["openid"],
        discovery_url="https://issuer.example/.well-known/openid-configuration",
        # All four EncryptedField columns intentionally omitted — they default to NULL.
    )
    db_session.add(provider)
    await db_session.flush()

    fetched = (
        await db_session.execute(
            select(OIDCProvider).where(OIDCProvider.short_name == "t-encrypted-null"),
        )
    ).scalar_one()

    assert fetched.client_secret_nonce is None
    assert fetched.client_secret_ciphertext is None
    assert fetched.client_secret_tag is None
    assert fetched.client_secret_key_version is None
