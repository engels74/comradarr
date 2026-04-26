"""EncryptedField column-shape + NULL roundtrip + crypto-bound writers (plan §5.3.6).

Four behavioral contracts split into two layers:

1. **Static column-shape** (no DB) — :class:`OIDCProvider` exposes the four
   columns the :func:`EncryptedField` helper produces, with the names
   ``client_secret_{nonce,ciphertext,tag,key_version}`` and SQL types
   ``LargeBinary, LargeBinary, LargeBinary, SmallInteger``. This locks the
   schema contract Phase 3 (AES-256-GCM rollout) depends on without needing
   a live database.
2. **NULL roundtrip** (DB) — insert an ``OIDCProvider`` with all four
   encrypted columns left NULL, read it back, assert the columns come out
   NULL.
3. **Connector + AppSecret round-trip** (DB + crypto) — the M6 gate. Insert
   a connector with a :class:`Secret[bytes]` API key, fetch through a fresh
   session, decode, assert the recovered plaintext matches the original.
   Same shape against :class:`AppSecret` via :class:`AppSecretsRepository`.
4. **AAD swap fails** (DB + crypto) — copy the four ciphertext columns from
   one connector row onto another and attempt to decrypt under the second
   row's id. AES-GCM authenticates the AAD ``connectors:<row_id>:api_key``,
   so the swap MUST raise :class:`CryptoAuthenticationFailed`. This is the
   behavioral proof that the codec's AAD discipline is not just structural.

The roundtrip is wired through the ``db_session`` fixture (savepoint-rollback
isolation per RECIPE-PYTEST-DB). Marked ``integration`` so a unit-only run
skips the DB-bound cases.
"""

import hashlib
import uuid
from types import SimpleNamespace
from typing import TYPE_CHECKING, cast

import pytest
import sqlalchemy as sa
from sqlalchemy import select

from comradarr.core.crypto import CryptoService
from comradarr.core.types import Secret
from comradarr.db.enums import ConnectorType
from comradarr.db.models.app_config import AppSecret
from comradarr.db.models.connector import Connector
from comradarr.db.models.oidc_provider import OIDCProvider
from comradarr.errors.crypto import CryptoAuthenticationFailed
from comradarr.repositories.app_secrets import AppSecretsRepository
from comradarr.repositories.connector import ConnectorRepository

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from comradarr.config import Settings

_ENCRYPTED_COLUMN_SHAPE: tuple[tuple[str, type], ...] = (
    ("client_secret_nonce", sa.LargeBinary),
    ("client_secret_ciphertext", sa.LargeBinary),
    ("client_secret_tag", sa.LargeBinary),
    ("client_secret_key_version", sa.SmallInteger),
)


def _build_crypto_service() -> CryptoService:
    """Build a deterministic single-key CryptoService for round-trip tests.

    The key is the SHA-256 of a stable seed — this gives us a 32-byte AES-256
    key without burning real entropy. The stub registry mirrors the shape the
    :class:`Settings` object exposes to :class:`CryptoService.__init__`
    (``secret_key_versions`` + ``current_key_version``); we don't need a
    full Settings instance because nothing else on it is read here.

    The fixture in ``tests/crypto/conftest.py`` follows the same recipe but
    is scoped to the crypto-test directory. Inlining the factory here keeps
    tests/db/ independent of cross-directory fixture inheritance.
    """
    versions = {1: hashlib.sha256(b"phase3-test-key-encrypted-field-suite").digest()}
    stub = SimpleNamespace(secret_key_versions=versions, current_key_version=1)
    return CryptoService(cast("Settings", cast("object", stub)))


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


@pytest.mark.integration
async def test_connector_api_key_round_trip(db_session: AsyncSession) -> None:
    """ConnectorRepository.add() encrypts; .get_api_key() decrypts back to the same Secret."""
    crypto = _build_crypto_service()
    repo = ConnectorRepository(db_session, crypto)

    inserted = await repo.add(
        name="t-connector-roundtrip",
        type=ConnectorType.SONARR,
        url="https://sonarr.example",
        api_key=Secret(b"k1"),
    )

    # Fetch through a separate query path — round-trip must survive going
    # through the row's stored bytes, not the in-memory ORM identity.
    db_session.expunge_all()
    recovered = await repo.get_api_key(inserted.id)

    assert recovered is not None
    assert recovered.expose() == b"k1"


