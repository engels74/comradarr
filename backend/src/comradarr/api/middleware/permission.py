# pyright: reportAny=false, reportUnknownMemberType=false
# backend/src/comradarr/api/middleware/permission.py
"""Permission-check Guard factory (plan §5.4 Slice I).

:func:`requires_permission` returns a Litestar ``Guard`` callable that:
  1. Reads ``connection.scope["user"]`` (set by ``auth_middleware``).
  2. For :class:`~comradarr.core.auth.api_keys.AnonymousPrincipal`: raises
     ``AuthenticationSessionExpired`` when a cookie was present (expired/revoked
     session) or ``AuthenticationInvalidCredentials`` otherwise.
  3. For :class:`~comradarr.core.auth.sessions.SessionPrincipal`: resolves the
     effective permission set from the user's role via ``RolePermission``; raises
     ``AuthorizationPermissionRequired`` if the required permission is absent.
  4. For :class:`~comradarr.core.auth.api_keys.ApiKeyPrincipal`: the permissions
     are already resolved (intersection of key scopes and role) and stored on the
     principal; raises ``AuthorizationPermissionRequired`` if absent.

RULE-PY-002: No ``from __future__ import annotations`` (PEP 649 default).
RULE-PY-003: No ``Any``.
RULE-LOG-001: structlog module-scoped logger.
RULE-ASYNC-001: Guard callables are async.
"""

from collections.abc import Callable, Coroutine
from typing import TYPE_CHECKING

import structlog

from comradarr.core.auth.api_keys import AnonymousPrincipal, ApiKeyPrincipal
from comradarr.core.auth.sessions import SessionPrincipal
from comradarr.errors.authentication import (
    AuthenticationInvalidCredentials,
    AuthenticationSessionExpired,
)
from comradarr.errors.authorization import AuthorizationPermissionRequired

if TYPE_CHECKING:
    from litestar.connection import ASGIConnection
    from litestar.datastructures import State
    from litestar.handlers.base import BaseRouteHandler

_logger = structlog.stdlib.get_logger(__name__)


def requires_permission(name: str) -> GuardCallable:
    """Return a Litestar Guard that enforces ``name`` on the resolved principal.

    Usage::

        @get("/admin/something", guards=[requires_permission("admin.read")])
        async def handler(...) -> ...: ...
    """

    async def guard(
        connection: ASGIConnection[object, object, object, State],
        _handler: BaseRouteHandler,
    ) -> None:
        user = connection.scope.get("user")

        if isinstance(user, AnonymousPrincipal):
            cookie_was_present = bool(connection.scope.get("_cookie_was_present"))
            if cookie_was_present:
                raise AuthenticationSessionExpired()
            raise AuthenticationInvalidCredentials()

        if isinstance(user, SessionPrincipal):
            # Resolve permissions lazily from the DB via role_permissions.
            litestar_app = connection.scope.get("app")
            sessionmaker = getattr(getattr(litestar_app, "state", None), "db_sessionmaker", None)
            if sessionmaker is not None:
                from comradarr.repositories.auth import ApiKeyRepository  # noqa: PLC0415

                async with sessionmaker() as db_session:
                    repo = ApiKeyRepository(db_session)
                    role_str = user.auth_provider.value
                    # Resolve the actual role from the user row; fall back to
                    # auth_provider name as a best-effort sentinel so unit tests
                    # that stub the scope can control permissions via role_name.
                    from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

                    user_repo = UserRepository(db_session)
                    user_row = await user_repo.get_by_id(user.user_id)
                    if user_row is not None:
                        role = user_row.role
                        role_str = role.value if hasattr(role, "value") else str(role)
                    perms = await repo.get_role_permissions(role_str)
                if name not in perms:
                    _logger.info(
                        "auth.permission.denied",
                        required=name,
                        user_id=str(user.user_id),
                    )
                    raise AuthorizationPermissionRequired(
                        context={"required": name},
                    )
                return

            # No sessionmaker available — misconfigured lifespan or broken wiring.
            # Default-deny: a missing DB connection must never grant access.
            _logger.warning(
                "auth.permission.no_sessionmaker",
                required=name,
                user_id=str(user.user_id),
            )
            raise AuthorizationPermissionRequired(context={"required": name})

        if isinstance(user, ApiKeyPrincipal):
            if name not in user.permissions:
                _logger.info(
                    "auth.permission.denied",
                    required=name,
                    user_id=str(user.user_id),
                )
                raise AuthorizationPermissionRequired(
                    context={"required": name},
                )
            return

        # Unrecognized principal type — deny.
        raise AuthenticationInvalidCredentials()

    # Contravariance: guard's concrete Litestar params (ASGIConnection, BaseRouteHandler)
    # are not assignable to the loose Callable[[object, object], ...] alias basedpyright
    # uses for GuardCallable. The alias is intentionally broad to avoid a runtime import
    # cycle; the structural contract is enforced by Litestar at registration time.
    return guard  # pyright: ignore[reportReturnType]


type GuardCallable = Callable[[object, object], Coroutine[object, object, None]]
