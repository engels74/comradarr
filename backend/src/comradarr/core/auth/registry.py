# backend/src/comradarr/core/auth/registry.py
"""AuthProviderRegistry — ordered provider list per PRD §15 "cheapest first".

The registry is consulted by ``auth_middleware`` for every inbound request.
Providers are tried in order; the first ``Success`` or ``Failure`` outcome
terminates the chain. ``NotApplicable`` advances to the next provider.
When all providers return ``NotApplicable`` the registry returns
``NotApplicable`` so the middleware can treat the request as anonymous.

Canonical ordering (cheapest-first per PRD §15):
  1. ApiKeyProvider         — O(1) hash lookup, no session state
  2. CookieSessionValidator — single DB row by token-hash
  3. TrustedHeaderProvider  — header read + CIDR allowlist check, no DB
  4. OIDCCallbackProvider   — callback endpoint only; heavy JWKS ops gated
  5. LocalPasswordController — Argon2id verify; most expensive last

The ordering is enforced by the list literal in ``AuthProviderRegistry``;
there is no dynamic insertion. Phase 4 Slice K wires concrete instances at
lifespan time and sets ``app.state.auth_registry``.

RULE-PY-002: No ``from __future__ import annotations`` (PEP 649 default).
RULE-PY-003: No ``Any``.
"""

from collections.abc import Sequence  # noqa: TC003 — runtime use: __init__ parameter annotation
from typing import TYPE_CHECKING

import structlog

from comradarr.core.auth.protocol import AuthOutcome, AuthProvider, NotApplicable

if TYPE_CHECKING:
    from litestar.types import Scope

_logger = structlog.stdlib.get_logger(__name__)


class AuthProviderRegistry:
    """Ordered sequence of :class:`AuthProvider` instances.

    Instances are built at lifespan time with concrete provider objects
    supplied in PRD §15 order. The registry itself is stateless beyond
    holding the list reference — it is safe to share across requests.
    """

    def __init__(self, providers: Sequence[AuthProvider]) -> None:
        self._providers: Sequence[AuthProvider] = providers

    async def authenticate(
        self,
        scope: Scope,
        headers: list[tuple[bytes, bytes]],
    ) -> AuthOutcome:
        """Try each provider in order; return first non-``NotApplicable`` outcome.

        If every provider returns ``NotApplicable`` (e.g. anonymous health-check
        request with no credentials), the registry itself returns
        ``NotApplicable`` so the middleware can decide how to handle unauthenticated
        access (public endpoint → allow; protected → 401).
        """
        for provider in self._providers:
            outcome = await provider.authenticate(scope, headers)
            if not isinstance(outcome, NotApplicable):
                return outcome
            _logger.debug(
                "auth.registry.provider.not_applicable",
                provider=type(provider).__name__,
            )
        return NotApplicable()

    @property
    def providers(self) -> list[AuthProvider]:
        """Ordered provider list (read-only view for introspection/tests)."""
        return list(self._providers)
