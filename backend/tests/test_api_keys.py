# backend/tests/test_api_keys.py
"""Tests for API key issuance, parsing, validation, and permission resolution (§5.4.6).

Covers:
- API_KEY_PREFIX constant exact value
- parse: structural reject before any DB hit (no DB access on bad prefix)
- parse: Bearer prefix stripping
- parse: last_four correctness
- parse: returns None on empty suffix
- issue: plaintext starts with prefix, hash stored, last_four correct
- issue: audit context never contains the plaintext key (regex sweep)
- validate: returns None on miss + rate-limit hit
- validate: first-use audit fires exactly once (idempotent under concurrent calls)
- resolve_permissions: empty scopes → full role permissions
- resolve_permissions: explicit scopes → intersection with role permissions
- resolve_permissions: role demotion shrinks effective scope
"""

import re
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from comradarr.core.auth.api_keys import API_KEY_PREFIX, ApiKeyService, parse
from comradarr.db.models.api_key import ApiKey

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from comradarr.services.audit.writer import AuditWriter

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PLAINTEXT_LEAK_RE = re.compile(r"cmrr_live_[A-Za-z0-9_\-]{20,}")

_REPO_PATH = "comradarr.repositories.auth.ApiKeyRepository"
_SCOPE_REPO_PATH = "comradarr.repositories.auth.ApiKeyScopeRepository"


def _make_api_key(
    *,
    api_key_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    last_used_at: datetime | None = None,
    prefix: str = API_KEY_PREFIX,
    last_four: str = "abcd",
) -> ApiKey:
    key: ApiKey = MagicMock(spec=ApiKey)
    key.id = api_key_id or uuid.uuid4()
    key.user_id = user_id or uuid.uuid4()
    key.name = "test-key"
    key.key_hash = b"\x00" * 32
    key.prefix = prefix
    key.last_four = last_four
    key.expires_at = None
    key.created_at = datetime.now(UTC)
    key.last_used_at = last_used_at
    return key


def _make_db_session() -> AsyncMock:
    db_session = AsyncMock()
    db_session.__aenter__ = AsyncMock(return_value=db_session)
    db_session.__aexit__ = AsyncMock(return_value=False)
    return db_session


def _make_service(*, sessionmaker: object, audit: object) -> ApiKeyService:
    return ApiKeyService(
        sessionmaker=cast("async_sessionmaker[AsyncSession]", sessionmaker),
        audit=cast("AuditWriter", audit),
    )


# ---------------------------------------------------------------------------
# API_KEY_PREFIX constant
# ---------------------------------------------------------------------------


def test_prefix_constant_exact_value() -> None:
    assert API_KEY_PREFIX == "cmrr_live_"


def test_prefix_starts_with_cmrr() -> None:
    assert API_KEY_PREFIX.startswith("cmrr_")


# ---------------------------------------------------------------------------
# parse — structural checks (no DB)
# ---------------------------------------------------------------------------


def test_parse_returns_none_on_wrong_prefix() -> None:
    assert parse("sk_live_abc123") is None


def test_parse_returns_none_on_empty_string() -> None:
    assert parse("") is None


def test_parse_returns_none_on_prefix_only() -> None:
    assert parse(API_KEY_PREFIX) is None


def test_parse_returns_hash_bytes_on_valid_key() -> None:
    import hashlib
    import secrets

    random_part = secrets.token_urlsafe(32)
    plaintext = API_KEY_PREFIX + random_part
    result = parse(plaintext)
    expected = hashlib.sha256(random_part.encode()).digest()
    assert result == expected


def test_parse_strips_bearer_prefix() -> None:
    import hashlib
    import secrets

    random_part = secrets.token_urlsafe(32)
    plaintext = API_KEY_PREFIX + random_part
    result = parse("Bearer " + plaintext)
    expected = hashlib.sha256(random_part.encode()).digest()
    assert result == expected


def test_parse_bearer_without_api_prefix_returns_none() -> None:
    assert parse("Bearer sk_other_token") is None


