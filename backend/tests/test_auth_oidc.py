# tests/test_auth_oidc.py
"""Unit tests for OIDCService (Slice G §5.4.4).

All tests run entirely in-process — no live OIDC provider, no database.
Network calls (discovery, JWKS, token exchange) are patched via AsyncMock.
"""

import base64
import contextlib  # noqa: TC003
import hashlib
import json
import time
import uuid
from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from comradarr.config import (
    OIDCProviderSettings,  # noqa: TC001 — runtime: cast() call in _make_service
)
from comradarr.core.auth.oidc import (  # pyright: ignore[reportPrivateUsage]
    OIDCService,
    _AuthorizeState,
    _ConsumedState,
    _pkce_pair,
    _sign_state,
    _verify_state,
)
from comradarr.core.auth.protocol import Failure, Success
from comradarr.db.enums import AuthProvider
from comradarr.errors.authentication import (
    AuthenticationAccountLinkingBlocked,
    AuthenticationInvalidCredentials,
)

# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

_SECRET_KEY = b"testsecretkey0123456789abcdef0123"  # noqa: S105 — test fixture only
_SHORT_NAME = "testprovider"


def _make_settings(secret_key: bytes = _SECRET_KEY) -> MagicMock:
    s = MagicMock()
    s.comradarr_secret_key = secret_key
    return s


def _make_provider_cfg(
    *,
    discovery_url: str = "https://idp.example.com",
    link_policy: str = "link",
) -> MagicMock:
    cfg = MagicMock()
    cfg.client_id = "client-id"
    cfg.client_secret_path = MagicMock()
    cfg.client_secret_path.read_text.return_value = "client-secret"
    cfg.redirect_uri = "https://app.example.com/callback"
    cfg.scopes = ("openid", "email", "profile")
    cfg.discovery_url = discovery_url
    cfg.link_policy = link_policy
    return cfg


def _make_service(
    providers: dict[str, OIDCProviderSettings] | None = None,
    *,
    link_policy: str = "link",
    discovery_url: str = "https://idp.example.com",
) -> OIDCService:
    if providers is None:
        providers = cast(
            "dict[str, OIDCProviderSettings]",
            {
                _SHORT_NAME: _make_provider_cfg(
                    discovery_url=discovery_url,
                    link_policy=link_policy,
                )
            },
        )
    crypto = MagicMock()
    sessionmaker = MagicMock()
    audit = MagicMock()
    audit.record = AsyncMock()
    settings = _make_settings()
    return OIDCService(
        providers=providers,
        crypto=crypto,
        sessionmaker=sessionmaker,
        audit=audit,
        settings=settings,
    )


def _make_jwt(
    *,
    alg: str = "RS256",
    sub: str = "user123",
    nonce: str = "test-nonce",
    email: str = "user@example.com",
) -> str:
    """Build a minimal JWT with the given header fields (not a real signature)."""
    header = (
        base64.urlsafe_b64encode(json.dumps({"alg": alg, "typ": "JWT"}).encode())
        .rstrip(b"=")
        .decode()
    )
    payload = (
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "sub": sub,
                    "email": email,
                    "nonce": nonce,
                    "iss": "https://idp.example.com",
                    "aud": "client-id",
                    "exp": int(time.time()) + 3600,
                    "iat": int(time.time()),
                }
            ).encode()
        )
        .rstrip(b"=")
        .decode()
    )
    sig = base64.urlsafe_b64encode(b"fakesig").rstrip(b"=").decode()
    return f"{header}.{payload}.{sig}"


# ---------------------------------------------------------------------------
# HMAC state cookie tests
# ---------------------------------------------------------------------------


