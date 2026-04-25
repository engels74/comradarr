# Changelog

All notable changes to Comradarr are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added — Phase 1: Backend skeleton

- Litestar 2.19 application factory (`comradarr/app.py`) wiring SQLAlchemy + structlog plugins, correlation-id middleware, RFC 9457 problem+json exception handlers, OpenAPI controller (`/api/schema`, `/api/docs`, `/api/redoc`), and the `db_lifespan` + `services_lifespan` managers.
- Frozen msgspec `Settings` (`comradarr/config.py`) with master-key version registry, OIDC per-provider env-var parser, leaked-keys denylist, secret-key entropy / structural validators, and the `postgresql+asyncpg://` DSN guard (RULE-DB-002).
- `ConfigurationError` (stdlib `Exception` subclass — no HTTP semantics) raised pre-lifespan for every configuration failure path.
- structlog logging module (`comradarr/core/logging.py`) — RECIPE-STRUCTLOG canonical chain with header redaction, secret-pattern redaction (Argon2id, JWT, `cmrr_live_*`, AES-GCM blob shape), token-bucket dedup throttle, and JSON / console renderer split.
- ComradarrError hierarchy (`comradarr/errors/`) — authentication, authorization, connector (with `retryable: bool`), validation (with `errors[]`), internal — plus the RFC 9457 envelope handlers (`urn:comradarr:<code>` URN scheme).
- `db/base.py` (`Base(AsyncAttrs, DeclarativeBase)` + UUIDv7 PK helper), `core/events.py` (`EventName` placeholder), `api/middleware/correlation.py` (uuid7 + structlog contextvars), `core/lifespan.py` (`db_lifespan` + `services_lifespan` with Phase N slot comments).
- `HealthController` (`/health` returning `{status, components}`) + `__version__` literal + Granian launch entrypoint (`comradarr.__main__:main`) using `os.execvp` with the canonical RECIPE-GRANIAN-RUN flag set.
- Async Alembic environment (`migrations/env.py`) — async engine + `pool.NullPool`, `ConfigurationError` guards for missing DSN and offline mode, no `fileConfig` (structlog owns logging), no `from __future__ import` (PEP 649).
- pytest suite (5 files, 18 tests) — `conftest.py` with the `stub_settings` factory and xdist-ready worker_id helper, app-boot smoke + health endpoint, Problem Details envelope shape, structlog renderers + redaction, subprocess-based Alembic env contracts.
- CI backend job flipped from `pytest -q --collect-only` to `pytest -q -n auto`.

### Security

- Phase 1 binds `0.0.0.0:8000` with NO authentication and exposes `/api/schema`, `/api/docs`, `/api/redoc` unauthenticated. Do NOT expose this image to a non-loopback network until Phase 5's setup gate ships. `COMRADARR_RUN_MODE=dev` binds `127.0.0.1:8000` as a local guardrail.
