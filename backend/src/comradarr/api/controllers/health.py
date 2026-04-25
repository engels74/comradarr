"""Unauthenticated health endpoint (PRD §24 / Phase 1 only public route).

The endpoint is deliberately minimal in Phase 1: ``status: ok`` plus a
``components`` map advertising ``db: unconfigured`` (no real DB probe — Phase
2 lights that up) and the package ``version``. The :func:`health` handler
sets ``sync_to_thread=False`` because the body is pure Python with no I/O —
spawning a worker thread for a synchronous dict literal would only add
latency.

Authentication gating arrives in Phase 5's setup-gate middleware via the
allowlist; in Phase 1 the route is intentionally exposed so the Granian
launcher's container probe can hit it before any auth surface exists. R6
warns about this in the README DoD block.
"""

from litestar import Controller, get

from comradarr import __version__


class HealthController(Controller):
    """Liveness probe served at ``/health`` (no auth)."""

    path: str = "/health"

    @get("/", sync_to_thread=False)
    async def health(self) -> dict[str, object]:
        """Return a static liveness payload — no DB probe in Phase 1."""
        return {
            "status": "ok",
            "components": {
                "db": "unconfigured",
                "version": __version__,
            },
        }
