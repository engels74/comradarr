# pyright: reportAny=false, reportExplicitAny=false
"""Application factory (PATTERN-APP, plan §6).

:func:`create_app` is the canonical Litestar wiring for the project: it owns
plugin construction (SQLAlchemy + structlog), the middleware ordering
contract, the lifespan composition, the exception-handler registry, and the
unauthenticated OpenAPI surface that Phase 4/5 later gates.

The factory is **synchronous** — Litestar lifespan is async, but the factory
itself runs at import time and constructs the ``Litestar`` instance directly.
The module-level ``app`` binding at the bottom of this file is the target
Granian imports via ``comradarr.app:app`` (RECIPE-GRANIAN-RUN). Calling
``create_app()`` with no settings argument triggers
:func:`comradarr.config.load_settings` at import time — that is the contract
the C9 boot smoke test asserts (env vars are REQUIRED at import time). Tests
bypass the module-level instance and call ``create_app(settings=...)``
directly so they can pin :class:`Settings` without env-var monkeypatching.

Phase 1 deliberately leaves ``/api/schema``, ``/api/docs``, ``/api/redoc``
unauthenticated. The ``# Phase 4/5`` comment in :func:`create_app` marks the
attachment point; the README DoD block carries the loud R6 warning.
"""

from advanced_alchemy.extensions.litestar import (
    AsyncSessionConfig,
    SQLAlchemyAsyncConfig,
    SQLAlchemyPlugin,
)
from litestar import Litestar
from litestar.datastructures import State
from litestar.openapi import OpenAPIConfig
from litestar.openapi.plugins import (
    JsonRenderPlugin,
    RedocRenderPlugin,
    SwaggerRenderPlugin,
)
from litestar.plugins.structlog import StructlogPlugin

from comradarr import __version__
from comradarr.api.controllers.health import HealthController
from comradarr.api.middleware.correlation import correlation_id_middleware

# Settings imported at runtime (not TYPE_CHECKING-only): PEP 749 lazy
# annotations evaluate ``create_app``'s ``Settings | None`` annotation when
# Litestar / inspect.signature touches the factory, so the symbol must exist
# at runtime to avoid NameError on app boot.
from comradarr.config import Settings, load_settings
from comradarr.core.lifespan import db_lifespan, services_lifespan
from comradarr.core.logging import build_structlog_config
from comradarr.errors import ComradarrError
from comradarr.errors.handlers import (
    comradarr_error_handler,
    unhandled_exception_handler,
)


def create_app(settings: Settings | None = None) -> Litestar:
    """Build the canonical Litestar instance.

    Pass ``settings`` explicitly from tests to avoid the module-level
    :func:`load_settings` validation. The no-arg form is what Granian uses
    via the ``comradarr.app:app`` import target — that path triggers the
    full env-var validation chain (C9 contract).
    """
    if settings is None:
        settings = load_settings()

    db_config = SQLAlchemyAsyncConfig(
        connection_string=settings.database_url,
        session_config=AsyncSessionConfig(expire_on_commit=False),
        before_send_handler="autocommit",
        create_all=False,
    )
    sqlalchemy_plugin = SQLAlchemyPlugin(config=db_config)
    structlog_plugin = StructlogPlugin(config=build_structlog_config(settings))

    middleware = [
        correlation_id_middleware,
        # Phase 3: structlog request logging middleware
        # Phase 6: trusted_proxy_middleware
        # Phase 5: setup_gate_middleware
        # Phase 6: cors_middleware
        # Phase 6: csrf_middleware
        # Phase 6: security_headers_middleware
        # Phase 4: auth_middleware
        # Phase 4: permission_check_middleware
    ]

    # Phase 4/5: gate behind auth + apply schema_ip rate limit (10 req/hr/IP).
    # Schema JSON at /api/schema, Swagger UI at /api/docs, ReDoc at /api/redoc.
    # Mounting via path='/api' + per-plugin paths is the only Litestar 2.19 idiom
    # that yields sibling routes; the default '/schema' prefix would nest
    # swagger and redoc beneath /api/schema/.
    openapi_config = OpenAPIConfig(
        title="Comradarr",
        version=__version__,
        path="/api",
        render_plugins=[
            JsonRenderPlugin(path="/schema"),
            SwaggerRenderPlugin(path="/docs"),
            RedocRenderPlugin(path="/redoc"),
        ],
    )

    # db_lifespan reads `app.state.settings` (set here) and mounts the
    # engine + sessionmaker on app.state.
    app_state = State({"settings": settings})

    return Litestar(
        route_handlers=[HealthController],
        plugins=[sqlalchemy_plugin, structlog_plugin],
        middleware=middleware,
        lifespan=[db_lifespan, services_lifespan],
        exception_handlers={
            ComradarrError: comradarr_error_handler,
            Exception: unhandled_exception_handler,
        },
        openapi_config=openapi_config,
        state=app_state,
        debug=(settings.comradarr_log_format == "console"),
    )


# Module-level instance for granian comradarr.app:app target;
# tests use create_app(settings=...) directly. The no-arg create_app() triggers
# load_settings() at import time per the C9 contract.
app: Litestar = create_app()
