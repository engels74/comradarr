"""Cross-cutting services package marker (Phase 3 §5.3.3).

Per-domain services live in nested packages (``comradarr.services.audit``,
``comradarr.services.crypto`` if/when extracted, etc.); this package itself
holds no public surface area beyond the marker so import-time side effects
remain ordered by the consumer (``app.py`` / ``core.lifespan``).
"""
