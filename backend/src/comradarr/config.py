"""Settings loader for Comradarr.

Loads frozen settings from environment variables (or an injected mapping for
tests), resolves the ``_FILE`` suffix for secret-bearing variables, parses the
per-provider OIDC env-var pattern, validates the master secret-key against the
denylist + structural checks, and refuses any DSN that is not asyncpg-shaped.
Failures raise :class:`ConfigurationError` BEFORE Litestar lifespan begins
(plan §5.1.1, principle #4: fail-closed config).
"""

import os
import pathlib
import re
from typing import TYPE_CHECKING, Final, Literal

import msgspec
import structlog

if TYPE_CHECKING:
    from collections.abc import Mapping

from comradarr.errors.configuration import ConfigurationError
from comradarr.security.secret_key import validate_secret_key

LogFormat = Literal["json", "console"]
LinkPolicy = Literal["link", "require_separate"]

_SECRET_KEY_RE: Final = re.compile(r"^COMRADARR_SECRET_KEY(?:_V(\d+))?(_FILE)?$")
_OIDC_RE: Final = re.compile(
    r"^COMRADARR_OIDC_(?P<provider>[A-Z0-9]+)_(?P<field>[A-Z_]+?)(?P<file>_FILE)?$"
)
_REQUIRED_DSN_PREFIX: Final = "postgresql+asyncpg://"

# Field-name → expected env-var-suffix table for OIDC providers. Matches the
# per-provider env pattern documented in PRD §19 and plan §5.1.1 Step 2.2.
_OIDC_FIELD_MAP: Final[Mapping[str, str]] = {
    "CLIENT_ID": "client_id",
    "CLIENT_SECRET": "client_secret",
    "DISCOVERY_URL": "discovery_url",
    "REDIRECT_URI": "redirect_uri",
    "SCOPES": "scopes",
    "LINK_POLICY": "link_policy",
}


class OIDCProviderSettings(msgspec.Struct, frozen=True, kw_only=True):
    """Per-provider OIDC configuration.

    The client secret bytes are NOT loaded in Phase 1 — only the file path is
    captured. Phase 4 (auth providers) reads the file at provider-init time and
    wraps the bytes in :class:`Secret[bytes]` (Phase 3).
    """

    client_id: str
    client_secret_path: pathlib.Path
    discovery_url: str
    redirect_uri: str
    scopes: tuple[str, ...] = ("openid", "email", "profile")
    link_policy: LinkPolicy = "link"


class Settings(msgspec.Struct, frozen=True, kw_only=True):
    """Frozen runtime settings.

    Field names use the ``comradarr_<snake_case>`` convention so the env-var
    convention ``COMRADARR_<UPPER_SNAKE>`` from PRD §19 maps mechanically.
    ``database_url`` is the lone exception (mirrors PRD §19 line 1482).
    """

    # TODO(Phase 3): wrap in Secret[bytes] once §5.3.1 lands. Until then the
    # structlog secret_pattern_redaction_processor masks the field value when
    # it appears inside a log event.
    comradarr_secret_key: bytes | None
    secret_key_versions: dict[int, bytes]
    current_key_version: int

    database_url: str

    comradarr_insecure_cookies: bool = False
    comradarr_csp_report_only: bool = False
    comradarr_log_level: str = "INFO"
    comradarr_log_format: LogFormat = "json"
    comradarr_log_dedup_per_minute: int = 100
    comradarr_recovery_mode: bool = False
    comradarr_disable_local_login: bool = False
    # Q4 implementation: default False in Phase 1; Phase 2 flips per environment.
    comradarr_run_migrations_on_startup: bool = False

    oidc_providers: dict[str, OIDCProviderSettings] = msgspec.field(default_factory=dict)


