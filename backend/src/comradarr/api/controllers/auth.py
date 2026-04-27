# backend/src/comradarr/api/controllers/auth.py
"""Auth HTTP controllers (Phase 4 Slice J §5.4).

Endpoints:
  POST /api/auth/login            — local password login → session cookie
  POST /api/auth/logout           — revoke session + clear cookie
  GET  /api/auth/oidc/{name}/start    — begin OIDC authorization flow
  GET  /api/auth/oidc/{name}/callback — OIDC callback, mint session
  GET  /api/auth/me               — return resolved principal
  POST /api/auth/sessions/revoke-all-other — revoke all other sessions

Cookie name ``comradarr_session``, HttpOnly, SameSite=Lax.
``Secure`` flag gated by ``settings.comradarr_insecure_cookies``.

All request/response bodies are frozen ``msgspec.Struct`` (RULE-SER-001/002).
All handlers are ``async def`` (RULE-ASYNC-001).
RULE-PY-002: No ``from __future__ import annotations``.
RULE-PY-003: No ``Any``.
RULE-LOG-001: structlog only.
"""

import hashlib
import uuid  # noqa: TC003 — runtime: uuid.UUID in response structs
from typing import TYPE_CHECKING

import msgspec
import structlog
from litestar import Controller, Response, get, post
from litestar.connection import Request  # noqa: TC002 — runtime annotation in handler signature
from litestar.datastructures import Cookie  # noqa: TC002 — runtime: Cookie used in response helpers
from litestar.response import Redirect

from comradarr.core.auth.protocol import Failure, Success
from comradarr.db.enums import AuthProvider, UserRole  # noqa: TC001 — runtime enum fields
from comradarr.errors.authentication import (
    AuthenticationInvalidCredentials,
    AuthenticationSessionExpired,
)

if TYPE_CHECKING:
    from comradarr.config import Settings
    from comradarr.core.auth.local import LocalPasswordProvider
    from comradarr.core.auth.sessions import SessionService

_logger = structlog.stdlib.get_logger(__name__)

_COOKIE_NAME = "comradarr_session"
_COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


# ---------------------------------------------------------------------------
# DTOs
# ---------------------------------------------------------------------------


class LoginRequest(msgspec.Struct, frozen=True, kw_only=True):
    username: str
    password: str


class UserDTO(msgspec.Struct, frozen=True, kw_only=True):
    id: uuid.UUID
    username: str
    role: UserRole


class LoginResponse(msgspec.Struct, frozen=True, kw_only=True):
    user: UserDTO


class MeResponse(msgspec.Struct, frozen=True, kw_only=True):
    user_id: uuid.UUID
    auth_provider: AuthProvider
    session_id: uuid.UUID | None = None
    oidc_provider_name: str | None = None


class RevokeAllOtherRequest(msgspec.Struct, frozen=True, kw_only=True):
    """Empty body — token is taken from the current session cookie."""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def _build_cookie(
    value: str,
    *,
    settings: Settings,
    clear: bool = False,
) -> Cookie:
    from litestar.datastructures import Cookie  # noqa: PLC0415

    return Cookie(
        key=_COOKIE_NAME,
        value="" if clear else value,
        httponly=True,
        secure=not settings.comradarr_insecure_cookies,
        samesite="lax",
        max_age=0 if clear else _COOKIE_MAX_AGE,
        path="/",
    )