class TestHmacState:
    def test_sign_and_verify_roundtrip(self) -> None:
        state = "randomstate123"
        signed = _sign_state(state, _SECRET_KEY)
        result = _verify_state(signed, _SECRET_KEY)
        assert result == state

    def test_verify_wrong_key_returns_none(self) -> None:
        signed = _sign_state("state", _SECRET_KEY)
        result = _verify_state(signed, b"wrongkey" * 4)
        assert result is None

    def test_verify_tampered_state_returns_none(self) -> None:
        signed = _sign_state("state", _SECRET_KEY)
        parts = signed.rsplit(".", 1)
        tampered = f"TAMPERED.{parts[1]}"
        result = _verify_state(tampered, _SECRET_KEY)
        assert result is None

    def test_verify_malformed_no_dot_returns_none(self) -> None:
        result = _verify_state("nodothere", _SECRET_KEY)
        assert result is None

    def test_verify_different_states_dont_cross(self) -> None:
        signed_a = _sign_state("stateA", _SECRET_KEY)
        signed_b = _sign_state("stateB", _SECRET_KEY)
        assert _verify_state(signed_a, _SECRET_KEY) == "stateA"
        assert _verify_state(signed_b, _SECRET_KEY) == "stateB"
        assert _verify_state(signed_a, _SECRET_KEY) != "stateB"


# ---------------------------------------------------------------------------
# PKCE helpers
# ---------------------------------------------------------------------------


class TestPkcePair:
    def test_challenge_is_s256_of_verifier(self) -> None:
        verifier, challenge = _pkce_pair()
        digest = hashlib.sha256(verifier.encode()).digest()
        expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
        assert challenge == expected

    def test_verifier_is_url_safe(self) -> None:
        verifier, _ = _pkce_pair()
        assert all(c.isalnum() or c in "-_" for c in verifier)

    def test_verifier_and_challenge_differ(self) -> None:
        verifier, challenge = _pkce_pair()
        assert verifier != challenge

    def test_each_call_produces_unique_verifier(self) -> None:
        pairs = {_pkce_pair()[0] for _ in range(50)}
        assert len(pairs) == 50


# ---------------------------------------------------------------------------
# authorize_url
# ---------------------------------------------------------------------------


_FAKE_METADATA: dict[str, object] = {
    "authorization_endpoint": "https://idp.example.com/authorize",
    "token_endpoint": "https://idp.example.com/token",
    "jwks_uri": "https://idp.example.com/jwks",
    "issuer": "https://idp.example.com",
}

_FAKE_INSECURE_METADATA: dict[str, object] = {
    "authorization_endpoint": "http://insecure-idp.example.com/authorize",
    "token_endpoint": "http://insecure-idp.example.com/token",
    "jwks_uri": "http://insecure-idp.example.com/jwks",
    "issuer": "http://insecure-idp.example.com",
}


def _patch_discovery(
    metadata: dict[str, object],
) -> contextlib.AbstractContextManager[object]:
    return patch.object(
        OIDCService,
        "_fetch_discovery_metadata",
        new=AsyncMock(return_value=metadata),
    )


class TestAuthorizeUrl:
    async def test_returns_three_tuple(self) -> None:
        svc = _make_service()
        with _patch_discovery(_FAKE_METADATA):
            url, state_obj, cookie = await svc.authorize_url(
                _SHORT_NAME, "https://app.example.com/"
            )
        assert isinstance(url, str)
        assert isinstance(state_obj, _AuthorizeState)
        assert isinstance(cookie, str)

    async def test_url_contains_s256_method(self) -> None:
        svc = _make_service()
        with _patch_discovery(_FAKE_METADATA):
            url, _, _ = await svc.authorize_url(_SHORT_NAME, "/")
        assert "code_challenge_method=S256" in url

    async def test_url_contains_state_nonce(self) -> None:
        svc = _make_service()
        with _patch_discovery(_FAKE_METADATA):
            url, state_obj, _ = await svc.authorize_url(_SHORT_NAME, "/")
        assert state_obj.state in url
        assert state_obj.nonce in url

    async def test_cookie_is_hmac_signed(self) -> None:
        svc = _make_service()
        with _patch_discovery(_FAKE_METADATA):
            _, state_obj, cookie = await svc.authorize_url(_SHORT_NAME, "/")
        bare = _verify_state(cookie, _SECRET_KEY)
        assert bare == state_obj.state

    async def test_http_discovery_rejected_by_default(self) -> None:
        svc = _make_service(discovery_url="http://insecure-idp.example.com")
        with pytest.raises(AuthenticationInvalidCredentials):
            await svc.authorize_url(_SHORT_NAME, "/")

    async def test_http_discovery_allowed_with_flag(self) -> None:
        svc = _make_service(discovery_url="http://insecure-idp.example.com")
        with _patch_discovery(_FAKE_INSECURE_METADATA):
            url, _, _ = await svc.authorize_url(_SHORT_NAME, "/", insecure_discovery_allowed=True)
        assert url.startswith("http://insecure-idp.example.com")

    async def test_unknown_provider_raises(self) -> None:
        svc = _make_service()
        with pytest.raises(AuthenticationInvalidCredentials):
            await svc.authorize_url("nonexistent", "/")


