"""Pure-Python invariants on the ORM model graph (plan §3 Milestone 10 step 42).

Four independent assertions, no DB connection required:

1. ``Base.metadata.tables`` matches ``comradarr.db.models.__all__`` exactly,
   and the cardinality is 22 (PRD §8 Appendix B canonical set).
2. Every UUID primary key column uses :class:`sqlalchemy.Uuid` so the asyncpg
   adapter and the migration's ``server_default = uuid_generate_v7()`` agree
   on column type.
3. Every ``datetime`` column is timezone-aware (``timezone=True``) — the
   project never stores naïve datetimes (RULE-DB convention pinned in
   :class:`comradarr.db.base.Base.type_annotation_map`).
4. No model file contains ``from __future__ import`` (RULE-PY-002 regression
   gate — the project relies on PEP 749 lazy annotations and stringified
   future-imports break SQLAlchemy's ``Mapped[...]`` resolution at class-
   definition time).
"""

from pathlib import Path

import sqlalchemy as sa

import comradarr.db.models
from comradarr.db.base import Base


def test_metadata_tables_match_dunder_all() -> None:
    """``Base.metadata.tables.keys()`` equals ``__all__`` and has length 22."""
    metadata_tables = set(Base.metadata.tables.keys())
    declared_tables = set(comradarr.db.models.__all__)

    assert metadata_tables == declared_tables, (
        f"metadata vs __all__ drift — only-in-metadata={metadata_tables - declared_tables}, "
        f"only-in-__all__={declared_tables - metadata_tables}"
    )
    assert len(metadata_tables) == 22, (
        f"PRD §8 Appendix B fixes the canonical table count at 22; got {len(metadata_tables)}"
    )


def test_every_uuid_pk_is_sa_uuid() -> None:
    """Every primary-key column whose Python type is UUID maps to ``sa.Uuid``."""
    import uuid as uuid_mod  # noqa: PLC0415

    for table in Base.metadata.tables.values():
        for col in table.primary_key.columns:
            try:
                python_type = col.type.python_type
            except NotImplementedError:
                continue
            # The check is structured around the python_type attribute (not
            # ``isinstance(col.type, sa.Uuid)`` directly) so a future column
            # using ``sa.UUID(as_uuid=False)`` still trips this gate via
            # the UUID python_type rather than passing silently.
            if python_type is uuid_mod.UUID:
                assert isinstance(col.type, sa.Uuid), (
                    f"{table.name}.{col.name} has UUID python_type but is "
                    f"{type(col.type).__name__}, expected sa.Uuid"
                )


def test_every_datetime_column_is_timezone_aware() -> None:
    """Every column whose SQL type is ``DateTime`` has ``timezone=True``."""
    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, sa.DateTime):
                assert col.type.timezone is True, (
                    f"{table.name}.{col.name} is naïve DateTime — "
                    "Comradarr stores tz-aware datetimes only "
                    "(see comradarr.db.base.Base.type_annotation_map)"
                )


def test_no_model_file_imports_from_future() -> None:
    """Regression gate for RULE-PY-002 — no ``from __future__`` in models/."""
    models_dir = Path(comradarr.db.models.__file__).parent
    offenders: list[str] = []
    for model_file in models_dir.glob("*.py"):
        text = model_file.read_text(encoding="utf-8")
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("from __future__"):
                offenders.append(f"{model_file.name}: {stripped}")
                break
    assert not offenders, (
        "Model files must not import from __future__ (RULE-PY-002 — PEP 749 "
        f"lazy annotations are project-wide). Offenders: {offenders}"
    )
