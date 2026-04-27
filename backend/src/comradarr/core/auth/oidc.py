# src/comradarr/core/auth/oidc.py
"""OIDC provider: PKCE-S256 authorization, callback, token validation (Slice G §5.4.4).

Security invariants enforced here:
- PKCE: S256 only; ``code_challenge_method=plain`` is structurally absent.
- alg=none: rejected BEFORE JWKS fetch — the check is on the raw header bytes
  so a crafted JWT that omits the ``alg`` claim also fails.
- Asymmetric-alg allowlist: only RS256/RS384/RS512/ES256/ES384/ES512/PS256/PS384/PS512.
- JWKS: 24h refresh; 60s throttle on signature-failure retry; ``last_refresh_attempt``
  is set BEFORE the fetch (thundering-herd prevention).
- State cookie: HMAC-signed; single-use enforced via ``_consumed_states``; 10-min sweep.
- Discovery URL: http:// is rejected at authorize_url() call time (unless
  COMRADARR_OIDC_<PROVIDER>_INSECURE_DISCOVERY is set by the operator).
- Account linking: oidc_subject exact match → link/require_separate → provision VIEWER.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Final, cast, final

import httpx
import structlog
from authlib.jose import JsonWebKey, JsonWebToken  # type: ignore[import-untyped]
from authlib.jose.errors import JoseError  # type: ignore[import-untyped]

from comradarr.core.auth.protocol import Failure, Success
from comradarr.db.enums import AuditAction, AuthProvider, ProvisioningProvider, UserRole
from comradarr.errors.authentication import (
    AuthenticationAccountLinkingBlocked,
    AuthenticationInvalidCredentials,
)

if TYPE_CHECKING:
    from authlib.jose.rfc7517 import KeySet  # type: ignore[import-untyped]
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from comradarr.config import OIDCProviderSettings, Settings
    from comradarr.core.auth.protocol import AuthOutcome
    from comradarr.core.crypto import CryptoService
    from comradarr.db.models.user import User
    from comradarr.services.audit.writer import AuditWriter

_logger = structlog.stdlib.get_logger(__name__)

_JWKS_TTL_SECONDS: Final = 86400  # 24 h
_JWKS_RETRY_THROTTLE_SECONDS: Final = 60  # 60 s between signature-failure retries
_STATE_TTL_SECONDS: Final = 600  # 10 min
_STATE_SWEEP_SECONDS: Final = 600  # sweep consumed states every 10 min
_HMAC_DIGEST: Final = "sha256"
_PKCE_BYTES: Final = 32  # 256 bits → 43-char base64url verifier

# Asymmetric alg allowlist — symmetric (HS*) and none are structurally excluded.
_ALLOWED_ALGS: Final[frozenset[str]] = frozenset(
    {
        "RS256",
        "RS384",
        "RS512",
        "ES256",
        "ES384",
        "ES512",
        "PS256",
        "PS384",
        "PS512",
    }
)


# ---------------------------------------------------------------------------
# Internal data structures
# ---------------------------------------------------------------------------


@dataclass
class _JwksCache:
    """Per-provider JWKS state."""

    keyset: KeySet | None = None  # authlib KeySet
    fetched_at: float = 0.0  # monotonic; 0 = never fetched
    last_refresh_attempt: float = 0.0  # set BEFORE fetch — thundering-herd guard


@dataclass
class _ConsumedState:
    """Single-use state token with expiry."""

    expires_at: float  # monotonic


@dataclass
class _AuthorizeState:
    """Returned to caller alongside the redirect URL; caller stores in cookie."""

    state: str  # URL-safe random nonce
    code_verifier: str  # PKCE S256 plaintext verifier
    nonce: str  # ID-token nonce claim


@dataclass
class _ProviderCache:
    """Runtime state per named OIDC provider."""

    jwks: _JwksCache = field(default_factory=_JwksCache)
    # single-use state nonces: state → consumed record
    consumed_states: dict[str, _ConsumedState] = field(default_factory=dict)
    last_sweep: float = field(default_factory=time.monotonic)


# ---------------------------------------------------------------------------
# HMAC state cookie helpers
# ---------------------------------------------------------------------------


def _sign_state(state: str, secret_key: bytes) -> str:
    """Return ``state.signature`` where signature is HMAC-SHA256(secret_key, state)."""
    sig = hmac.new(secret_key, state.encode(), _HMAC_DIGEST).hexdigest()
    return f"{state}.{sig}"


def _verify_state(signed: str, secret_key: bytes) -> str | None:
    """Verify and return the bare state string, or None if the signature is invalid."""
    parts = signed.rsplit(".", 1)
    if len(parts) != 2:
        return None
    state, received_sig = parts
    expected_sig = hmac.new(secret_key, state.encode(), _HMAC_DIGEST).hexdigest()
    if not hmac.compare_digest(expected_sig, received_sig):
        return None
    return state


# ---------------------------------------------------------------------------
# PKCE helpers
# ---------------------------------------------------------------------------


def _pkce_pair() -> tuple[str, str]:
    """Return ``(verifier, challenge)`` — S256 only."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(_PKCE_BYTES)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


