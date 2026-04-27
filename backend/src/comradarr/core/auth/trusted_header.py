# pyright: reportUnknownMemberType=false, reportUnusedCallResult=false
# src/comradarr/core/auth/trusted_header.py
"""TrustedHeaderProvider — socket-peer CIDR gate + header-only identity (Phase 4 Slice F §5.4.3).

Trust model:
  1. Socket peer IP (scope["client"][0]) MUST be in the configured CIDR allowlist.
     This check runs BEFORE any header is read.
     See RULE-AUTHZ-MATCH-001 carve-out: CIDR matching is the documented exception
     to exact-string equality; see PRD §15 line 821 for the authoritative rationale.
  2. Username header (default ``Remote-User``) carries the identity claim.
     Headers are NEVER authentication — they are identity only.
  3. User provisioning: ``auto_provision`` (default) creates the row on first
     sight; ``strict_match`` rejects unknown usernames with Failure.

Dual-actor audit: LOGIN_SUCCESS records both the trusted proxy IP and the
username header value so the audit trail can reconstruct the trust chain.
"""

import ipaddress
from typing import TYPE_CHECKING, final

import structlog

from comradarr.core.auth.protocol import AuthOutcome, Failure, NotApplicable, Success
from comradarr.db.enums import AuditAction, AuthProvider, ProvisioningProvider, UserRole

if TYPE_CHECKING:
    from litestar.types import Scope
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from comradarr.config import Settings
    from comradarr.repositories.auth import UserRepository
    from comradarr.services.audit.writer import AuditWriter

_logger = structlog.stdlib.get_logger(__name__)

_IPv4Network = ipaddress.IPv4Network
_IPv6Network = ipaddress.IPv6Network
_AllowlistEntry = _IPv4Network | _IPv6Network


def parse_cidr_allowlist(cidrs: list[str]) -> tuple[_AllowlistEntry, ...]:
    """Parse a list of CIDR strings into a cached tuple of network objects.

    Called once at lifespan startup so per-request matching is a pure O(n)
    loop with no string parsing overhead. Raises ``ValueError`` on invalid
    CIDR notation (surfaced as a startup warning, not a hard failure).
    """
    result: list[_AllowlistEntry] = []
    for cidr in cidrs:
        result.append(ipaddress.ip_network(cidr, strict=False))
    return tuple(result)


def _peer_ip_allowed(
    peer_ip: str,
    allowlist: tuple[_AllowlistEntry, ...],
) -> bool:
    # RULE-AUTHZ-MATCH-001 carve-out: CIDR containment is the documented
    # exception to exact-string equality; PRD §15 line 821 authorises this.
    try:
        addr = ipaddress.ip_address(peer_ip)
    except ValueError:
        return False
    return any(addr in network for network in allowlist)


def _extract_header(headers: list[tuple[bytes, bytes]], name: str) -> str | None:
    """Extract the first matching header value (case-insensitive name match)."""
    name_lower = name.lower().encode()
    for key, value in headers:
        if key.lower() == name_lower:
            return value.decode(errors="replace")
    return None


def emit_startup_warnings(settings: Settings) -> None:
    """Emit operator-misconfiguration warnings at lifespan startup.

    Slice K calls this via ``app.state.startup_warnings``. Slice F defines
    the warning events and provides this helper; Slice K wires the call.
    """
    if not settings.trusted_header_auth_enabled:
        return

    proxy_ips = settings.trusted_header_auth_proxy_ips
    world_cidrs = {"0.0.0.0/0", "::/0"}
    if not proxy_ips or set(proxy_ips) & world_cidrs:
        _logger.warning(
            "trusted_header.world_readable_proxy_ips",
            proxy_ips=proxy_ips,
        )

    if not settings.trusted_header_auth_logout_url:
        _logger.warning("trusted_header.logout_url_missing")