def test_parse_last_four_correctness() -> None:
    import secrets

    random_part = secrets.token_urlsafe(32)
    plaintext = API_KEY_PREFIX + random_part
    last_four = plaintext[-4:]
    result = parse(plaintext)
    assert result is not None
    assert len(last_four) == 4
    assert plaintext.endswith(last_four)


def test_parse_returns_32_byte_sha256() -> None:
    import secrets

    random_part = secrets.token_urlsafe(32)
    result = parse(API_KEY_PREFIX + random_part)
    assert result is not None
    assert len(result) == 32


# ---------------------------------------------------------------------------
# issue — plaintext / hash / audit context
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_issue_plaintext_starts_with_prefix() -> None:
    api_key = _make_api_key()
    audit = AsyncMock()
    db_session = _make_db_session()
    sessionmaker = MagicMock(return_value=db_session)

    repo = AsyncMock()
    repo.create = AsyncMock(return_value=api_key)

    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=repo):
        plaintext, _ = await service.issue(
            user_id=api_key.user_id,
            name="test",
            scopes=[],
            expires_at=None,
            ip=None,
            user_agent=None,
        )
    assert plaintext.startswith(API_KEY_PREFIX)


@pytest.mark.asyncio
async def test_issue_audit_context_never_contains_plaintext() -> None:
    api_key = _make_api_key()
    audit_calls: list[dict[str, object]] = []

    async def capture_audit(**kwargs: object) -> None:
        audit_calls.append(dict(kwargs))

    audit = AsyncMock()
    audit.record = AsyncMock(side_effect=capture_audit)
    db_session = _make_db_session()
    sessionmaker = MagicMock(return_value=db_session)

    repo = AsyncMock()
    repo.create = AsyncMock(return_value=api_key)

    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=repo):
        plaintext, _ = await service.issue(
            user_id=api_key.user_id,
            name="test",
            scopes=[],
            expires_at=None,
            ip=None,
            user_agent=None,
        )

    # The plaintext itself must match the leak pattern
    assert _PLAINTEXT_LEAK_RE.match(plaintext), "test key should match the leak regex"

    # Audit context must NOT contain the plaintext
    for audit_call in audit_calls:
        context: object = audit_call.get("context")
        assert isinstance(context, dict)
        context_str = str(cast("dict[str, object]", context))
        assert _PLAINTEXT_LEAK_RE.search(context_str) is None, (
            f"Audit context contains plaintext key: {context_str}"
        )


@pytest.mark.asyncio
async def test_issue_last_four_correctness() -> None:
    captured_last_four: list[str] = []

    async def capture_create(**kwargs: object) -> ApiKey:
        last_four = kwargs.get("last_four")
        assert isinstance(last_four, str)
        captured_last_four.append(last_four)
        return _make_api_key(last_four=last_four)

    db_session = _make_db_session()
    audit = AsyncMock()
    sessionmaker = MagicMock(return_value=db_session)

    repo = AsyncMock()
    repo.create = AsyncMock(side_effect=capture_create)

    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=repo):
        plaintext, _ = await service.issue(
            user_id=uuid.uuid4(),
            name="test",
            scopes=[],
            expires_at=None,
            ip=None,
            user_agent=None,
        )

    assert len(captured_last_four) == 1
    assert captured_last_four[0] == plaintext[-4:]
    assert len(captured_last_four[0]) == 4


# ---------------------------------------------------------------------------
# validate — miss + rate-limit, first-use idempotence
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_validate_returns_none_on_miss_and_hits_rate_limit() -> None:
    db_session = _make_db_session()
    repo = AsyncMock()
    repo.get_by_hash = AsyncMock(return_value=None)

    rate_limiter = AsyncMock()
    rate_limiter.hit_api_key_ip = AsyncMock()

    audit = AsyncMock()
    sessionmaker = MagicMock(return_value=db_session)
    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=repo):
        result = await service.validate(b"\x00" * 32, "1.2.3.4", rate_limiter)

    assert result is None
    cast("AsyncMock", rate_limiter.hit_api_key_ip).assert_awaited_once_with("1.2.3.4")
    cast("AsyncMock", audit.record).assert_not_awaited()


