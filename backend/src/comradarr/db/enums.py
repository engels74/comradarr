"""Centralized PG-native ENUM definitions (plan §3 Milestone 1 step 3).

Every cross-domain enum that the schema persists as a PostgreSQL native ENUM
lives here. Models import the Python class directly and bind it at the column
declaration site via::

    from sqlalchemy import Enum as SAEnum

    SAEnum(SyncStatus, native_enum=True, name="sync_status")

Centralizing the Python enums in one module keeps the autogenerate side-effect
of "create the PG type" deterministic — the enum is created exactly once even
when multiple tables reference it, because the underlying ``sa.Enum`` instance
keys off ``name``.

Phase 2 owns the structural definitions only. Phase 3+ may extend members in
follow-up migrations (RULE-DB-005 — additive only; no value renames without
an explicit migration step).

Conventions:

* Every enum subclasses :class:`enum.StrEnum` so the wire form is the lowercase
  member name (e.g. ``ConnectorType.SONARR.value == "sonarr"``).
* PG-native ENUM names are lowercase ``snake_case`` (e.g. ``connector_type``).
* No ``from __future__ import annotations`` (RULE-PY-002 — PEP 749 lazy
  annotations).
"""

import enum


class ProvisioningProvider(enum.StrEnum):
    """How a user account was provisioned (PRD §8 / Phase 4)."""

    LOCAL = "local"
    TRUSTED_HEADER = "trusted_header"
    OIDC = "oidc"


class AuthProvider(enum.StrEnum):
    """Which authentication path issued the active session (PRD §8 / Phase 4)."""

    LOCAL = "local"
    TRUSTED_HEADER = "trusted_header"
    OIDC = "oidc"
    API_KEY = "api_key"


class ConnectorType(enum.StrEnum):
    """Outbound *arr-flavored connector kinds (PRD §13 / Phase 7)."""

    SONARR = "sonarr"
    RADARR = "radarr"
    PROWLARR = "prowlarr"


class CommandStatus(enum.StrEnum):
    """Lifecycle of a planned command dispatched at a connector (Phase 9)."""

    PENDING = "pending"
    DISPATCHED = "dispatched"
    RESOLVED = "resolved"
    FAILED = "failed"


class ChannelKind(enum.StrEnum):
    """Notification channel transport (PRD §12 / Phase 12)."""

    APPRISE = "apprise"
    WEBHOOK = "webhook"
    EMAIL = "email"


class ChannelTestStatus(enum.StrEnum):
    """Last-known reachability of a notification channel (Phase 12)."""

    UNTESTED = "untested"
    SUCCESS = "success"
    FAILURE = "failure"


class AuditAction(enum.StrEnum):
    """Exhaustive audit-log action codes (PRD §11 / Phase 3 §5.3.3).

    Members are append-only across releases; renaming requires a dedicated
    migration step. Keep this list synchronized with the PRD audit table.
    """

    USER_LOGIN_SUCCEEDED = "user.login.succeeded"
    USER_LOGIN_FAILED = "user.login.failed"
    USER_LOGOUT = "user.logout"
    USER_CREATED = "user.created"
    USER_UPDATED = "user.updated"
    USER_DELETED = "user.deleted"
    USER_ROLE_CHANGED = "user.role_changed"
    SESSION_REVOKED = "session.revoked"
    API_KEY_ISSUED = "api_key.issued"
    API_KEY_REVOKED = "api_key.revoked"
    OIDC_PROVIDER_CREATED = "oidc_provider.created"
    OIDC_PROVIDER_UPDATED = "oidc_provider.updated"
    OIDC_PROVIDER_DELETED = "oidc_provider.deleted"
    CONNECTOR_CREATED = "connector.created"
    CONNECTOR_UPDATED = "connector.updated"
    CONNECTOR_DELETED = "connector.deleted"
    CONNECTOR_PAUSED = "connector.paused"
    CONNECTOR_RESUMED = "connector.resumed"
    NOTIFICATION_CHANNEL_CREATED = "notification_channel.created"
    NOTIFICATION_CHANNEL_UPDATED = "notification_channel.updated"
    NOTIFICATION_CHANNEL_DELETED = "notification_channel.deleted"
    NOTIFICATION_ROUTE_CREATED = "notification_route.created"
    NOTIFICATION_ROUTE_UPDATED = "notification_route.updated"
    NOTIFICATION_ROUTE_DELETED = "notification_route.deleted"
    APP_CONFIG_UPDATED = "app_config.updated"
    APP_SECRET_UPDATED = "app_secret.updated"  # noqa: S105 — audit code, not a credential
    SETUP_CLAIMED = "setup.claimed"
    SEARCH_PRIORITY_QUEUED = "search.priority_queued"
    SEARCH_RAN = "search.ran"
    # Phase 3 §5.3 additions — bootstrap, setup-claim, login lifecycle, manual
    # operator triggers, and snapshot import/export. Migration
    # ``phase3_audit_action_extensions.py`` ALTERs the PG ``audit_action``
    # enum to include each value via ``ADD VALUE IF NOT EXISTS`` (the only
    # additive enum-extension form Postgres supports outside a transaction).
    BOOTSTRAP_TOKEN_GENERATED = "bootstrap_token.generated"  # noqa: S105 — audit code
    SETUP_CLAIM_GRANTED = "setup_claim.granted"
    SETUP_CLAIM_REJECTED = "setup_claim.rejected"
    ADMIN_ACCOUNT_CREATED = "admin_account.created"
    SETUP_COMPLETED = "setup.completed"
    LOGIN_SUCCESS = "login.success"
    LOGIN_FAILED = "login.failed"
    PASSWORD_CHANGED = "password.changed"  # noqa: S105 — audit code, not a credential
    API_KEY_FIRST_USED = "api_key.first_used"
    HTTP_BOUNDARY_CHANGED = "http_boundary.changed"
    MANUAL_SEARCH_TRIGGERED = "manual_search.triggered"
    MANUAL_SYNC_TRIGGERED = "manual_sync.triggered"
    SNAPSHOT_EXPORTED = "snapshot.exported"
    SNAPSHOT_IMPORTED = "snapshot.imported"


class SyncStatus(enum.StrEnum):
    """Sync-engine state per connector (Phase 9)."""

    IDLE = "idle"
    RUNNING = "running"
    FAILED = "failed"


class ContentType(enum.StrEnum):
    """Discriminator for rotation/search across mirror-content kinds (Phase 10)."""

    SERIES = "series"
    EPISODE = "episode"
    MOVIE = "movie"


class UserRole(enum.StrEnum):
    """Role-based access control (PRD §8). Extensible — Phase 4 may add."""

    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"
