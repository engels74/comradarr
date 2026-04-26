"""Comradarr ORM model registry — side-effect imports for Alembic autogenerate.

Each submodule import below registers its model class with SQLAlchemy's
declarative metadata via the ``Base`` subclass side effect. Alembic's
autogenerate and the migration runner both rely on this package being
imported once before they consult ``Base.metadata``.
"""