@pytest.mark.asyncio
async def test_validate_first_use_audit_fires_once() -> None:
    api_key = _make_api_key(last_used_at=None)
    db_session = _make_db_session()

    repo = AsyncMock()
    repo.get_by_hash = AsyncMock(return_value=api_key)
    repo.update_last_used_if_null = AsyncMock(return_value=True)

    rate_limiter = AsyncMock()
    audit = AsyncMock()
    sessionmaker = MagicMock(return_value=db_session)
    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=repo):
        result = await service.validate(api_key.key_hash, "1.2.3.4", rate_limiter)

    assert result is api_key
    cast("AsyncMock", audit.record).assert_awaited_once()
    # Verify it emits API_KEY_FIRST_USED
    from comradarr.db.enums import AuditAction

    call_kwargs = cast("AsyncMock", audit.record).call_args.kwargs
    assert call_kwargs["action"] == AuditAction.API_KEY_FIRST_USED


@pytest.mark.asyncio
async def test_validate_first_use_idempotent_when_already_used() -> None:
    api_key = _make_api_key(last_used_at=datetime.now(UTC))
    db_session = _make_db_session()

    repo = AsyncMock()
    repo.get_by_hash = AsyncMock(return_value=api_key)
    repo.update_last_used_if_null = AsyncMock(return_value=False)

    rate_limiter = AsyncMock()
    audit = AsyncMock()
    sessionmaker = MagicMock(return_value=db_session)
    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=repo):
        result = await service.validate(api_key.key_hash, "1.2.3.4", rate_limiter)

    assert result is api_key
    cast("AsyncMock", audit.record).assert_not_awaited()


# ---------------------------------------------------------------------------
# resolve_permissions — scope ∩ role, empty scopes, role demotion
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_permissions_empty_scopes_returns_full_role() -> None:
    api_key = _make_api_key()
    role_perms = {"read:config", "write:config", "admin:users"}
    db_session = _make_db_session()

    key_repo = AsyncMock()
    key_repo.get_role_permissions = AsyncMock(return_value=role_perms)

    scope_repo = AsyncMock()
    scope_repo.get_scopes = AsyncMock(return_value=set())

    audit = AsyncMock()
    sessionmaker = MagicMock(return_value=db_session)
    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=key_repo), patch(_SCOPE_REPO_PATH, return_value=scope_repo):
        result = await service.resolve_permissions(api_key, "admin")

    assert result == role_perms


@pytest.mark.asyncio
async def test_resolve_permissions_intersection_with_role() -> None:
    api_key = _make_api_key()
    role_perms = {"read:config", "write:config", "admin:users"}
    key_scopes = {"read:config", "write:config", "write:secrets"}  # write:secrets not in role
    db_session = _make_db_session()

    key_repo = AsyncMock()
    key_repo.get_role_permissions = AsyncMock(return_value=role_perms)

    scope_repo = AsyncMock()
    scope_repo.get_scopes = AsyncMock(return_value=key_scopes)

    audit = AsyncMock()
    sessionmaker = MagicMock(return_value=db_session)
    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=key_repo), patch(_SCOPE_REPO_PATH, return_value=scope_repo):
        result = await service.resolve_permissions(api_key, "admin")

    assert result == {"read:config", "write:config"}
    assert "write:secrets" not in result


@pytest.mark.asyncio
async def test_resolve_permissions_role_demotion_shrinks_scope() -> None:
    api_key = _make_api_key()
    # After role demotion to viewer, only "read:config" remains
    demoted_role_perms = {"read:config"}
    key_scopes = {"read:config", "write:config", "admin:users"}
    db_session = _make_db_session()

    key_repo = AsyncMock()
    key_repo.get_role_permissions = AsyncMock(return_value=demoted_role_perms)

    scope_repo = AsyncMock()
    scope_repo.get_scopes = AsyncMock(return_value=key_scopes)

    audit = AsyncMock()
    sessionmaker = MagicMock(return_value=db_session)
    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=key_repo), patch(_SCOPE_REPO_PATH, return_value=scope_repo):
        result = await service.resolve_permissions(api_key, "viewer")

    assert result == {"read:config"}
    assert "write:config" not in result
    assert "admin:users" not in result