@final
class TrustedHeaderProvider:
    """Auth provider that trusts a proxy-injected username header.

    Instances are created once at lifespan startup with a pre-parsed CIDR
    allowlist so per-request matching is cheap.
    """

    __slots__: tuple[str, ...] = ("_settings", "_audit", "_allowlist", "_sessionmaker")

    def __init__(
        self,
        settings: Settings,
        audit: AuditWriter,
        allowlist: tuple[_AllowlistEntry, ...],
        sessionmaker: async_sessionmaker[AsyncSession] | None = None,
    ) -> None:
        self._settings = settings
        self._audit = audit
        self._allowlist = allowlist
        self._sessionmaker = sessionmaker

    def _build_user_repo(self, db_session: AsyncSession) -> UserRepository:
        from comradarr.repositories.auth import UserRepository  # noqa: PLC0415

        return UserRepository(db_session)

    async def authenticate(
        self,
        scope: Scope,
        headers: list[tuple[bytes, bytes]],
    ) -> AuthOutcome:
        """Authenticate via trusted-proxy header.

        Returns ``NotApplicable`` when the feature is disabled or when the
        socket peer is not in the CIDR allowlist (so the next provider runs).
        Returns ``Failure`` only when the peer is trusted but the username
        cannot be resolved under the ``strict_match`` policy.
        """
        if not self._settings.trusted_header_auth_enabled:
            return NotApplicable()

        # scope["client"] is tuple[str, int] | None per ASGI spec; key may be
        # absent in test scopes that omit it, so use .get() defensively.
        raw_client = scope.get("client")  # type: ignore[literal-required]
        if not raw_client:
            return NotApplicable()
        client_typed: tuple[str, int] = raw_client  # type: ignore[assignment]

        peer_ip: str = client_typed[0]

        # CIDR gate — runs BEFORE any header read (PRD §15 security requirement).
        if not _peer_ip_allowed(peer_ip, self._allowlist):
            return NotApplicable()

        header_name = self._settings.trusted_header_auth_username_header
        header_value = _extract_header(headers, header_name)
        if not header_value:
            return NotApplicable()

        email_header_name = self._settings.trusted_header_auth_email_header
        email_value = _extract_header(headers, email_header_name) or ""

        # Resolve sessionmaker: from stored instance or from scope["app"].state.
        sessionmaker = self._sessionmaker
        if sessionmaker is None:
            litestar_app = scope.get("app")  # type: ignore[literal-required]
            sessionmaker = getattr(getattr(litestar_app, "state", None), "db_sessionmaker", None)
        if sessionmaker is None:
            return NotApplicable()

        async with sessionmaker() as db_session:
            user_repo = self._build_user_repo(db_session)
            user = await user_repo.get_by_username(header_value)

            if user is None:
                policy = self._settings.trusted_header_auth_provision_policy
                if policy == "strict_match":
                    _logger.info(
                        "trusted_header.strict_match.unknown_user",
                        username=header_value,
                        peer_ip=peer_ip,
                    )
                    return Failure(
                        reason="Unknown user under strict_match policy",
                        problem_code="authentication.unknown_user",
                    )

                # auto_provision: create the user row with the TRUSTED_HEADER sentinel.
                user = await user_repo.create_provisioned(
                    email=email_value or f"{header_value}@trusted-header.local",
                    username=header_value,
                    provisioning_provider=ProvisioningProvider.TRUSTED_HEADER,
                    role=UserRole.VIEWER,
                )
                freshly_provisioned = True
            else:
                freshly_provisioned = False

            await db_session.commit()

        await self._audit.record(
            action=AuditAction.LOGIN_SUCCESS,
            actor_user_id=user.id,
            context={
                "trusted_proxy_ip": peer_ip,
                "username_header_value": header_value,
            },
            ip=peer_ip,
            user_agent=None,
        )

        return Success(
            user_id=user.id,
            auth_provider=AuthProvider.TRUSTED_HEADER,
            freshly_provisioned=freshly_provisioned,
        )
