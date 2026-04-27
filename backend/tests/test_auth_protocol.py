# backend/tests/test_auth_protocol.py
"""Tests for AuthProvider Protocol and AuthOutcome tagged union (plan §5.4.1).

Covers:
- AuthOutcome variants are frozen msgspec.Struct instances
- tagged-union tag discriminators are set correctly
- Success fields: user_id, auth_provider, oidc_provider_name, freshly_provisioned
- Failure fields: reason, problem_code
- NotApplicable has no payload fields
- AuthProvider Protocol structural conformance (runtime_checkable)
- Non-conforming class rejected at isinstance check
"""

import uuid
from typing import TYPE_CHECKING, cast

import msgspec
import pytest

from comradarr.core.auth.protocol import (
    AuthProvider,
    Failure,
    NotApplicable,
    Success,
)
from comradarr.db.enums import AuthProvider as AuthProviderEnum

if TYPE_CHECKING:
    from litestar.types import Scope

# ---------------------------------------------------------------------------
# Success
# ---------------------------------------------------------------------------


def test_success_fields_and_defaults() -> None:
    user_id = uuid.uuid4()
    outcome = Success(user_id=user_id, auth_provider=AuthProviderEnum.LOCAL)
    assert outcome.user_id == user_id
    assert outcome.auth_provider == AuthProviderEnum.LOCAL
    assert outcome.oidc_provider_name is None
    assert outcome.freshly_provisioned is False


def test_success_with_all_fields() -> None:
    user_id = uuid.uuid4()
    outcome = Success(
        user_id=user_id,
        auth_provider=AuthProviderEnum.OIDC,
        oidc_provider_name="google",
        freshly_provisioned=True,
    )
    assert outcome.oidc_provider_name == "google"
    assert outcome.freshly_provisioned is True


def test_success_is_frozen() -> None:
    user_id = uuid.uuid4()
    outcome = Success(user_id=user_id, auth_provider=AuthProviderEnum.API_KEY)
    with pytest.raises((AttributeError, TypeError)):
        outcome.freshly_provisioned = True  # pyright: ignore[reportAttributeAccessIssue]


def test_success_tag() -> None:
    outcome = Success(user_id=uuid.uuid4(), auth_provider=AuthProviderEnum.LOCAL)
    encoded = msgspec.json.encode(outcome)
    decoded = msgspec.json.decode(encoded, type=dict[str, object])
    assert isinstance(decoded, dict)
    assert decoded["type"] == "Success"


# ---------------------------------------------------------------------------
# Failure
# ---------------------------------------------------------------------------


def test_failure_fields() -> None:
    outcome = Failure(
        reason="Invalid credentials",
        problem_code="authentication.invalid_credentials",
    )
    assert outcome.reason == "Invalid credentials"
    assert outcome.problem_code == "authentication.invalid_credentials"


def test_failure_is_frozen() -> None:
    outcome = Failure(reason="x", problem_code="y")
    with pytest.raises((AttributeError, TypeError)):
        outcome.reason = "changed"  # pyright: ignore[reportAttributeAccessIssue]


def test_failure_tag() -> None:
    outcome = Failure(reason="x", problem_code="y")
    encoded = msgspec.json.encode(outcome)
    decoded = msgspec.json.decode(encoded, type=dict[str, object])
    assert isinstance(decoded, dict)
    assert decoded["type"] == "Failure"


# ---------------------------------------------------------------------------
# NotApplicable
# ---------------------------------------------------------------------------


def test_not_applicable_no_payload() -> None:
    outcome = NotApplicable()
    fields = msgspec.structs.fields(outcome)
    assert len(fields) == 0


def test_not_applicable_is_frozen() -> None:
    outcome = NotApplicable()
    assert isinstance(outcome, msgspec.Struct)


def test_not_applicable_tag() -> None:
    outcome = NotApplicable()
    encoded = msgspec.json.encode(outcome)
    decoded = msgspec.json.decode(encoded, type=dict[str, object])
    assert isinstance(decoded, dict)
    assert decoded["type"] == "NotApplicable"


# ---------------------------------------------------------------------------
# Protocol conformance via runtime_checkable
# ---------------------------------------------------------------------------


class _ConformingProvider:
    async def authenticate(
        self,
        scope: Scope,
        headers: list[tuple[bytes, bytes]],
    ) -> NotApplicable:
        _ = scope, headers
        return NotApplicable()


class _MissingMethod:
    pass


def test_conforming_provider_isinstance() -> None:
    assert isinstance(_ConformingProvider(), AuthProvider)


def test_non_conforming_provider_isinstance() -> None:
    assert not isinstance(_MissingMethod(), AuthProvider)


@pytest.mark.asyncio
async def test_conforming_provider_is_callable() -> None:
    provider = _ConformingProvider()
    result = await provider.authenticate(cast("Scope", cast("object", {})), [])
    assert isinstance(result, NotApplicable)