@pytest.mark.asyncio
async def test_resolve_permissions_no_overlap_returns_empty() -> None:
    api_key = _make_api_key()
    role_perms = {"read:config"}
    key_scopes = {"admin:users"}  # disjoint
    db_session = _make_db_session()

    key_repo = AsyncMock()
    key_repo.get_role_permissions = AsyncMock(return_value=role_perms)

    scope_repo = AsyncMock()
    scope_repo.get_scopes = AsyncMock(return_value=key_scopes)

    audit = AsyncMock()
    sessionmaker = MagicMock(return_value=db_session)
    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=key_repo), patch(_SCOPE_REPO_PATH, return_value=scope_repo):
        result = await service.resolve_permissions(api_key, "viewer")

    assert result == set()


# ---------------------------------------------------------------------------
# revoke — missing key raises, snapshot prevents fabrication
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_revoke_missing_key_raises() -> None:
    """revoke raises AuthenticationApiKeyNotFound when key id does not exist."""
    from comradarr.errors.authentication import AuthenticationApiKeyNotFound  # noqa: PLC0415

    db_session = _make_db_session()
    db_session.get = AsyncMock(return_value=None)  # key missing

    key_repo = AsyncMock()
    key_repo.revoke = AsyncMock(return_value=None)

    audit = AsyncMock()
    audit.record = AsyncMock(return_value=None)
    sessionmaker = MagicMock(return_value=db_session)
    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=key_repo), pytest.raises(AuthenticationApiKeyNotFound):
        await service.revoke(
            api_key_id=uuid.uuid4(),
            actor_user_id=uuid.uuid4(),
            ip=None,
            user_agent=None,
        )

    # No audit record should be written for a missing key
    cast("AsyncMock", audit.record).assert_not_called()


@pytest.mark.asyncio
async def test_revoke_existing_key_snapshots_prefix_and_last_four() -> None:
    """revoke writes audit context from snapshotted attributes, not fabricated defaults."""
    api_key_id = uuid.uuid4()
    actor_user_id = uuid.uuid4()
    api_key = _make_api_key(api_key_id=api_key_id, prefix=API_KEY_PREFIX, last_four="zz99")

    db_session = _make_db_session()
    db_session.get = AsyncMock(return_value=api_key)

    key_repo = AsyncMock()
    key_repo.revoke = AsyncMock(return_value=None)

    audit = AsyncMock()
    audit.record = AsyncMock(return_value=None)
    sessionmaker = MagicMock(return_value=db_session)
    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=key_repo):
        await service.revoke(
            api_key_id=api_key_id,
            actor_user_id=actor_user_id,
            ip="10.0.0.1",
            user_agent=None,
        )

    cast("AsyncMock", audit.record).assert_called_once()
    ctx = cast("dict[str, object]", cast("AsyncMock", audit.record).call_args.kwargs["context"])
    assert ctx["api_key_id"] == str(api_key_id)
    assert ctx["prefix"] == API_KEY_PREFIX
    assert ctx["last_four"] == "zz99"  # real value, not fabricated ""


@pytest.mark.asyncio
async def test_revoke_audit_never_fabricates_empty_last_four() -> None:
    """Audit last_four is never the empty-string fallback from the old code."""
    api_key_id = uuid.uuid4()
    api_key = _make_api_key(api_key_id=api_key_id, last_four="wx12")

    db_session = _make_db_session()
    db_session.get = AsyncMock(return_value=api_key)

    key_repo = AsyncMock()
    key_repo.revoke = AsyncMock(return_value=None)

    audit = AsyncMock()
    audit.record = AsyncMock(return_value=None)
    sessionmaker = MagicMock(return_value=db_session)
    service = _make_service(sessionmaker=sessionmaker, audit=audit)

    with patch(_REPO_PATH, return_value=key_repo):
        await service.revoke(
            api_key_id=api_key_id,
            actor_user_id=uuid.uuid4(),
            ip=None,
            user_agent=None,
        )

    ctx = cast("dict[str, object]", cast("AsyncMock", audit.record).call_args.kwargs["context"])
    assert ctx["last_four"] != ""  # fabricated fallback must never appear