# ---------------------------------------------------------------------------
# alg=none rejection (white-box via _validate_id_token)
# ---------------------------------------------------------------------------


class TestAlgNoneRejection:
    async def test_alg_none_jwt_is_rejected(self) -> None:
        svc = _make_service()
        token = _make_jwt(alg="none")
        with pytest.raises(ValueError, match="alg=none"):
            await svc._validate_id_token(  # pyright: ignore[reportPrivateUsage]
                short_name=_SHORT_NAME,
                id_token=token,
                expected_nonce="test-nonce",
            )

    async def test_symmetric_alg_hs256_rejected(self) -> None:
        svc = _make_service()
        token = _make_jwt(alg="HS256")
        with pytest.raises(ValueError, match="asymmetric allowlist"):
            await svc._validate_id_token(  # pyright: ignore[reportPrivateUsage]
                short_name=_SHORT_NAME,
                id_token=token,
                expected_nonce="test-nonce",
            )

    async def test_missing_alg_claim_rejected(self) -> None:
        token = _make_jwt(alg="")
        svc = _make_service()
        with pytest.raises(ValueError, match="alg=none"):
            await svc._validate_id_token(  # pyright: ignore[reportPrivateUsage]
                short_name=_SHORT_NAME,
                id_token=token,
                expected_nonce="test-nonce",
            )

    async def test_malformed_jwt_rejected(self) -> None:
        svc = _make_service()
        with pytest.raises(ValueError, match="3 parts"):
            await svc._validate_id_token(  # pyright: ignore[reportPrivateUsage]
                short_name=_SHORT_NAME,
                id_token="not.a.valid.jwt.parts",  # noqa: S106 — not a credential; test fixture
                expected_nonce="nonce",
            )


# ---------------------------------------------------------------------------
# JWKS cache — throttle behavior
# ---------------------------------------------------------------------------


class TestJwksThrottle:
    async def test_force_refresh_throttled_returns_stale(self) -> None:
        svc = _make_service()
        cache = svc._caches[_SHORT_NAME]  # pyright: ignore[reportPrivateUsage]
        fake_keyset = MagicMock()
        cache.jwks.keyset = fake_keyset
        cache.jwks.fetched_at = time.monotonic()
        cache.jwks.last_refresh_attempt = time.monotonic()

        result = await svc._get_jwks(  # pyright: ignore[reportPrivateUsage]
            _SHORT_NAME, force_refresh=True
        )
        assert result is fake_keyset

    async def test_force_refresh_no_keyset_throttled_raises(self) -> None:
        svc = _make_service()
        cache = svc._caches[_SHORT_NAME]  # pyright: ignore[reportPrivateUsage]
        cache.jwks.keyset = None
        cache.jwks.last_refresh_attempt = time.monotonic()

        with pytest.raises(ValueError, match="throttled"):
            await svc._get_jwks(  # pyright: ignore[reportPrivateUsage]
                _SHORT_NAME, force_refresh=True
            )

    async def test_stale_keyset_triggers_refresh(self) -> None:
        svc = _make_service()
        cache = svc._caches[_SHORT_NAME]  # pyright: ignore[reportPrivateUsage]
        fake_keyset = MagicMock()
        cache.jwks.keyset = fake_keyset
        cache.jwks.fetched_at = time.monotonic() - 100000

        fake_new_keyset = MagicMock()
        # Patch at the class level (not instance) because @final + __slots__ makes
        # instance attributes read-only for patch.object.
        with (
            patch.object(
                OIDCService,
                "_fetch_discovery_metadata",
                new=AsyncMock(return_value={"jwks_uri": "https://idp.example.com/jwks"}),
            ),
            patch("comradarr.core.auth.oidc.JsonWebKey") as mock_jwk,
            patch.object(
                svc._http,  # pyright: ignore[reportPrivateUsage]
                "get",
                new=AsyncMock(
                    return_value=MagicMock(
                        raise_for_status=MagicMock(return_value=None),
                        json=MagicMock(return_value={"keys": []}),
                    )
                ),
            ),
        ):
            mock_jwk.import_key_set.return_value = fake_new_keyset
            result = await svc._get_jwks(  # pyright: ignore[reportPrivateUsage]
                _SHORT_NAME, force_refresh=False
            )
        assert result is fake_new_keyset