def _read_secret_bytes(inline: str | None, file_path: str | None, *, var_name: str) -> bytes | None:
    """Resolve a secret-bearing variable. ``_FILE`` wins on conflict."""
    if file_path is not None:
        path = pathlib.Path(file_path)
        try:
            return path.read_bytes().strip()
        except OSError as exc:
            raise ConfigurationError(f"{var_name}_FILE: cannot read {path}: {exc}") from exc
    if inline is not None:
        # Hex is the documented encoding (`secrets.token_hex(32)`); raw bytes
        # are a fallback for human-supplied test values.
        try:
            return bytes.fromhex(inline)
        except ValueError:
            return inline.encode()
    return None


def _parse_secret_key_registry(env: Mapping[str, str]) -> dict[int, bytes]:
    """Parse ``COMRADARR_SECRET_KEY[_V<n>][_FILE]`` env vars into ``{version: bytes}``.

    ``v1`` corresponds to the suffix-less form (plan §5.1.1 Step 2.5). Both the
    inline and ``_FILE`` form may be present for the same version; ``_FILE``
    wins and a structured warning is emitted.
    """
    log = structlog.stdlib.get_logger("comradarr.config")
    by_version: dict[int, dict[str, str]] = {}

    for key, value in env.items():
        match = _SECRET_KEY_RE.match(key)
        if not match:
            continue
        version = int(match.group(1)) if match.group(1) else 1
        slot = "file" if match.group(2) == "_FILE" else "inline"
        by_version.setdefault(version, {})[slot] = value

    result: dict[int, bytes] = {}
    for version, slots in sorted(by_version.items()):
        inline = slots.get("inline")
        file_path = slots.get("file")
        if inline is not None and file_path is not None:
            log.warning("settings.key.both_forms_present", version=version)
        var_name = "COMRADARR_SECRET_KEY" if version == 1 else f"COMRADARR_SECRET_KEY_V{version}"
        key_bytes = _read_secret_bytes(inline, file_path, var_name=var_name)
        if key_bytes is None:
            # Defensive — the regex match guarantees at least one slot is set.
            continue
        result[version] = key_bytes
    return result


def _parse_oidc_providers(env: Mapping[str, str]) -> dict[str, OIDCProviderSettings]:
    """Parse ``COMRADARR_OIDC_<PROVIDER>_<FIELD>[_FILE]`` env vars.

    Each provider must minimally supply ``CLIENT_ID``, ``DISCOVERY_URL``,
    ``REDIRECT_URI``, and either ``CLIENT_SECRET`` or ``CLIENT_SECRET_FILE``.
    Missing-but-mentioned providers raise :class:`ConfigurationError`.
    """
    raw: dict[str, dict[str, dict[str, str]]] = {}

    for key, value in env.items():
        match = _OIDC_RE.match(key)
        if not match:
            continue
        provider = match.group("provider").lower()
        field = match.group("field")
        slot = "file" if match.group("file") == "_FILE" else "inline"
        if field not in _OIDC_FIELD_MAP:
            continue
        raw.setdefault(provider, {}).setdefault(field, {})[slot] = value

    providers: dict[str, OIDCProviderSettings] = {}
    for provider, fields in sorted(raw.items()):
        try:
            client_id = fields["CLIENT_ID"]["inline"]
            discovery_url = fields["DISCOVERY_URL"]["inline"]
            redirect_uri = fields["REDIRECT_URI"]["inline"]
        except KeyError as exc:
            raise ConfigurationError(
                f"COMRADARR_OIDC_{provider.upper()}: missing required field {exc.args[0]}"
            ) from exc

        secret_slot = fields.get("CLIENT_SECRET", {})
        secret_file = secret_slot.get("file")
        if secret_file is None:
            raise ConfigurationError(
                f"COMRADARR_OIDC_{provider.upper()}_CLIENT_SECRET_FILE is required"
            )

        scopes_raw = fields.get("SCOPES", {}).get("inline")
        scopes: tuple[str, ...] = (
            tuple(s.strip() for s in scopes_raw.split(",") if s.strip())
            if scopes_raw
            else ("openid", "email", "profile")
        )

        link_raw = fields.get("LINK_POLICY", {}).get("inline", "link")
        if link_raw not in ("link", "require_separate"):
            raise ConfigurationError(
                f"COMRADARR_OIDC_{provider.upper()}_LINK_POLICY: "
                + "must be 'link' or 'require_separate'"
            )

        providers[provider] = OIDCProviderSettings(
            client_id=client_id,
            client_secret_path=pathlib.Path(secret_file),
            discovery_url=discovery_url,
            redirect_uri=redirect_uri,
            scopes=scopes,
            link_policy=link_raw,
        )
    return providers


