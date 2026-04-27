# backend/src/comradarr/api/controllers/api_keys.py
"""API key HTTP controllers (Phase 4 Slice J §5.4).

Endpoints (admin-only):
  POST   /api/api-keys       — issue a new API key (returns plaintext once)
  GET    /api/api-keys       — list owned keys (prefix + last_four only)
  DELETE /api/api-keys/{id}  — revoke a key + audit

All request/response bodies are frozen ``msgspec.Struct`` (RULE-SER-001/002).
All handlers are ``async def`` (RULE-ASYNC-001).
RULE-PY-002: No ``from __future__ import annotations``.
RULE-PY-003: No ``Any``.
RULE-LOG-001: structlog only.
"""

import uuid  # noqa: TC003 — runtime: uuid.UUID in DTOs and path params
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import msgspec
import structlog
from litestar import Controller, Response, delete, get, post
from litestar.connection import Request  # noqa: TC002 — runtime annotation in handler signature

from comradarr.db.enums import UserRole  # noqa: TC001 — runtime enum field
from comradarr.errors.authorization import AuthorizationForbidden

if TYPE_CHECKING:
    from comradarr.core.auth.api_keys import ApiKeyService
    from comradarr.core.auth.sessions import SessionPrincipal
    from comradarr.db.models.api_key import ApiKey

_logger = structlog.stdlib.get_logger(__name__)


# ---------------------------------------------------------------------------
# DTOs
# ---------------------------------------------------------------------------


class IssueKeyRequest(msgspec.Struct, frozen=True, kw_only=True):
    name: str
    scopes: list[str] = msgspec.field(default_factory=list)
    expires_at: datetime | None = None


class ApiKeyDTO(msgspec.Struct, frozen=True, kw_only=True):
    id: uuid.UUID
    name: str
    prefix: str
    last_four: str
    created_at: datetime
    expires_at: datetime | None = None
    last_used_at: datetime | None = None


class IssuedKeyResponse(msgspec.Struct, frozen=True, kw_only=True):
    key: ApiKeyDTO
    plaintext: str


class ApiKeyListResponse(msgspec.Struct, frozen=True, kw_only=True):
    keys: list[ApiKeyDTO]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _require_admin(  # pyright: ignore[reportMissingTypeArgument]
    request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
) -> SessionPrincipal:
    from comradarr.core.auth.sessions import SessionPrincipal  # noqa: PLC0415

    user = request.scope.get("user")
    if not isinstance(user, SessionPrincipal):
        raise AuthorizationForbidden()
    if user.auth_provider.value == "api_key":
        raise AuthorizationForbidden()
    return user


def _get_api_key_service(  # pyright: ignore[reportMissingTypeArgument]
    request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
) -> ApiKeyService:
    svc: ApiKeyService = request.app.state.api_key_service
    return svc


def _to_dto(api_key: ApiKey) -> ApiKeyDTO:
    created = api_key.created_at
    return ApiKeyDTO(
        id=api_key.id,
        name=api_key.name,
        prefix=api_key.prefix,
        last_four=api_key.last_four,
        created_at=created.replace(tzinfo=UTC) if created.tzinfo is None else created,
        expires_at=api_key.expires_at,
        last_used_at=api_key.last_used_at,
    )


# ---------------------------------------------------------------------------
# Controller
# ---------------------------------------------------------------------------


class ApiKeysController(Controller):
    """Minimal API key management endpoints for Phase 4 (admin-only)."""

    path: str = "/api/api-keys"

    @post("/")
    async def issue_key(
        self,
        request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
        data: IssueKeyRequest,
    ) -> IssuedKeyResponse:
        """Issue a new API key. Returns plaintext exactly once."""
        principal = _require_admin(request)
        await _check_admin_role(request, principal)

        svc = _get_api_key_service(request)
        plaintext, api_key = await svc.issue(
            user_id=principal.user_id,
            name=data.name,
            scopes=data.scopes,
            expires_at=data.expires_at,
            ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        _logger.info("api_key.controller.issued", api_key_id=str(api_key.id))
        return IssuedKeyResponse(key=_to_dto(api_key), plaintext=plaintext)

    @get("/")
    async def list_keys(
        self,
        request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
    ) -> ApiKeyListResponse:
        """List API keys owned by the current user (no plaintext, no hash)."""
        principal = _require_admin(request)
        await _check_admin_role(request, principal)

        from comradarr.repositories.auth import ApiKeyRepository  # noqa: PLC0415

        async with request.app.state.db_sessionmaker() as db_session:
            repo = ApiKeyRepository(db_session)
            rows = await repo.list_for_user(principal.user_id)

        return ApiKeyListResponse(keys=[_to_dto(row) for row in rows])

    @delete("/{key_id:uuid}")
    async def revoke_key(
        self,
        request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
        key_id: uuid.UUID,
    ) -> Response[None]:
        """Revoke an API key by id. Ownership-checked: actor must own the key."""
        principal = _require_admin(request)
        await _check_admin_role(request, principal)

        from comradarr.db.models.api_key import ApiKey as ApiKeyModel  # noqa: PLC0415

        # FIX-Y: ownership check — actor must own the key (default-deny on mismatch/missing)
        async with request.app.state.db_sessionmaker() as db_session:
            api_key = await db_session.get(ApiKeyModel, key_id)
        if api_key is None or api_key.user_id != principal.user_id:
            raise AuthorizationForbidden()

        svc = _get_api_key_service(request)
        await svc.revoke(
            api_key_id=key_id,
            actor_user_id=principal.user_id,
            ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
        _logger.info("api_key.controller.revoked", api_key_id=str(key_id))
        return Response(content=None, status_code=204)


async def _check_admin_role(  # pyright: ignore[reportMissingTypeArgument]
    request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
    principal: SessionPrincipal,
) -> None:
    """Enforce ADMIN role via DB lookup — default-deny (FIX-X)."""
    from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

    async with request.app.state.db_sessionmaker() as db_session:
        user_repo = UserRepository(db_session)
        user_row = await user_repo.get_by_id(principal.user_id)
    if user_row is None or user_row.role != UserRole.ADMIN:
        raise AuthorizationForbidden()
