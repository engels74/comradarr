"""Comradarr ORM model registry — side-effect imports for Alembic autogenerate.

Each submodule import below registers its model class with SQLAlchemy's
declarative metadata via the ``Base`` subclass side effect. Alembic's
autogenerate and the migration runner both rely on this package being
imported once before they consult ``Base.metadata``.
"""

from . import api_key as _api_key  # noqa: F401  # pyright: ignore[reportUnusedImport]
from . import api_key_scope as _api_key_scope  # noqa: F401  # pyright: ignore[reportUnusedImport]
from . import app_config as _app_config  # noqa: F401  # pyright: ignore[reportUnusedImport]
from . import audit_log as _audit_log  # noqa: F401  # pyright: ignore[reportUnusedImport]
from . import (
    auth_rate_limit as _auth_rate_limit,  # noqa: F401  # pyright: ignore[reportUnusedImport]
)
from . import connector as _connector  # noqa: F401  # pyright: ignore[reportUnusedImport]
from . import mirror as _mirror  # noqa: F401  # pyright: ignore[reportUnusedImport]
from . import notification as _notification  # noqa: F401  # pyright: ignore[reportUnusedImport]
from . import oidc_provider as _oidc_provider  # noqa: F401  # pyright: ignore[reportUnusedImport]
from . import (
    planned_command as _planned_command,  # noqa: F401  # pyright: ignore[reportUnusedImport]
)
from . import (
    priority_search as _priority_search,  # noqa: F401  # pyright: ignore[reportUnusedImport]
)
from . import (
    role_permission as _role_permission,  # noqa: F401  # pyright: ignore[reportUnusedImport]
)
from . import (
    search_schedule as _search_schedule,  # noqa: F401  # pyright: ignore[reportUnusedImport]
)
from . import session as _session  # noqa: F401  # pyright: ignore[reportUnusedImport]
from . import sync_state as _sync_state  # noqa: F401  # pyright: ignore[reportUnusedImport]
from . import user as _user  # noqa: F401  # pyright: ignore[reportUnusedImport]
from . import (
    user_preference as _user_preference,  # noqa: F401  # pyright: ignore[reportUnusedImport]
)

# Canonical 22-table set (PRD §8 Appendix B). Read by Wave 4's role-permission
# matrix test, the alembic-clean linter, and the GRANT-list extension contract
# inside ``backend/migrations/versions/361c239a829d_v1_baseline_schema.py``.
# These are TABLE names (PRD spec), not module names — the ``__all__`` shape is
# documentation-only here, so suppress the dunder-all entry checks per-line.
__all__: tuple[str, ...] = (
    "users",  # pyright: ignore[reportUnsupportedDunderAll]
    "sessions",  # pyright: ignore[reportUnsupportedDunderAll]
    "api_keys",  # pyright: ignore[reportUnsupportedDunderAll]
    "auth_rate_limits",  # pyright: ignore[reportUnsupportedDunderAll]
    "oidc_providers",  # pyright: ignore[reportUnsupportedDunderAll]
    "role_permissions",  # pyright: ignore[reportUnsupportedDunderAll]
    "api_key_scopes",  # pyright: ignore[reportUnsupportedDunderAll]
    "connectors",  # pyright: ignore[reportUnsupportedDunderAll]
    "mirror_series",  # pyright: ignore[reportUnsupportedDunderAll]
    "mirror_episodes",  # pyright: ignore[reportUnsupportedDunderAll]
    "mirror_movies",  # pyright: ignore[reportUnsupportedDunderAll]
    "search_schedule",  # pyright: ignore[reportUnsupportedDunderAll]
    "planned_commands",  # pyright: ignore[reportUnsupportedDunderAll]
    "priority_searches",  # pyright: ignore[reportUnsupportedDunderAll]
    "sync_state",  # pyright: ignore[reportUnsupportedDunderAll]
    "app_config",  # pyright: ignore[reportUnsupportedDunderAll]
    "app_secrets",  # pyright: ignore[reportUnsupportedDunderAll]
    "user_preferences",  # pyright: ignore[reportUnsupportedDunderAll]
    "notification_channels",  # pyright: ignore[reportUnsupportedDunderAll]
    "notification_routes",  # pyright: ignore[reportUnsupportedDunderAll]
    "notification_templates",  # pyright: ignore[reportUnsupportedDunderAll]
    "audit_log",  # pyright: ignore[reportUnsupportedDunderAll]
)
