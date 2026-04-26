"""Repository package — public surface for Phase 2's read-side query API.

Phase 4+ extends this surface with writers; Phase 2 ships read-only methods
plus the encrypted-column-free connector ``pause`` toggle (plan §6 P4).
"""

from comradarr.repositories._pagination import Cursor
from comradarr.repositories.auth import AuthRepository
from comradarr.repositories.base import BaseRepository
from comradarr.repositories.connector import ConnectorRepository
from comradarr.repositories.content import ContentRepository

__all__ = [
    "AuthRepository",
    "BaseRepository",
    "ConnectorRepository",
    "ContentRepository",
    "Cursor",
]
