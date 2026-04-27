# backend/tests/test_auth_registry.py
"""Tests for AuthProviderRegistry (plan §5.4.1).

Covers:
- NotApplicable-skip semantics: registry advances past NotApplicable providers
- Order-determinism: first non-NotApplicable outcome wins
- All-NotApplicable: registry returns NotApplicable
- Success short-circuits: subsequent providers are never called
- Failure short-circuits: subsequent providers are never called
- providers property returns a copy of the ordered list
"""

import uuid
from typing import TYPE_CHECKING, cast

import pytest

from comradarr.core.auth.protocol import (
    AuthOutcome,
    Failure,
    NotApplicable,
    Success,
)
from comradarr.core.auth.registry import AuthProviderRegistry
from comradarr.db.enums import AuthProvider as AuthProviderEnum

if TYPE_CHECKING:
    from litestar.types import Scope

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _StubProvider:
    """Configurable stub that returns a preset outcome and records call count."""

    _outcome: AuthOutcome
    call_count: int

    def __init__(self, outcome: AuthOutcome) -> None:
        self._outcome = outcome
        self.call_count = 0

    async def authenticate(
        self,
        scope: Scope,
        headers: list[tuple[bytes, bytes]],
    ) -> AuthOutcome:
        _ = scope, headers
        self.call_count += 1
        return self._outcome


_SCOPE: Scope = cast("Scope", cast("object", {}))
_HEADERS: list[tuple[bytes, bytes]] = []

_SUCCESS = Success(user_id=uuid.uuid4(), auth_provider=AuthProviderEnum.API_KEY)
_FAILURE = Failure(reason="bad creds", problem_code="authentication.invalid_credentials")
_NOT_APPLICABLE = NotApplicable()


# ---------------------------------------------------------------------------
# NotApplicable-skip semantics
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_skips_not_applicable_and_returns_success() -> None:
    na1 = _StubProvider(_NOT_APPLICABLE)
    na2 = _StubProvider(_NOT_APPLICABLE)
    success = _StubProvider(_SUCCESS)

    registry = AuthProviderRegistry([na1, na2, success])
    outcome = await registry.authenticate(_SCOPE, _HEADERS)

    assert outcome == _SUCCESS
    assert na1.call_count == 1
    assert na2.call_count == 1
    assert success.call_count == 1


@pytest.mark.asyncio
async def test_skips_not_applicable_and_returns_failure() -> None:
    na = _StubProvider(_NOT_APPLICABLE)
    failure = _StubProvider(_FAILURE)
    never = _StubProvider(_SUCCESS)

    registry = AuthProviderRegistry([na, failure, never])
    outcome = await registry.authenticate(_SCOPE, _HEADERS)

    assert outcome == _FAILURE
    assert na.call_count == 1
    assert failure.call_count == 1
    assert never.call_count == 0


# ---------------------------------------------------------------------------
# Order-determinism: first non-NotApplicable wins
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_first_success_wins() -> None:
    success1 = _StubProvider(_SUCCESS)
    success2_id = uuid.uuid4()
    success2 = _StubProvider(Success(user_id=success2_id, auth_provider=AuthProviderEnum.LOCAL))

    registry = AuthProviderRegistry([success1, success2])
    outcome = await registry.authenticate(_SCOPE, _HEADERS)

    assert outcome == _SUCCESS
    assert success1.call_count == 1
    assert success2.call_count == 0


@pytest.mark.asyncio
async def test_order_is_deterministic_across_calls() -> None:
    na = _StubProvider(_NOT_APPLICABLE)
    success = _StubProvider(_SUCCESS)
    registry = AuthProviderRegistry([na, success])

    for _ in range(5):
        outcome = await registry.authenticate(_SCOPE, _HEADERS)
        assert outcome == _SUCCESS


# ---------------------------------------------------------------------------
# All NotApplicable → registry returns NotApplicable
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_all_not_applicable_returns_not_applicable() -> None:
    providers = [_StubProvider(_NOT_APPLICABLE) for _ in range(3)]
    registry = AuthProviderRegistry(providers)

    outcome = await registry.authenticate(_SCOPE, _HEADERS)

    assert isinstance(outcome, NotApplicable)
    for p in providers:
        assert p.call_count == 1


@pytest.mark.asyncio
async def test_empty_registry_returns_not_applicable() -> None:
    registry = AuthProviderRegistry([])
    outcome = await registry.authenticate(_SCOPE, _HEADERS)
    assert isinstance(outcome, NotApplicable)


# ---------------------------------------------------------------------------
# Short-circuit: Success stops the chain
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_success_short_circuits_remaining_providers() -> None:
    success = _StubProvider(_SUCCESS)
    never1 = _StubProvider(_FAILURE)
    never2 = _StubProvider(_NOT_APPLICABLE)

    registry = AuthProviderRegistry([success, never1, never2])
    outcome = await registry.authenticate(_SCOPE, _HEADERS)

    assert outcome == _SUCCESS
    assert success.call_count == 1
    assert never1.call_count == 0
    assert never2.call_count == 0


# ---------------------------------------------------------------------------
# Short-circuit: Failure stops the chain
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_failure_short_circuits_remaining_providers() -> None:
    failure = _StubProvider(_FAILURE)
    never = _StubProvider(_SUCCESS)

    registry = AuthProviderRegistry([failure, never])
    outcome = await registry.authenticate(_SCOPE, _HEADERS)

    assert outcome == _FAILURE
    assert failure.call_count == 1
    assert never.call_count == 0


# ---------------------------------------------------------------------------
# providers property
# ---------------------------------------------------------------------------


def test_providers_property_returns_copy() -> None:
    p1 = _StubProvider(_NOT_APPLICABLE)
    p2 = _StubProvider(_SUCCESS)
    registry = AuthProviderRegistry([p1, p2])

    providers_view = registry.providers
    assert providers_view == [p1, p2]

    # Mutating the copy does not affect the registry
    providers_view.clear()
    assert len(registry.providers) == 2


def test_providers_property_preserves_order() -> None:
    stubs = [_StubProvider(_NOT_APPLICABLE) for _ in range(5)]
    registry = AuthProviderRegistry(stubs)
    assert registry.providers == stubs
