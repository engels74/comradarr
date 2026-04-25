"""Granian launch entrypoint (RECIPE-GRANIAN-RUN, PRD §24).

``python -m comradarr`` and ``uv run comradarr`` both land here. The entire
job of :func:`main` is to ``os.execvp("granian", [...])`` with the canonical
flag set — no asyncio, no settings validation, no logging configuration.
``execvp`` replaces the current process image, so:

* Settings validation runs **post-exec** when Granian imports
  ``comradarr.app:app`` and that import triggers ``create_app()`` →
  ``load_settings()`` (C9). A failed validation raises ``ConfigurationError``
  inside Granian's import; the worker exits non-zero; the operator sees the
  failure in Granian's log line.
* Signal forwarding stays correct because there is no parent-Python →
  child-Granian pyramid — the PID stays the same.
* RULE-ASYNC-002 holds trivially: no asyncio code runs in this module.

``COMRADARR_RUN_MODE`` selects between two flag profiles:

* ``prod`` (default) — binds ``0.0.0.0:8000``, no ``--reload``. **R6 warns**
  that this exposes the unauthenticated OpenAPI surface to the network in
  Phase 1; the README DoD block carries the warning.
* ``dev`` — binds ``127.0.0.1:8000`` (loopback-only), enables ``--reload``.
  Safe for local development.
"""

import os


def main() -> None:
    """Exec Granian with the canonical flag set; never returns on success."""
    run_mode = os.environ.get("COMRADARR_RUN_MODE", "prod")

    base_args: list[str] = [
        "granian",
        "--interface",
        "asgi",
        "--port",
        "8000",
        "--workers",
        "1",
        "--loop",
        "uvloop",
        "--workers-lifetime",
        "21600",
        "--respawn-failed-workers",
        "--log-access",
    ]

    if run_mode == "dev":
        # Loopback-only + auto-reload — safe for local development.
        granian_args = [
            *base_args,
            "--host",
            "127.0.0.1",
            "--reload",
            "comradarr.app:app",
        ]
    else:
        # PRD §24 mandates 0.0.0.0:8000 in prod; R6 mitigation lives in the
        # README security warning, not here.
        granian_args = [
            *base_args,
            "--host",
            "0.0.0.0",  # noqa: S104 (RECIPE-GRANIAN-RUN / PRD §24)
            "comradarr.app:app",
        ]

    # RULE-ASYNC-002 attestation: __main__ runs no asyncio code; Granian owns the loop.
    os.execvp("granian", granian_args)  # noqa: S606, S607  (fixed binary, fixed flag set, intentional PATH lookup)


if __name__ == "__main__":
    main()