# ---------------------------------------------------------------------------
# Main service
# ---------------------------------------------------------------------------


@final
class OIDCService:
    """Runtime OIDC flow: authorize_url → callback → link/provision.

    One instance per named provider is NOT the design — a single OIDCService
    holds all provider caches and dispatches by ``short_name``.
    """

    __slots__: tuple[str, ...] = (
        "_providers",
        "_crypto",
        "_sessionmaker",
        "_audit",
        "_secret_key",
        "_caches",
        "_http",
        "_sweep_lock",
    )

    def __init__(
        self,
        providers: dict[str, OIDCProviderSettings],
        crypto: CryptoService,
        sessionmaker: async_sessionmaker[AsyncSession],
        audit: AuditWriter,
        settings: Settings,
    ) -> None:
        self._providers = providers
        self._crypto = crypto
        self._sessionmaker = sessionmaker
        self._audit = audit
        # comradarr_secret_key is guaranteed non-None by load_settings validation.
        if settings.comradarr_secret_key is None:
            msg = "comradarr_secret_key must not be None"
            raise RuntimeError(msg)
        self._secret_key: bytes = settings.comradarr_secret_key
        self._caches: dict[str, _ProviderCache] = {name: _ProviderCache() for name in providers}
        self._http = httpx.AsyncClient(http2=True, timeout=10.0)
        self._sweep_lock = asyncio.Lock()

    async def aclose(self) -> None:
        """Close the underlying HTTP client (called from lifespan teardown)."""
        await self._http.aclose()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def authorize_url(
        self,
        short_name: str,
        _return_to: str,
        *,
        insecure_discovery_allowed: bool = False,
    ) -> tuple[str, _AuthorizeState, str]:
        """Build the provider authorization URL from discovery metadata.

        Returns ``(redirect_url, state_obj, signed_state_cookie)``.
        The caller sets the signed cookie; the bare state is embedded in the URL.

        ``insecure_discovery_allowed`` must be True to allow ``http://``
        discovery URLs (operator opt-in via config; default False).

        Fetches ``authorization_endpoint`` from OIDC discovery so the URL is
        correct for any compliant IdP (not just Keycloak). Query parameters are
        encoded via ``urllib.parse.urlencode`` so scopes with spaces and
        URL-special characters are transmitted correctly.
        """
        import urllib.parse  # noqa: PLC0415

        cfg = self._require_provider(short_name)

        if not insecure_discovery_allowed and cfg.discovery_url.startswith("http://"):
            msg = f"OIDC provider {short_name!r}: http:// discovery URL rejected (RULE-OIDC-TLS)"
            _logger.warning("oidc.discovery.insecure_url", provider=short_name)
            raise AuthenticationInvalidCredentials(msg)

        metadata = await self._fetch_discovery_metadata(short_name)
        if metadata is None:
            raise AuthenticationInvalidCredentials(
                f"OIDC provider {short_name!r}: discovery metadata unavailable"
            )
        auth_endpoint = metadata.get("authorization_endpoint")
        if not isinstance(auth_endpoint, str):
            raise AuthenticationInvalidCredentials(
                f"OIDC provider {short_name!r}: authorization_endpoint missing from metadata"
            )

        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        verifier, challenge = _pkce_pair()

        params = {
            "response_type": "code",
            "client_id": cfg.client_id,
            "redirect_uri": cfg.redirect_uri,
            "scope": " ".join(cfg.scopes),
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        query = urllib.parse.urlencode(params)
        redirect_url = f"{auth_endpoint}?{query}"

        signed_cookie = _sign_state(state, self._secret_key)
        state_obj = _AuthorizeState(state=state, code_verifier=verifier, nonce=nonce)
        return redirect_url, state_obj, signed_cookie

    async def callback(
        self,
        short_name: str,
        code: str,
        received_state: str,
        signed_state_cookie: str,
        code_verifier: str,
        nonce: str,
        ip: str | None,
        user_agent: str | None,
    ) -> AuthOutcome:
        """Process the OIDC callback.

        Validates state signature, enforces single-use, exchanges code, validates
        ID token, and resolves the user identity via link/provision policy.
        """
        cfg = self._require_provider(short_name)
        cache = self._caches[short_name]

        # 1. State signature + single-use enforcement
        bare_state = _verify_state(signed_state_cookie, self._secret_key)
        if bare_state is None or bare_state != received_state:
            _logger.warning("oidc.callback.state_mismatch", provider=short_name)
            return Failure(
                reason="State mismatch or invalid signature",
                problem_code="oidc.state_invalid",
            )

        try:
            await self._enforce_single_use(cache, received_state)
        except AuthenticationInvalidCredentials:
            return Failure(
                reason="State already consumed (replay attack)",
                problem_code="oidc.state_invalid",
            )

        # 2. Exchange code for tokens
        token_response = await self._exchange_code(
            cfg=cfg,
            short_name=short_name,
            code=code,
            code_verifier=code_verifier,
        )
        if token_response is None:
            return Failure(
                reason="Token exchange failed",
                problem_code="oidc.token_exchange_failed",
            )

        id_token_raw = token_response.get("id_token")
        if not id_token_raw or not isinstance(id_token_raw, str):
            return Failure(reason="No id_token in response", problem_code="oidc.no_id_token")

        # 3. Validate ID token
        try:
            claims = await self._validate_id_token(
                short_name=short_name,
                id_token=id_token_raw,
                expected_nonce=nonce,
            )
        except (JoseError, ValueError) as exc:
            _logger.warning("oidc.id_token.invalid", provider=short_name, error=str(exc))
            return Failure(
                reason="ID token validation failed",
                problem_code="oidc.token_invalid",
            )

        subject = str(claims.get("sub") or "")
        email = str(claims.get("email") or "")
        preferred_username = str(claims.get("preferred_username") or "") or email

        if not subject:
            return Failure(reason="Missing sub claim", problem_code="oidc.missing_sub")

        # 4. Account linking
        try:
            user = await self._resolve_user(
                short_name=short_name,
                subject=subject,
                email=email,
                username=preferred_username,
                link_policy=cfg.link_policy,
                ip=ip,
                user_agent=user_agent,
            )
        except AuthenticationAccountLinkingBlocked:
            return Failure(
                reason="Account linking blocked by policy",
                problem_code="oidc.account_linking_blocked",
            )

        if user is None:
            return Failure(
                reason="User provisioning failed",
                problem_code="oidc.provision_failed",
            )

        return Success(
            user_id=user.id,
            auth_provider=AuthProvider.OIDC,
            oidc_provider_name=short_name,
        )

    async def get_end_session_url(self, short_name: str) -> str | None:
        """Return the provider's end_session_endpoint, or None if not advertised."""
        metadata = await self._fetch_discovery_metadata(short_name)
        if metadata is None:
            return None
        endpoint = metadata.get("end_session_endpoint")
        return endpoint if isinstance(endpoint, str) else None

    # ------------------------------------------------------------------
    # Token validation
    # ------------------------------------------------------------------

    async def _validate_id_token(
        self,
        short_name: str,
        id_token: str,
        expected_nonce: str,
    ) -> dict[str, object]:
        """Validate the ID token; return the claims dict.

        Step order:
        1. Decode header bytes — reject alg=none FIRST (before JWKS fetch).
        2. Check alg is in the asymmetric allowlist.
        3. Fetch/cache JWKS.
        4. Verify signature; if it fails and throttle allows, refresh JWKS once.
        5. Validate nonce claim.
        """
        # Decode the header without verifying the signature
        parts = id_token.split(".")
        if len(parts) != 3:
            raise ValueError("Malformed JWT: expected 3 parts")

        try:
            # Pad to multiple of 4 for base64 decoding
            header_b64 = parts[0] + "=" * (-len(parts[0]) % 4)
            header: dict[str, object] = cast(
                "dict[str, object]", json.loads(base64.urlsafe_b64decode(header_b64))
            )
        except Exception as exc:
            raise ValueError(f"Cannot decode JWT header: {exc}") from exc

        alg = str(header.get("alg") or "")

        # alg=none check FIRST — before touching JWKS
        if not alg or alg.lower() == "none":
            raise ValueError("alg=none is not permitted")

        if alg not in _ALLOWED_ALGS:
            raise ValueError(f"Algorithm {alg!r} is not in the asymmetric allowlist")

        # Fetch JWKS and verify
        keyset = await self._get_jwks(short_name, force_refresh=False)

        # Pull issuer from discovery metadata so we can enforce it in claims.
        metadata = await self._fetch_discovery_metadata(short_name)
        expected_issuer = (
            str(metadata["issuer"])
            if metadata is not None and isinstance(metadata.get("issuer"), str)
            else None
        )

        cfg = self._require_provider(short_name)
        claims_options: dict[str, object] = {
            "exp": {"essential": True},
            "iat": {"essential": True},
            "sub": {"essential": True},
            "aud": {"essential": True, "value": cfg.client_id},
        }
        if expected_issuer is not None:
            claims_options["iss"] = {"essential": True, "value": expected_issuer}

        jwt_verifier = JsonWebToken(algorithms=list(_ALLOWED_ALGS))
        try:
            token_data = jwt_verifier.decode(  # type: ignore[arg-type]
                id_token, keyset, claims_options=claims_options
            )
        except JoseError:
            # Signature failed — maybe keys rotated. Retry once if throttle allows.
            keyset = await self._get_jwks(short_name, force_refresh=True)
            token_data = jwt_verifier.decode(  # type: ignore[arg-type]
                id_token, keyset, claims_options=claims_options
            )

        # 60s clock-skew leeway per plan §5.4.4
        token_data.validate(now=int(time.time()), leeway=60)

        claims = dict(token_data)

        # Nonce validation
        if claims.get("nonce") != expected_nonce:
            raise ValueError("Nonce mismatch")

        return claims

    # ------------------------------------------------------------------
    # JWKS cache
    # ------------------------------------------------------------------

    async def _get_jwks(self, short_name: str, *, force_refresh: bool) -> KeySet:
        """Return the cached JWKS keyset, refreshing when stale or forced."""
        cache = self._caches[short_name]
        jwks_cache = cache.jwks
        now = time.monotonic()

        needs_refresh = (
            jwks_cache.keyset is None or (now - jwks_cache.fetched_at) >= _JWKS_TTL_SECONDS
        )

        if force_refresh:
            # Throttle: only retry if 60 s have passed since last attempt
            if (now - jwks_cache.last_refresh_attempt) < _JWKS_RETRY_THROTTLE_SECONDS:
                # Return stale keyset if available; caller will get JoseError
                if jwks_cache.keyset is not None:
                    return jwks_cache.keyset
                raise ValueError("JWKS unavailable and retry throttled")
            needs_refresh = True

        if not needs_refresh and jwks_cache.keyset is not None:
            return jwks_cache.keyset

        # Set last_refresh_attempt BEFORE the network call (thundering-herd guard)
        jwks_cache.last_refresh_attempt = time.monotonic()

        metadata = await self._fetch_discovery_metadata(short_name)
        if metadata is None:
            if jwks_cache.keyset is not None:
                return jwks_cache.keyset
            raise ValueError(f"Cannot fetch OIDC discovery metadata for {short_name!r}")

        jwks_uri = metadata.get("jwks_uri")
        if not isinstance(jwks_uri, str):
            raise ValueError(f"No jwks_uri in discovery metadata for {short_name!r}")

        try:
            resp = await self._http.get(jwks_uri)
            _ = resp.raise_for_status()
            jwks_data: dict[str, object] = cast("dict[str, object]", resp.json())
        except Exception as exc:
            _logger.warning("oidc.jwks.fetch_failed", provider=short_name, error=str(exc))
            if jwks_cache.keyset is not None:
                return jwks_cache.keyset
            raise ValueError(f"JWKS fetch failed for {short_name!r}: {exc}") from exc

        keyset: KeySet = JsonWebKey.import_key_set(jwks_data)  # type: ignore[assignment]
        jwks_cache.keyset = keyset
        jwks_cache.fetched_at = time.monotonic()
        return keyset

    async def _fetch_discovery_metadata(self, short_name: str) -> dict[str, object] | None:
        """Fetch .well-known/openid-configuration for ``short_name``."""
        cfg = self._require_provider(short_name)
        discovery_url = cfg.discovery_url.rstrip("/") + "/.well-known/openid-configuration"
        try:
            resp = await self._http.get(discovery_url)
            _ = resp.raise_for_status()
            data: dict[str, object] = cast("dict[str, object]", resp.json())
            return data
        except Exception as exc:
            _logger.warning("oidc.discovery.fetch_failed", provider=short_name, error=str(exc))
            return None

    # ------------------------------------------------------------------
    # Code exchange
    # ------------------------------------------------------------------

    async def _exchange_code(
        self,
        cfg: OIDCProviderSettings,
        short_name: str,
        code: str,
        code_verifier: str,
    ) -> dict[str, object] | None:
        """Exchange the authorization code for tokens."""
        metadata = await self._fetch_discovery_metadata(short_name)
        if metadata is None:
            return None

        token_endpoint = metadata.get("token_endpoint")
        if not isinstance(token_endpoint, str):
            return None

        # Read client secret from file (path stored in OIDCProviderSettings)
        try:
            client_secret = cfg.client_secret_path.read_text().strip()
        except OSError as exc:
            _logger.error("oidc.client_secret.read_failed", provider=short_name, error=str(exc))
            return None

        try:
            resp = await self._http.post(
                token_endpoint,
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": cfg.redirect_uri,
                    "client_id": cfg.client_id,
                    "client_secret": client_secret,
                    "code_verifier": code_verifier,
                },
            )
            _ = resp.raise_for_status()
            result: dict[str, object] = cast("dict[str, object]", resp.json())
            return result
        except Exception as exc:
            _logger.warning("oidc.token_exchange.failed", provider=short_name, error=str(exc))
            return None

    # ------------------------------------------------------------------
    # Account linking / provisioning
    # ------------------------------------------------------------------

    async def _resolve_user(
        self,
        short_name: str,
        subject: str,
        email: str,
        username: str,
        link_policy: str,
        ip: str | None,
        user_agent: str | None,
    ) -> User | None:
        """Find or provision a user for this OIDC subject.

        Policy matrix:
        - Existing row with matching oidc_subject → return it (always allowed).
        - No existing row with oidc_subject, but matching email:
          - link_policy == "link"             → link (set oidc_subject) + return
          - link_policy == "require_separate" → raise AuthenticationAccountLinkingBlocked
        - No existing row at all → provision VIEWER + set oidc_subject.
        """
        async with self._sessionmaker() as db_session:
            from sqlalchemy import select  # noqa: PLC0415

            from comradarr.db.models.user import User  # noqa: PLC0415
            from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

            user_repo = UserRepository(db_session)

            # 1. Lookup by oidc_subject first
            stmt = select(User).where(User.oidc_subject == subject)
            user = await db_session.scalar(stmt)

            if user is not None:
                await db_session.commit()
                return user

            # 2. Lookup by email
            user_by_email = await user_repo.get_by_email(email) if email else None

            if user_by_email is not None:
                if link_policy == "require_separate":
                    raise AuthenticationAccountLinkingBlocked(
                        f"OIDC provider {short_name!r}: account linking blocked by policy"
                    )
                # link_policy == "link": set oidc_subject and return
                await user_repo.set_oidc_subject(user_by_email.id, subject)
                await db_session.commit()

                await self._audit.record(
                    action=AuditAction.USER_UPDATED,
                    actor_user_id=user_by_email.id,
                    context={
                        "reason": "oidc_account_linked",
                        "provider": short_name,
                        "oidc_subject": subject,
                    },
                    ip=ip,
                    user_agent=user_agent,
                )
                return user_by_email

            # 3. Provision new user
            effective_username = username or email or f"oidc_{subject[:16]}"
            existing_by_username = await user_repo.get_by_username(effective_username)
            if existing_by_username is not None:
                effective_username = f"{effective_username}_{secrets.token_hex(4)}"

            new_user = await user_repo.create_provisioned(
                email=email or f"{subject}@{short_name}.oidc",
                username=effective_username,
                provisioning_provider=ProvisioningProvider.OIDC,
                role=UserRole.VIEWER,
            )
            await user_repo.set_oidc_subject(new_user.id, subject)
            await db_session.commit()

            await self._audit.record(
                action=AuditAction.USER_CREATED,
                actor_user_id=new_user.id,
                context={
                    "reason": "oidc_provisioned",
                    "provider": short_name,
                    "oidc_subject": subject,
                },
                ip=ip,
                user_agent=user_agent,
            )
            return new_user

    # ------------------------------------------------------------------
    # State single-use enforcement + sweep
    # ------------------------------------------------------------------

    async def _enforce_single_use(self, cache: _ProviderCache, state: str) -> None:
        """Mark state as consumed; raise if already consumed or expired."""
        now = time.monotonic()
        existing = cache.consumed_states.get(state)
        if existing is not None:
            raise AuthenticationInvalidCredentials("OIDC state already consumed (replay attack)")

        cache.consumed_states[state] = _ConsumedState(expires_at=now + _STATE_TTL_SECONDS)

        # Sweep expired states periodically (asyncio single-writer; no lock needed)
        if now - cache.last_sweep >= _STATE_SWEEP_SECONDS:
            cache.last_sweep = now
            expired = [s for s, rec in cache.consumed_states.items() if rec.expires_at <= now]
            for s in expired:
                _ = cache.consumed_states.pop(s, None)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _require_provider(self, short_name: str) -> OIDCProviderSettings:
        cfg = self._providers.get(short_name)
        if cfg is None:
            msg = f"OIDC provider {short_name!r} is not configured"
            raise AuthenticationInvalidCredentials(msg)
        return cfg

    async def run_jwks_refresher(self) -> None:
        """24h JWKS refresh loop — runs as a background task via lifespan.

        Refreshes the JWKS keyset for every configured provider once per
        ``_JWKS_TTL_SECONDS`` (24 h). Failures are logged and the loop
        continues so a transient network error does not kill the refresher.

        ``asyncio.CancelledError`` is the clean-shutdown path (lifespan
        teardown cancels the task); it is re-raised so the task exits cleanly.
        """
        while True:
            await asyncio.sleep(_JWKS_TTL_SECONDS)
            for short_name in self._providers:
                try:
                    _ = await self._get_jwks(short_name, force_refresh=True)
                    _logger.info("oidc.jwks.refreshed", provider=short_name)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 — log + continue
                    _logger.warning(
                        "oidc.jwks.refresh_failed",
                        provider=short_name,
                        error=str(exc),
                    )