def _get_settings(  # pyright: ignore[reportMissingTypeArgument]
    request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def _get_session_service(  # pyright: ignore[reportMissingTypeArgument]
    request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
) -> SessionService:

    svc: SessionService = request.app.state.session_service
    return svc


def _get_local_provider(  # pyright: ignore[reportMissingTypeArgument]
    request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
) -> LocalPasswordProvider:

    provider: LocalPasswordProvider = request.app.state.local_provider
    return provider


# ---------------------------------------------------------------------------
# Controller
# ---------------------------------------------------------------------------


class AuthController(Controller):
    """Minimal auth endpoints for Phase 4."""

    path: str = "/api/auth"

    @post("/login")
    async def login(
        self,
        request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
        data: LoginRequest,
    ) -> Response[LoginResponse]:
        """Authenticate with username + password; return session cookie."""
        from comradarr.core.types import Secret  # noqa: PLC0415
        from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

        settings = _get_settings(request)
        local_provider = _get_local_provider(request)
        session_service = _get_session_service(request)

        async with request.app.state.db_sessionmaker() as db_session:
            user_repo = UserRepository(db_session)
            outcome = await local_provider.authenticate_credentials(
                username=data.username.strip(),
                password=Secret(data.password),
                source_ip=request.client.host if request.client else None,
                user_repo=user_repo,
            )

            if isinstance(outcome, Failure):
                raise AuthenticationInvalidCredentials()

            if not isinstance(outcome, Success):
                raise AuthenticationInvalidCredentials()

            # Fetch user for DTO
            user = await user_repo.get_by_username(data.username.strip())

        if user is None:
            raise AuthenticationInvalidCredentials()

        plaintext, _session = await session_service.mint(
            user_id=outcome.user_id,
            auth_provider=outcome.auth_provider,
            oidc_provider_name=None,
            ip=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            replace_token_hash=None,
        )

        cookie = _build_cookie(plaintext, settings=settings)
        response = Response(
            content=LoginResponse(
                user=UserDTO(
                    id=user.id,
                    username=user.username,  # type: ignore[arg-type]
                    role=user.role,  # type: ignore[arg-type]
                )
            ),
            cookies=[cookie],
        )
        _logger.info("auth.login.success", user_id=str(outcome.user_id))
        return response

    @post("/logout")
    async def logout(
        self,
        request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
    ) -> Response[None]:
        """Revoke current session; clear cookie."""
        settings = _get_settings(request)
        session_service = _get_session_service(request)

        cookie_value = _extract_session_cookie(request)
        if cookie_value:
            token_hash = _hash_token(cookie_value)
            await session_service.revoke(token_hash)

        # Trusted-header redirect
        if settings.trusted_header_auth_logout_url:
            clear_cookie = _build_cookie("", settings=settings, clear=True)
            return Response(
                content=None,
                status_code=302,
                cookies=[clear_cookie],
                headers={"location": settings.trusted_header_auth_logout_url},
            )

        clear_cookie = _build_cookie("", settings=settings, clear=True)
        return Response(content=None, cookies=[clear_cookie])

    @get("/oidc/{short_name:str}/start")
    async def oidc_start(
        self,
        request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
        short_name: str,
    ) -> Redirect:
        """Begin OIDC authorization flow; redirect to provider."""
        import json as _json  # noqa: PLC0415

        from comradarr.core.auth.oidc import OIDCService  # noqa: PLC0415, TC001

        oidc_service: OIDCService = request.app.state.oidc_service
        return_to = str(request.query_params.get("return_to", "/"))

        # Returns (redirect_url, state_obj, signed_state_cookie)
        redirect_url, state_obj, signed_state = await oidc_service.authorize_url(
            short_name,
            return_to,
        )

        settings = _get_settings(request)
        # Store signed state in one cookie; code_verifier + nonce + return_to in another.
        state_cookie = _build_oidc_state_cookie(signed_state, settings=settings)
        params_payload = _json.dumps(
            {
                "cv": state_obj.code_verifier,
                "n": state_obj.nonce,
                "rt": return_to,
            }
        )
        params_cookie = _build_oidc_params_cookie(params_payload, settings=settings)
        return Redirect(
            path=redirect_url,
            cookies=[state_cookie, params_cookie],
        )

    @get("/oidc/{short_name:str}/callback")
    async def oidc_callback(
        self,
        request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
        short_name: str,
    ) -> Response[None]:
        """Handle OIDC authorization callback; mint session."""
        import json as _json  # noqa: PLC0415

        from comradarr.core.auth.oidc import OIDCService  # noqa: PLC0415, TC001

        oidc_service: OIDCService = request.app.state.oidc_service
        session_service = _get_session_service(request)
        settings = _get_settings(request)

        code = str(request.query_params.get("code", ""))
        received_state = str(request.query_params.get("state", ""))
        signed_state_cookie = _extract_oidc_state_cookie(request) or ""
        params_raw = _extract_oidc_params_cookie(request) or "{}"

        try:
            params = _json.loads(params_raw)
        except Exception:
            params = {}

        code_verifier = str(params.get("cv", ""))
        nonce = str(params.get("n", ""))
        return_to = str(params.get("rt", "/"))

        ip = request.client.host if request.client else None
        outcome = await oidc_service.callback(
            short_name=short_name,
            code=code,
            received_state=received_state,
            signed_state_cookie=signed_state_cookie,
            code_verifier=code_verifier,
            nonce=nonce,
            ip=ip,
            user_agent=request.headers.get("user-agent"),
        )

        if isinstance(outcome, Failure):
            raise AuthenticationInvalidCredentials()

        if not isinstance(outcome, Success):
            raise AuthenticationInvalidCredentials()

        plaintext, _session = await session_service.mint(
            user_id=outcome.user_id,
            auth_provider=AuthProvider.OIDC,
            oidc_provider_name=short_name,
            ip=ip,
            user_agent=request.headers.get("user-agent"),
            replace_token_hash=None,
        )

        session_cookie = _build_cookie(plaintext, settings=settings)
        clear_state = _clear_oidc_state_cookie(settings=settings)
        clear_params = _clear_oidc_params_cookie(settings=settings)
        return Response(
            content=None,
            status_code=302,
            cookies=[session_cookie, clear_state, clear_params],
            headers={"location": return_to or "/"},
        )

    @get("/me")
    async def me(
        self,
        request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
    ) -> MeResponse:
        """Return the current session principal."""
        from comradarr.core.auth.sessions import SessionPrincipal  # noqa: PLC0415

        user = request.scope.get("user")
        if not isinstance(user, SessionPrincipal):
            raise AuthenticationSessionExpired()

        return MeResponse(
            user_id=user.user_id,
            auth_provider=user.auth_provider,
            session_id=user.session_id,
            oidc_provider_name=user.oidc_provider_name,
        )

    @post("/sessions/revoke-all-other")
    async def revoke_all_other(
        self,
        request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
    ) -> Response[None]:
        """Revoke all sessions for this user except the current one."""
        from comradarr.core.auth.sessions import SessionPrincipal  # noqa: PLC0415

        user = request.scope.get("user")
        if not isinstance(user, SessionPrincipal):
            raise AuthenticationSessionExpired()

        session_service = _get_session_service(request)
        cookie_value = _extract_session_cookie(request)
        if not cookie_value:
            raise AuthenticationSessionExpired()

        current_hash = _hash_token(cookie_value)
        await session_service.revoke_all_other(user.user_id, current_hash)
        return Response(content=None)


# ---------------------------------------------------------------------------
# Cookie extraction helpers
# ---------------------------------------------------------------------------


def _extract_session_cookie(  # pyright: ignore[reportMissingTypeArgument]
    request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
) -> str | None:
    raw = request.cookies.get(_COOKIE_NAME)
    return raw if isinstance(raw, str) else None


_OIDC_STATE_COOKIE = "comradarr_oidc_state"


def _build_oidc_state_cookie(value: str, *, settings: Settings) -> Cookie:
    from litestar.datastructures import Cookie  # noqa: PLC0415

    return Cookie(
        key=_OIDC_STATE_COOKIE,
        value=value,
        httponly=True,
        secure=not settings.comradarr_insecure_cookies,
        samesite="lax",
        max_age=600,  # 10 minutes — OIDC state is short-lived
        path="/",
    )


def _clear_oidc_state_cookie(*, settings: Settings) -> Cookie:
    from litestar.datastructures import Cookie  # noqa: PLC0415

    return Cookie(
        key=_OIDC_STATE_COOKIE,
        value="",
        httponly=True,
        secure=not settings.comradarr_insecure_cookies,
        samesite="lax",
        max_age=0,
        path="/",
    )


def _extract_oidc_state_cookie(  # pyright: ignore[reportMissingTypeArgument]
    request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
) -> str | None:
    raw = request.cookies.get(_OIDC_STATE_COOKIE)
    return raw if isinstance(raw, str) else None


_OIDC_PARAMS_COOKIE = "comradarr_oidc_params"


def _build_oidc_params_cookie(value: str, *, settings: Settings) -> Cookie:
    from litestar.datastructures import Cookie  # noqa: PLC0415

    return Cookie(
        key=_OIDC_PARAMS_COOKIE,
        value=value,
        httponly=True,
        secure=not settings.comradarr_insecure_cookies,
        samesite="lax",
        max_age=600,
        path="/",
    )


def _clear_oidc_params_cookie(*, settings: Settings) -> Cookie:
    from litestar.datastructures import Cookie  # noqa: PLC0415

    return Cookie(
        key=_OIDC_PARAMS_COOKIE,
        value="",
        httponly=True,
        secure=not settings.comradarr_insecure_cookies,
        samesite="lax",
        max_age=0,
        path="/",
    )


def _extract_oidc_params_cookie(  # pyright: ignore[reportMissingTypeArgument]
    request: Request,  # type: ignore[type-arg]  # pyright: ignore[reportMissingTypeArgument]
) -> str | None:
    raw = request.cookies.get(_OIDC_PARAMS_COOKIE)
    return raw if isinstance(raw, str) else None
