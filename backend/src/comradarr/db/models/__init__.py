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
