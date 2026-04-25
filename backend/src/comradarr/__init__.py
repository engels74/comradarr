"""Comradarr backend package.

``__version__`` is a string literal pinned to ``pyproject.toml`` ``[project]
version`` (C5 burndown). Keeping it a literal means importing :mod:`comradarr`
costs nothing — :func:`importlib.metadata.version` would force the editable
install metadata to be resolved on every import. Phase 20+ may swap to
``importlib.metadata.version("comradarr")`` once the build pipeline ships
wheels with stable metadata.
"""

__version__: str = "0.0.0"