@pytest.mark.integration
async def test_app_secrets_round_trip(db_session: AsyncSession) -> None:
    """AppSecretsRepository.put() then .get() returns the original Secret bytes.

    Covers both AAD shapes: the canonical ``app_secrets:<key>:value`` and the
    grandfathered ``app_config:setup_claim:proof`` for the bootstrap-claim row.
    """
    crypto = _build_crypto_service()
    repo = AppSecretsRepository(db_session, crypto)

    # Canonical-AAD path.
    await repo.put("oauth_state_signing", Secret(b"signing-bytes"))
    db_session.expunge_all()
    recovered_canonical = await repo.get("oauth_state_signing")
    assert recovered_canonical is not None
    assert recovered_canonical.expose() == b"signing-bytes"

    # Grandfathered setup-claim AAD path — same .put/.get surface, different
    # AAD bytes under the hood. If the AAD selector regresses, decryption
    # raises CryptoAuthenticationFailed instead of silently round-tripping.
    await repo.put("setup_claim", Secret(b"proof-bytes"))
    db_session.expunge_all()
    recovered_setup = await repo.get("setup_claim")
    assert recovered_setup is not None
    assert recovered_setup.expose() == b"proof-bytes"


@pytest.mark.integration
async def test_decryption_fails_on_aad_swap(db_session: AsyncSession) -> None:
    """Ciphertext copied between rows fails to decrypt — proves AAD enforcement."""
    crypto = _build_crypto_service()
    repo = ConnectorRepository(db_session, crypto)

    row_a = await repo.add(
        name="t-aad-swap-a",
        type=ConnectorType.SONARR,
        url="https://a.example",
        api_key=Secret(b"secret-a"),
    )
    row_b = await repo.add(
        name="t-aad-swap-b",
        type=ConnectorType.SONARR,
        url="https://b.example",
        api_key=Secret(b"secret-b"),
    )

    # Splice row_a's four ciphertext columns onto row_b without changing
    # row_b's id. Decoding via row_b's id rebuilds the AAD as
    # ``connectors:<row_b.id>:api_key`` — but the ciphertext was sealed with
    # row_a's id, so AES-GCM authentication MUST fail.
    fetched_a = await db_session.get(Connector, row_a.id)
    assert fetched_a is not None
    nonce_a = fetched_a.api_key_nonce
    ciphertext_a = fetched_a.api_key_ciphertext
    tag_a = fetched_a.api_key_tag
    key_version_a = fetched_a.api_key_key_version

    fetched_b = await db_session.get(Connector, row_b.id)
    assert fetched_b is not None
    fetched_b.api_key_nonce = nonce_a
    fetched_b.api_key_ciphertext = ciphertext_a
    fetched_b.api_key_tag = tag_a
    fetched_b.api_key_key_version = key_version_a
    await db_session.flush()
    db_session.expunge_all()

    with pytest.raises(CryptoAuthenticationFailed):
        _ = await repo.get_api_key(row_b.id)


@pytest.mark.integration
async def test_app_secret_partial_null_raises(db_session: AsyncSession) -> None:
    """Partial-NULL value_* columns must raise CryptoError, not return None.

    The codec contract (db/encrypted.py) treats ALL-NULL as "not stored" and
    returns None; SOME-NULL is corruption and must surface loudly. This test
    asserts AppSecretsRepository.get() honors that distinction.
    """
    from datetime import UTC, datetime

    from comradarr.errors.crypto import CryptoError

    crypto = _build_crypto_service()
    repo = AppSecretsRepository(db_session, crypto)

    # Construct a deliberately corrupt row: 3-of-4 columns populated.
    db_session.add(
        AppSecret(
            key="t-partial-null",
            value_nonce=b"\x00" * 12,
            value_ciphertext=b"\x00" * 8,
            value_tag=b"\x00" * 16,
            value_key_version=None,  # the deliberate hole
            updated_at=datetime.now(UTC),
        ),
    )
    await db_session.flush()
    db_session.expunge_all()

    with pytest.raises(CryptoError):
        _ = await repo.get("t-partial-null")


@pytest.mark.integration
async def test_app_secrets_get_missing_returns_none(db_session: AsyncSession) -> None:
    """A get() on an absent key returns None — no exception, no row insert."""
    crypto = _build_crypto_service()
    repo = AppSecretsRepository(db_session, crypto)

    assert await repo.get(f"absent-key-{uuid.uuid4().hex}") is None
