# backend/src/comradarr/core/auth/protocol.py
"""AuthProvider Protocol and AuthOutcome tagged union (plan §5.4.1).

``AuthOutcome`` is a ``msgspec.Struct`` tagged union — each variant carries
a ``tag`` discriminator so msgspec can decode an encoded outcome without
ambiguity. The three variants map directly to the registry semantics:

* ``Success`` — identity resolved; carry forward to middleware/session mint.
* ``Failure`` — identity attempted but credentials invalid; return 401.
* ``NotApplicable`` — this provider cannot handle this request; registry
  continues to the next provider in order.

``AuthProvider`` is a ``typing.Protocol`` so concrete providers (local,
trusted-header, OIDC, API-key, session-cookie) can be plain classes without
inheriting from a base class. basedpyright structural subtyping validates
conformance at each call site that accepts ``AuthProvider``.

RULE-PY-002: No ``from __future__ import annotations`` (PEP 649 default).
RULE-PY-003: No ``Any``.
RULE-SER-001/002: msgspec.Struct frozen kw_only for all DTOs.
"""

import uuid  # noqa: TC003 — runtime use: uuid.UUID field in Success struct
from typing import TYPE_CHECKING, Protocol, runtime_checkable

import msgspec

from comradarr.db.enums import (
    AuthProvider as AuthProviderEnum,  # noqa: TC001 — runtime: enum field in Success struct
)

if TYPE_CHECKING:
    from litestar.types import Scope


class Success(msgspec.Struct, frozen=True, kw_only=True, tag=True):
    """Credential resolved to a known user identity."""

    user_id: uuid.UUID
    auth_provider: AuthProviderEnum
    oidc_provider_name: str | None = None
    freshly_provisioned: bool = False


class Failure(msgspec.Struct, frozen=True, kw_only=True, tag=True):
    """Credential was presented but could not be verified."""

    reason: str
    problem_code: str


class NotApplicable(msgspec.Struct, frozen=True, kw_only=True, tag=True):
    """This provider cannot handle the request; registry tries the next one."""


AuthOutcome = Success | Failure | NotApplicable


@runtime_checkable
class AuthProvider(Protocol):
    """Structural protocol every auth provider must satisfy.

    The ``scope`` gives access to peer address and request metadata; the
    ``headers`` list carries the raw bytes pairs from the ASGI scope so
    providers can inspect Authorization, Cookie, X-* headers without
    touching the Litestar request abstraction (the protocol sits below the
    routing layer, in middleware).
    """

    async def authenticate(
        self,
        scope: Scope,
        headers: list[tuple[bytes, bytes]],
    ) -> AuthOutcome: ...