# ---------------------------------------------------------------------------
# State single-use enforcement
# ---------------------------------------------------------------------------


class TestStateSingleUse:
    async def test_first_use_succeeds(self) -> None:
        svc = _make_service()
        cache = svc._caches[_SHORT_NAME]  # pyright: ignore[reportPrivateUsage]
        await svc._enforce_single_use(cache, "fresh-state")  # pyright: ignore[reportPrivateUsage]

    async def test_second_use_raises(self) -> None:
        svc = _make_service()
        cache = svc._caches[_SHORT_NAME]  # pyright: ignore[reportPrivateUsage]
        await svc._enforce_single_use(cache, "replay-state")  # pyright: ignore[reportPrivateUsage]
        with pytest.raises(AuthenticationInvalidCredentials, match="already consumed"):
            await svc._enforce_single_use(cache, "replay-state")  # pyright: ignore[reportPrivateUsage]

    async def test_expired_states_swept(self) -> None:
        svc = _make_service()
        cache = svc._caches[_SHORT_NAME]  # pyright: ignore[reportPrivateUsage]
        cache.consumed_states["old-state"] = _ConsumedState(expires_at=time.monotonic() - 1)
        cache.last_sweep = time.monotonic() - 700

        await svc._enforce_single_use(cache, "new-state")  # pyright: ignore[reportPrivateUsage]
        assert "old-state" not in cache.consumed_states


# ---------------------------------------------------------------------------
# callback — state validation path
# ---------------------------------------------------------------------------


class TestCallbackStateMismatch:
    async def test_bad_cookie_signature_returns_failure(self) -> None:
        svc = _make_service()
        outcome = await svc.callback(
            short_name=_SHORT_NAME,
            code="code",
            received_state="stateABC",
            signed_state_cookie="stateABC.badsig",
            code_verifier="verifier",
            nonce="nonce",
            ip=None,
            user_agent=None,
        )
        assert isinstance(outcome, Failure)
        assert outcome.problem_code == "oidc.state_invalid"

    async def test_state_mismatch_returns_failure(self) -> None:
        svc = _make_service()
        cookie = _sign_state("different-state", _SECRET_KEY)
        outcome = await svc.callback(
            short_name=_SHORT_NAME,
            code="code",
            received_state="stateABC",
            signed_state_cookie=cookie,
            code_verifier="verifier",
            nonce="nonce",
            ip=None,
            user_agent=None,
        )
        assert isinstance(outcome, Failure)
        assert outcome.problem_code == "oidc.state_invalid"


# ---------------------------------------------------------------------------
# callback — full happy-path with mocked JWKS + DB
# ---------------------------------------------------------------------------


