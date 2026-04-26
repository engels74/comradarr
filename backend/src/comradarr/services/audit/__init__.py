"""Audit services public surface — writer + retention vacuum (Phase 3 §5.3.3).

Two services collaborate on the ``audit_log`` row lifecycle:

* :class:`AuditWriter` — append-only INSERT path. Sole entrypoint for any
  code that needs to persist an audit row. Runs under the ``comradarr_app``
  role (the GRANT matrix permits SELECT, INSERT only on ``audit_log`` for
  this role).
* :class:`AuditRetentionVacuum` — DELETE path; runs under the
  ``comradarr_audit_admin`` role (the GRANT matrix permits SELECT, DELETE
  only). Single long-lived background task started in
  :mod:`comradarr.core.lifespan`.
"""

from comradarr.services.audit.vacuum import AuditRetentionVacuum, AuditRetentionVacuumHealth
from comradarr.services.audit.writer import AuditWriter

__all__ = [
    "AuditRetentionVacuum",
    "AuditRetentionVacuumHealth",
    "AuditWriter",
]