def _parse_bool(env: Mapping[str, str], name: str, *, default: bool) -> bool:
    raw = env.get(name)
    if raw is None:
        return default
    lowered = raw.strip().lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off", ""):
        return False
    raise ConfigurationError(f"{name}: cannot parse {raw!r} as bool")


def _parse_int(env: Mapping[str, str], name: str, *, default: int) -> int:
    raw = env.get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigurationError(f"{name}: cannot parse {raw!r} as int") from exc


def _parse_log_format(env: Mapping[str, str]) -> LogFormat:
    raw = env.get("COMRADARR_LOG_FORMAT", "json").strip().lower()
    if raw not in ("json", "console"):
        raise ConfigurationError("COMRADARR_LOG_FORMAT: must be 'json' or 'console'")
    return raw


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    """Load and validate frozen :class:`Settings` from environment.

    Reads ``os.environ`` by default; tests pass an explicit ``env`` mapping to
    avoid leaking process state. Raises :class:`ConfigurationError` on the
    first validation failure (fail-closed config — no degraded continuation).
    """
    source: Mapping[str, str] = env if env is not None else os.environ

    versions = _parse_secret_key_registry(source)
    if not versions:
        raise ConfigurationError(
            "COMRADARR_SECRET_KEY (or COMRADARR_SECRET_KEY_FILE / "
            + "COMRADARR_SECRET_KEY_V<n>[_FILE]) must be set"
        )
    for version, key_bytes in versions.items():
        try:
            validate_secret_key(key_bytes)
        except ConfigurationError as exc:
            raise ConfigurationError(f"COMRADARR_SECRET_KEY[v{version}]: {exc}") from exc

    current_version = max(versions)

    database_url = source.get("DATABASE_URL")
    if not database_url:
        raise ConfigurationError("DATABASE_URL is required")
    if not database_url.startswith(_REQUIRED_DSN_PREFIX):
        raise ConfigurationError(
            f"DATABASE_URL must use the {_REQUIRED_DSN_PREFIX} driver (RULE-DB-002)"
        )

    return Settings(
        comradarr_secret_key=versions[current_version],
        secret_key_versions=versions,
        current_key_version=current_version,
        database_url=database_url,
        comradarr_insecure_cookies=_parse_bool(source, "COMRADARR_INSECURE_COOKIES", default=False),
        comradarr_csp_report_only=_parse_bool(source, "COMRADARR_CSP_REPORT_ONLY", default=False),
        comradarr_log_level=source.get("COMRADARR_LOG_LEVEL", "INFO"),
        comradarr_log_format=_parse_log_format(source),
        comradarr_log_dedup_per_minute=_parse_int(
            source, "COMRADARR_LOG_DEDUP_PER_MINUTE", default=100
        ),
        comradarr_recovery_mode=_parse_bool(source, "COMRADARR_RECOVERY_MODE", default=False),
        comradarr_disable_local_login=_parse_bool(
            source, "COMRADARR_DISABLE_LOCAL_LOGIN", default=False
        ),
        comradarr_run_migrations_on_startup=_parse_bool(
            source, "COMRADARR_RUN_MIGRATIONS_ON_STARTUP", default=False
        ),
        oidc_providers=_parse_oidc_providers(source),
    )