class TestCallbackHappyPath:
    async def _run_callback(
        self,
        *,
        nonce: str = "happy-nonce",
        link_policy: str = "link",
    ) -> tuple[object, OIDCService]:
        svc = _make_service(link_policy=link_policy)
        state = "happy-state"
        cookie = _sign_state(state, _SECRET_KEY)

        token_response = {
            "id_token": _make_jwt(
                alg="RS256",
                sub="sub123",
                nonce=nonce,
                email="user@example.com",
            ),
            "access_token": "at",
        }

        mock_user = MagicMock()
        mock_user.id = uuid.uuid4()

        claims = {"sub": "sub123", "email": "user@example.com", "nonce": nonce}

        with (
            patch.object(OIDCService, "_exchange_code", new=AsyncMock(return_value=token_response)),
            patch.object(OIDCService, "_validate_id_token", new=AsyncMock(return_value=claims)),
            patch.object(OIDCService, "_resolve_user", new=AsyncMock(return_value=mock_user)),
        ):
            outcome = await svc.callback(
                short_name=_SHORT_NAME,
                code="auth-code",
                received_state=state,
                signed_state_cookie=cookie,
                code_verifier="verifier",
                nonce=nonce,
                ip="1.2.3.4",
                user_agent="TestBrowser/1.0",
            )
        return outcome, svc

    async def test_success_returns_success_outcome(self) -> None:
        outcome, _ = await self._run_callback()
        assert isinstance(outcome, Success)
        assert outcome.auth_provider == AuthProvider.OIDC
        assert outcome.oidc_provider_name == _SHORT_NAME

    async def test_replay_second_callback_fails(self) -> None:
        svc = _make_service()
        state = "replay-state"
        cookie = _sign_state(state, _SECRET_KEY)

        claims = {"sub": "u", "email": "u@example.com", "nonce": "n"}
        with (
            patch.object(
                OIDCService, "_exchange_code", new=AsyncMock(return_value={"id_token": "x.y.z"})
            ),
            patch.object(OIDCService, "_validate_id_token", new=AsyncMock(return_value=claims)),
            patch.object(OIDCService, "_resolve_user", new=AsyncMock()),
        ):
            _ = await svc.callback(
                short_name=_SHORT_NAME,
                code="code",
                received_state=state,
                signed_state_cookie=cookie,
                code_verifier="v",
                nonce="n",
                ip=None,
                user_agent=None,
            )
            second = await svc.callback(
                short_name=_SHORT_NAME,
                code="code",
                received_state=state,
                signed_state_cookie=cookie,
                code_verifier="v",
                nonce="n",
                ip=None,
                user_agent=None,
            )
        assert isinstance(second, Failure)
        assert second.problem_code == "oidc.state_invalid"

    async def test_no_id_token_returns_failure(self) -> None:
        svc = _make_service()
        state = "st"
        cookie = _sign_state(state, _SECRET_KEY)
        exchange_mock = AsyncMock(return_value={"access_token": "x"})
        with patch.object(OIDCService, "_exchange_code", new=exchange_mock):
            outcome = await svc.callback(
                short_name=_SHORT_NAME,
                code="c",
                received_state=state,
                signed_state_cookie=cookie,
                code_verifier="v",
                nonce="n",
                ip=None,
                user_agent=None,
            )
        assert isinstance(outcome, Failure)
        assert outcome.problem_code == "oidc.no_id_token"

    async def test_token_exchange_failure_returns_failure(self) -> None:
        svc = _make_service()
        state = "st2"
        cookie = _sign_state(state, _SECRET_KEY)
        with patch.object(OIDCService, "_exchange_code", new=AsyncMock(return_value=None)):
            outcome = await svc.callback(
                short_name=_SHORT_NAME,
                code="c",
                received_state=state,
                signed_state_cookie=cookie,
                code_verifier="v",
                nonce="n",
                ip=None,
                user_agent=None,
            )
        assert isinstance(outcome, Failure)
        assert outcome.problem_code == "oidc.token_exchange_failed"


# ---------------------------------------------------------------------------
# Account linking policy — callback-level
# ---------------------------------------------------------------------------


class TestAccountLinkingPolicy:
    async def test_require_separate_callback_returns_failure(self) -> None:
        svc = _make_service(link_policy="require_separate")
        state = "ls"
        cookie = _sign_state(state, _SECRET_KEY)

        claims = {"sub": "sub999", "email": "x@y.com", "nonce": "n999"}
        token_response = {"id_token": _make_jwt(alg="RS256", sub="sub999", nonce="n999")}
        with (
            patch.object(OIDCService, "_exchange_code", new=AsyncMock(return_value=token_response)),
            patch.object(OIDCService, "_validate_id_token", new=AsyncMock(return_value=claims)),
            patch.object(
                OIDCService,
                "_resolve_user",
                new=AsyncMock(side_effect=AuthenticationAccountLinkingBlocked("blocked")),
            ),
        ):
            outcome = await svc.callback(
                short_name=_SHORT_NAME,
                code="c",
                received_state=state,
                signed_state_cookie=cookie,
                code_verifier="v",
                nonce="n999",
                ip=None,
                user_agent=None,
            )
        assert isinstance(outcome, Failure)
        assert outcome.problem_code == "oidc.account_linking_blocked"
