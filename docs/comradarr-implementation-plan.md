# Comradarr — Comprehensive Implementation Plan

## 1. Title and Objective

**Title:** Comradarr v0.1.0 implementation plan.

**Objective:** Deliver a single-container, self-hosted rotation/orchestration layer over Sonarr, Radarr, and (optionally) Prowlarr that continuously cycles every library item through search, mirrors *arr state in PostgreSQL, ships with a setup wizard, three authentication providers, an audit log, a notification system, an SSE-driven SvelteKit frontend, and the supply chain / observability / deployment posture documented in `docs/comradarr-prd.md` (sections 1–30 + appendices A–C). All work strictly conforms to `.augment/rules/backend-dev-pro.md` (Litestar 2.x / Granian 2.x / msgspec 0.20 / SQLAlchemy 2.0 async / Python 3.14+ / structlog / uv / ruff / basedpyright recommended) and `.augment/rules/frontend-dev-pro.md` (SvelteKit 2 + Svelte 5 Runes, Bun 1.3.x, UnoCSS presetWind4, unocss-preset-shadcn, shadcn-svelte 1.1.x, openapi-typescript + openapi-fetch, Biome 2.4.x, svelte-adapter-bun).

---

## 2. Scope Summary

- [ ] Backend monorepo package `comradarr` under `backend/src/comradarr/` (PRD Appendix A) implemented as a Litestar 2.x ASGI app served by Granian, with SQLAlchemy 2.0 async + asyncpg over PostgreSQL 16+, Alembic migrations, and msgspec everywhere on the API boundary.
- [ ] Connector subsystem covering Sonarr, Radarr, and Prowlarr with SSRF defenses, hostile-response defenses, normalized error model, recorded-fixture test approach, and per-connector TLS toggles.
- [ ] Sync engine (full / deep / incremental) with three-tier scheduling, fingerprint diffing, and idempotent appliers writing to mirror tables.
- [ ] Rotation engine with tier-based priority, planner protocol per arr type, dispatcher, tracker, budget abstraction (default + Prowlarr), and priority search bypass.
- [ ] Three authentication providers (local Argon2id + trusted-header + OIDC with mandatory PKCE), unified session model, persistent rate limits, API keys with scopes, audit log with role-separated DB privileges, AES-256-GCM field encryption with key versioning, and master-key denylist.
- [ ] Setup wizard with bootstrap-token + setup-claim cookie + admin-session three-credential bootstrap, three wizard phases (claim, HTTP boundary verification, admin account), and CSRF-exempt bootstrap claim only.
- [ ] HTTP boundary hardening: trusted proxy chain, public origin, allowed origins, allowed hosts, CORS, double-submit CSRF, security headers, CSP, cookie attributes.
- [ ] In-process event bus + SSE endpoint feeding the dashboard.
- [ ] Notification system: apprise + webhook channels, template engine (`{{var}}` + `{{#if}}`), per-user routes, coalescing window, gettext integration.
- [ ] Frontend SvelteKit 2 + Svelte 5 Runes app shell with Northern Lights theme, sidebar layout, dashboard, content browser at scale (cursor pagination + virtual scrolling), connectors, settings, audit log, notifications, i18n via Weblate, WCAG 2.2 AA.
- [ ] Observability: structured logging (structlog), Prometheus `/metrics` (opt-in), OpenTelemetry traces (opt-in), `/health`, traceback hygiene, log redaction.
- [ ] RFC 7807 Problem Details error model end-to-end.
- [ ] Import/export: passphrase-encrypted snapshot via Argon2id + AES-256-GCM.
- [ ] Supply chain: `uv.lock` + `bun.lock` frozen installs, vulnerability scanning, code-level bans via ruff `S`, `prek` pre-commit using `prek.toml`, Biome + svelte-check + tsc.
- [ ] Single Docker image bundling Granian + pre-built SvelteKit assets + supervised PostgreSQL, with `DATABASE_URL` override path.
- [ ] AGPL-3.0 licensing, semver release tags (no `v` prefix on git tags), Weblate i18n integration.
- [ ] Comprehensive test suite: unit + property-based, integration with real Postgres, fixture-based connector tests with nightly canary, API tests with Litestar `AsyncTestClient`, frontend component + a11y tests.

Out of scope for v1 (explicitly captured for backlog): command palette (Cmd+K), Playwright E2E, mutation testing, partial import, optional pre-upgrade automatic backup, multi-role assignment UI, hash-chain audit tamper-evidence, custom icons.

---

## 3. Assumptions and Open Questions

- [ ] **Repo layout.** Assume the monorepo root contains `backend/` (PRD Appendix A) and `frontend/` (PRD §25 / frontend rules §7) as siblings, with `dev_cli/` (PRD §5) at the root. Confirm with maintainer before scaffolding.
- [ ] **OpenAPI spec source location.** Assume Litestar serves the spec at `/schema/openapi.json` (frontend rules `RULE-OAPI-001`); confirm Litestar 2.19 default vs. an override.
- [ ] **Frontend i18n library.** PRD §28 leaves the choice between `svelte-i18n` and `@inlang/paraglide-js-adapter-sveltekit` open. **Default proposal:** Paraglide (cleaner Svelte 5 Runes + per-message tree-shaking) — confirm before integration.
- [ ] **`uv` version pin.** Backend rules pin `>=0.11,<0.12`. Confirm the exact 0.11.x to install via `uv self update` in CI.
- [ ] **Bun lockfile format.** Backend mentions `bun.lock` (text) since 1.2; assume text lockfile and `bun install --frozen-lockfile` for CI.
- [ ] **shadcn-svelte CLI under UnoCSS workaround.** Frontend rules `RULE-SHADCN-002` requires an empty `tailwind.config.js` stub; confirm with maintainer that this stub will be committed and `.gitignore`d from formatters appropriately.
- [ ] **PostgreSQL major version inside the bundled image.** PRD §24 says "same as test PG"; assume PostgreSQL 16.x and pin in the Dockerfile.
- [ ] **Granian worker count.** PRD §24 specifies single worker; confirm whether the operator override is required for v1.
- [ ] **Telemetry library choices.** PRD §29 mentions Prometheus + OTLP. Assume `prometheus_client` for metrics and `opentelemetry-distro` + `opentelemetry-exporter-otlp` (OTLP-HTTP) for traces. Confirm.
- [ ] **Encryption key denylist source.** PRD §15 references a weak-value denylist; assume an embedded list of 100–500 known-bad keys plus refusing all-zeros / all-FF / repeating-byte patterns. Maintainer to confirm corpus.
- [ ] **Apprise version.** PRD §14 cites apprise as BSD-2-Clause; pin to current LTS (>=1.9 verified AGPL-compatible). Confirm.
- [ ] **OpenAPI annotations on Litestar.** Confirm `litestar.openapi.OpenAPIController` is exposed (per frontend rules §RULE-OAPI-001) and not gated behind setup completion (it is; the setup gate middleware allowlists `/schema`).
- [ ] **Renovate vs. Dependabot.** PRD §23 leaves the choice open. **Default proposal:** Renovate (richer grouping rules; better fit for `uv.lock` + `bun.lock` + workflow files). Confirm.
- [ ] **Trusted-header role claim.** PRD §26 sketches `X-Comradarr-Role` for trusted-header role assignment post-v1; in v1 ignore the header but reserve the schema column. Confirm.
- [ ] **Friendly install name.** PRD §30 references an install's "friendly name" in snapshot filenames; not specified elsewhere. Assume an `install_name` row in `app_config` editable in settings, defaulting to `comradarr`.
- [ ] **Dev CLI command surface.** PRD §5 specifies the dev CLI at a high level. Confirm the canonical command names (`dev_cli check`, `dev_cli regen-types`, `dev_cli db-up`, `dev_cli pg`, etc.).
- [ ] **Rotation backoff vs Prowlarr indexer status.** PRD §11 references Prowlarr health driving budget; confirm whether disabled indexers should remove their share from the budget immediately or after a debounce.

---

## 4. Workstreams and Phases

Phases are ordered so each one's outputs unblock the next. Workstreams (B = Backend, F = Frontend, S = Shared, I = Infrastructure, Q = QA/CI) run in parallel within a phase where possible.

- [ ] **Phase 0 — Foundations.** Repo scaffold, tooling, CI fast lane, `prek.toml`, lockfiles, license, license headers (S, I, Q).
- [ ] **Phase 1 — Backend skeleton.** Litestar app factory, lifespan, settings, structlog, exceptions module, Problem Details handler, health endpoint, Alembic async env (B).
- [ ] **Phase 2 — Database, roles, models.** Models for every table in Appendix B; Alembic baseline with migration / application / audit-admin GRANTs; UUIDv7 PK helper; encrypted-field Mapped types (B).
- [ ] **Phase 3 — Crypto, Secret type, audit log primitives.** `Secret[T]` wrapper, msgspec hook, structlog redaction, AES-256-GCM service with key versioning + AAD, master-key validation + denylist, audit log writer, retention vacuum (B, S).
- [ ] **Phase 4 — Auth providers, sessions, API keys, rate limits.** LocalPasswordProvider (Argon2id), TrustedHeaderProvider, OIDCProvider with PKCE + JWKS cache + replay window, session model, API keys + scopes, persistent rate limits, login flow (B).
- [ ] **Phase 5 — Setup gate + bootstrap + setup wizard backend.** Setup gate middleware allowlist, bootstrap token printer + consumer, setup-claim cookie, admin account creation, wizard endpoints for HTTP boundary verification (B, S).
- [ ] **Phase 6 — HTTP boundary hardening.** Trusted proxy resolver, public origin canonicalization, CORS, allowed-hosts middleware, double-submit CSRF, security headers, CSP, cookie attributes (B, S).
- [ ] **Phase 7 — Connector subsystem.** SSRF + hostile-response HTTP client wrapper, URL classifier with three policies, per-connector TLS toggles, connector factory, connector model + repository, error normalization, base shapes (B).
- [ ] **Phase 8 — Sonarr / Radarr / Prowlarr clients.** msgspec models, typed client methods, Prowlarr indexer health mapper, recorded-fixture replay infrastructure (B, Q).
- [ ] **Phase 9 — Sync engine.** Fingerprint computation, three-tier sync (full / deep / incremental), differ, applier, sync coordinator background task, mappers per arr type, schedule writer (B).
- [ ] **Phase 10 — Rotation engine.** Tier classifier, schedule reader, planner protocol + Sonarr/Radarr planners, budget protocol + default + Prowlarr resolvers, dispatcher, tracker, priority search consumer, rotation engine background loop (B).
- [ ] **Phase 11 — Event bus + SSE.** Typed in-process event bus, SSE controller with per-client backpressure, event filter for SSE-safe payloads (B, F).
- [ ] **Phase 12 — Notifications.** Notification channels (apprise + webhook) with test-before-commit, routes, templates with constrained engine, dispatcher with coalescing window, gettext catalog wiring, notification audit hooks (B, S).
- [ ] **Phase 13 — API layer.** Litestar Controllers for auth, connectors, content, search, sync, settings, OIDC providers, audit log, API keys, notifications, BFF view endpoints (dashboard, content, rotation, settings), cursor pagination util, search composition (B).
- [ ] **Phase 14 — Frontend foundations.** Bun + Vite + UnoCSS + presetWind4 + unocss-preset-shadcn, shadcn-svelte init, Northern Lights theme, app shell, sidebar, theme SSR, motion contract scaffold, OpenAPI client generation script, hooks.server.ts session validation, route groups (F, I).
- [ ] **Phase 15 — Frontend setup wizard.** Bootstrap claim screen, setup-claim cookie handling, HTTP boundary verification UI with proposed/observed/testing/committed states, admin account form (F).
- [ ] **Phase 16 — Frontend dashboard.** SSE store, tint-on-change, rotation heartbeat, dashboard load function, dashboard cards, BFF integration (F).
- [ ] **Phase 17 — Frontend content browser.** URL-driven filter/sort/search state, cursor pagination, TanStack Virtual, density rules, debounced search (F).
- [ ] **Phase 18 — Frontend connectors + settings + audit log + API keys + OIDC + notifications.** Test-driven configuration UI, paginated audit log, API key creation modal with one-time reveal, OIDC provider editor, notification channels & routes & templates UI (F).
- [ ] **Phase 19 — i18n + accessibility.** Backend gettext, frontend i18n adapter, locale selector, axe-core in component tests, focus management, reduced-motion guards, keyboard navigation (F, B, Q).
- [ ] **Phase 20 — Observability.** structlog production JSON, request logging policy, redaction processor, `/health` final, `/metrics` opt-in, OTLP opt-in, traceback hygiene (B).
- [ ] **Phase 21 — Import/export.** Snapshot export endpoint, snapshot import wizard backend, `.comradarr-snapshot` format, schema versioning, audit logging (B, F).
- [ ] **Phase 22 — Testing matrix.** Unit + property-based coverage, integration tests with real Postgres + role-permission tests, fixture-based connector tests + recording tool, API tests for every Problem Details code, frontend component tests with axe-core, nightly canary (Q).
- [ ] **Phase 23 — Supply chain hardening.** uv lock CI gate, pip-audit, Biome / svelte-check / tsc gates, prek.toml hooks, GitHub Actions tag pinning, Renovate config (Q, I).
- [ ] **Phase 24 — Deployment artifacts.** Docker image with bundled PostgreSQL, init script, dev CLI, Granian launch, secret-key handling, multi-arch build, SBOM, image-tag policy (I).
- [ ] **Phase 25 — Release prep.** Release notes, AGPL headers, docs site for API reference, contribution guidelines, license matrix, semver tagging policy in CI (S, I).

---

## 5. Detailed Implementation Tasks

### 5.0 Phase 0 — Foundations

#### 5.0.1 Repo scaffold

- [ ] Confirm monorepo layout: `backend/`, `frontend/`, `dev_cli/`, `docs/`, `.github/`, `prek.toml`, `LICENSE`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `Dockerfile`, `compose.example.yaml`.
- [ ] Initialize backend with `uv init comradarr --build-backend uv_build` inside `backend/` (PRD Appendix A header) producing `pyproject.toml`, `uv.lock`, `.python-version` (`3.14`), `src/comradarr/__init__.py`, and a `py.typed` marker. Pin `requires-python = ">=3.14"` (RULE-PY-001).
- [ ] Initialize frontend with `bun create svelte@latest frontend` then convert to the canonical layout in frontend rules §7 (`uno.config.ts`, `vite.config.ts`, `svelte.config.js` using `svelte-adapter-bun`, `components.json`, empty `tailwind.config.js`, `bunfig.toml`, `bun.lock`).
- [ ] Add LICENSE (AGPL-3.0) at the repo root and a license header note in CONTRIBUTING.md per PRD §23.
- [ ] Create `.gitignore` covering `__pycache__/`, `.venv/`, `node_modules/`, `dist/`, `build/`, `.svelte-kit/`, `*.comradarr-snapshot`, `coverage*`, `.DS_Store`, `.env*`.

#### 5.0.2 Backend tooling

- [ ] Add `[tool.ruff]` to `backend/pyproject.toml` with `target-version = "py314"`, `line-length = 100`, and `select = ["E","W","F","I","UP","B","C4","SIM","RET","TID","TCH","S"]` (PRD §23, ruff §S category in full).
- [ ] Add `[tool.basedpyright]` with `typeCheckingMode = "recommended"`, `enableTypeIgnoreComments = false`, `pythonVersion = "3.14"` (RULE-TOOL-003).
- [ ] Add `[tool.pytest.ini_options]` with `asyncio_mode = "auto"`, `asyncio_default_fixture_loop_scope = "session"` (RULE-TEST-001).
- [ ] Add Alembic config (`alembic.ini`) and run `uv run alembic init -t async migrations` to bootstrap the async env template (RULE-MIGR-001).
- [ ] Add `uv run` script entries for: `check`, `format`, `lint`, `typecheck`, `test`, `test-fast`, `migrate`, `serve` (RECIPE-GRANIAN-RUN).

#### 5.0.3 Frontend tooling

- [ ] Add `biome.json` keyed to schema 2.4 with `recommended` rules + nursery `useSortedClasses` warn; configure ignore for generated `schema.d.ts`.
- [ ] Configure `uno.config.ts` with `presetWind4`, `presetShadcn` (from `unocss-preset-shadcn`), `extractorSvelte`, dark-mode class strategy.
- [ ] Configure `svelte.config.js` to use `svelte-adapter-bun` (ANTI-ADAPTER-001 — drop adapter-auto/node).
- [ ] Configure `vite.config.ts` with `UnoCSS()` placed before `sveltekit()` (RULE-UNO-001).
- [ ] Add `tsconfig.json` strict mode, `moduleResolution: "bundler"`, `verbatimModuleSyntax: true`.
- [ ] Add empty `tailwind.config.js` stub for the shadcn-svelte CLI (RULE-SHADCN-002).
- [ ] Run `bunx shadcn-svelte@latest init` and commit the generated `components.json`.
- [ ] Install Northern Lights theme: `bunx shadcn@latest add https://tweakcn.com/r/themes/northern-lights.json` and commit the resulting `globals.css` plus token additions (PRD §25).
- [ ] Add scripts: `dev`, `build`, `preview`, `check` (svelte-check), `lint` (biome check), `format` (biome check --write), `gen-api` (openapi-typescript), `test` (vitest).

#### 5.0.4 Pre-commit and CI fast lane

- [ ] Author `prek.toml` matching PRD §23 verbatim (three `[[repos]]` blocks: builtin, backend, frontend).
- [ ] Add `.github/workflows/ci.yaml` invoking `prek run --all-files` plus `uv run pip-audit` for vulnerability scanning (PRD §23).
- [ ] Add `.github/workflows/integration.yaml` running integration tests with a PostgreSQL service container.
- [ ] Add `.github/workflows/canary.yaml` scheduled nightly to run fixture-canary tests against demo upstream instances.
- [ ] Pin every `uses:` to a concrete tag per PRD §23 (e.g., `actions/checkout@v6`); document the tag-pinning posture in CONTRIBUTING.md.
- [ ] Add Renovate (or Dependabot — confirm) config at `.github/renovate.json` with separate groups for security updates (auto-PR) vs. routine bumps (manual review).

#### 5.0.5 Foundational shared utilities

- [ ] Define cross-stack typed event names (e.g., `sync.completed`, `rotation.dispatched`) in `comradarr/core/events.py` so backend emit sites and frontend SSE subscribers stay aligned (PRD §13, §20).
- [ ] Establish `correlation_id` middleware skeleton (`comradarr/api/middleware/correlation.py`) bound to structlog contextvars (RULE-LOG-001 + PRD §21 instance field).

### 5.1 Phase 1 — Backend skeleton

#### 5.1.1 Settings (`comradarr/config.py`)

- [ ] Define `Settings(msgspec.Struct, frozen=True, kw_only=True)` capturing all environment variables in PRD §19: `comradarr_secret_key` (Secret bytes), `database_url` (default points at the bundled PG socket), `comradarr_insecure_cookies`, `comradarr_csp_report_only`, `comradarr_log_level`, `comradarr_log_format`, `comradarr_recovery_mode`, `comradarr_disable_local_login`, OIDC provider env names. (Backend §8.1, no pydantic-settings.)
- [ ] Implement `load_settings()` reading env, supporting `_FILE` suffix for every secret-bearing variable, and validating with `msgspec.convert`.
- [ ] Refuse to start when `COMRADARR_SECRET_KEY` is missing, unparseable, or in the denylist (PRD §15); surface as a `ConfigurationError` raised before lifespan runs.

#### 5.1.2 Logging (`comradarr/core/logging.py`)

- [ ] Configure structlog per RECIPE-STRUCTLOG: `merge_contextvars` first, JSON renderer in prod, console renderer in dev, `format_exc_info`, `dict_tracebacks`.
- [ ] Add a header-redaction processor and a secret-pattern redaction processor (PRD §20).
- [ ] Add a level-based filter and per-event ratelimit/dedup processor (PRD §20 log volume controls).
- [ ] Wire to Litestar via `StructlogPlugin(config=...)` (PATTERN-APP).

#### 5.1.3 Exceptions and Problem Details (`comradarr/errors/`)

- [ ] Implement `ComradarrError` base with `code`, `default_message`, `status_code`, `context`.
- [ ] Define every domain error class listed in PRD §21 (`authentication.invalid_credentials`, `authentication.session_expired`, `authentication.api_key_revoked`, `authorization.forbidden`, `authorization.permission_required`, `connector.unavailable`, `connector.api_error`, `connector.url_rejected`, `validation.failed`, `validation.field_invalid`, `internal.unexpected`, etc.).
- [ ] Implement Litestar `exception_handler` for `ComradarrError` and a fallback handler for unhandled exceptions (PRD §21 unhandled exceptions section).
- [ ] Render Problem Details fields: `type`, `title`, `status`, `detail`, `instance`, plus `errors[]` for validation, `context` for domain data, and a `retryable` boolean derived from connector classification (PRD §21).

#### 5.1.4 Application factory (`comradarr/app.py`)

- [ ] Implement `create_app(settings: Settings | None = None) -> Litestar` per RULE-PY-003 + PATTERN-APP, accepting a settings override for tests (PRD §18 + §22).
- [ ] Wire `lifespan=[db_lifespan, services_lifespan]` (PRD §18) producing single `AsyncIterator[None]` context managers.
- [ ] Register Plugins: `SQLAlchemyPlugin` (advanced-alchemy `before_send_handler="autocommit"`), `StructlogPlugin`.
- [ ] Register middleware order: correlation ID → logging → trusted proxy → setup gate → CORS → CSRF → security headers → auth → permission check (PRD §16, §15).
- [ ] Register exception handlers from `comradarr/errors/`.
- [ ] Register OpenAPI controller with title `Comradarr API`, version pulled from `pyproject.toml`, and serve at `/schema`.
- [ ] Register controllers (deferred to Phase 13; placeholder import).

#### 5.1.5 Lifespan (`comradarr/core/lifespan.py`)

- [ ] Implement `db_lifespan(app)` creating `create_async_engine` + `async_sessionmaker(expire_on_commit=False)` (RULE-DB-001), running pending migrations conditionally, exposing on `app.state` (PRD §18).
- [ ] Implement `services_lifespan(app)` instantiating: event bus, crypto service, client factory, planners, dispatcher, tracker, sync coordinator, rotation engine, prowlarr health monitor, retention vacuum, notification dispatcher; storing on `app.state`; launching background tasks via `asyncio.TaskGroup`.
- [ ] On shutdown, cancel tasks, await `TaskGroup` exit, close httpx clients, dispose engine (PRD §18).

#### 5.1.6 Health endpoint (`comradarr/api/controllers/health.py`)

- [ ] Implement `@get("/health")` returning a small JSON object (PRD §20 Health Endpoint, §29 final paragraph) with status + components, excluded from auth via the setup gate's allowlist.

#### 5.1.7 Granian launch (`comradarr/__main__.py` + scripts)

- [ ] Add `granian --interface asgi --host 0.0.0.0 --port 8000 --workers 1 --loop uvloop --runtime-mode st --runtime-blocking-threads 1 app.main:app` invocation (RULE-SRV-001 + PRD §24).
- [ ] Configure 6-hour `--workers-lifetime` and `--respawn-failed-workers` (PRD §24).

### 5.2 Phase 2 — Database, roles, and models

#### 5.2.1 Base and conventions

- [ ] Implement `comradarr/models/base.py` with `class Base(AsyncAttrs, DeclarativeBase)` and `type_annotation_map = {datetime: DateTime(timezone=True)}` (RULE-DB-005).
- [ ] Add UUIDv7 primary-key helper using `uuid.uuid7()` (RULE-DB-005, DECIDE-ID).
- [ ] Add encrypted-field type `EncryptedField` exposing four columns: `*_nonce`, `*_ciphertext`, `*_tag`, `*_version` per PRD §15.

#### 5.2.2 Models per Appendix B

- [ ] `users` (PRD App. B Auth Tables) — UUIDv7 PK, email, username, role, password_hash with sentinel for non-local accounts, provisioning_provider enum, timestamps.
- [ ] `sessions` — token_hash (sha256), user_id FK, auth_provider enum, oidc_provider_name, created_at, expires_at, last_seen_at, ip, user_agent; index on token_hash.
- [ ] `api_keys` — random-portion sha256 hash, prefix, last_four, user_id, name, expires_at, created_at, last_used_at; index on hash.
- [ ] `auth_rate_limits` — composite PK `(scope, key)`, counter, window_start, backoff_delay, last_failure_at; persistent.
- [ ] `oidc_providers` — short_name unique, issuer_url, client_id, encrypted client_secret (4 cols, AAD = provider name), display_name, scope_list (JSONB), discovery cache fields.
- [ ] `connectors` — UUID PK, name, type enum (`sonarr`/`radarr`/`prowlarr`), url, encrypted api_key (AAD = connector UUID), per-connector limits, `insecure_skip_tls_verify`, `tls_ca_bundle_path`.
- [ ] `mirror_series`, `mirror_episodes`, `mirror_movies` — keyed `(connector_id, arr_id)`; episodes index `(connector_id, series_arr_id, season_number)`.
- [ ] `search_schedule` — PK `(connector_id, content_type, content_arr_id)`, denormalized series_arr_id + season_number, tier, last_searched_at, search_count, paused; partial index `(connector_id, tier, last_searched_at NULLS FIRST) WHERE NOT paused`.
- [ ] `planned_commands` — UUID PK, connector_id, command_type, command_payload JSONB, status enum, arr_command_id, dispatched_at, resolved_at; partial index `(connector_id, status, created_at) WHERE status = 'pending'`.
- [ ] `priority_searches` — unique `(connector_id, content_type, content_arr_id)`.
- [ ] `sync_state` — one row per connector; last full / deep / incremental timestamps, fingerprint JSONB, status, last_error, items_synced, duration_ms.
- [ ] `app_config` — string key/value with updated_at; companion encrypted-secrets table with the same 4-col layout for setup-claim proof and other inline encrypted values.
- [ ] `role_permissions` — `(role_name, permission_name)` PK; granted_at.
- [ ] `api_key_scopes` — `(api_key_id, permission_name)` PK.
- [ ] `user_preferences` — `(user_id, key)` PK with `value`; locale, theme (`light`/`dark`/`system`), timezone.
- [ ] `notification_channels` — UUID PK, user_id FK, name, kind enum, enabled, encrypted config (AAD = channel UUID), per-channel TLS toggles, last_tested_at, last_test_status enum; indexes on `(user_id)` and `(enabled, kind)`.
- [ ] `notification_routes` — `(user_id, event_type, channel_id)` PK with enabled, predicate JSONB nullable; FK with `ON DELETE CASCADE`; composite index on `(user_id, event_type)`.
- [ ] `notification_templates` — `(user_id, event_type, channel_kind)` unique; subject_template, body_template.
- [ ] `audit_log` — UUID PK, timestamp, action enum, actor (user_id or ip), context JSONB, ip, user_agent, `previous_hash` + `content_hash` nullable; indexes `(timestamp DESC)` and `(action, timestamp DESC)`.

#### 5.2.3 Alembic baseline migration

- [ ] Generate the v1 baseline migration covering every table and index.
- [ ] In the baseline migration, add `op.execute("CREATE ROLE comradarr_migration ...")`, `... comradarr_app ...`, `... comradarr_audit_admin ...` and `GRANT` statements per PRD §8 (migration role: DDL; app role: DML on all tables except UPDATE/DELETE on audit_log; audit-admin role: DELETE on audit_log only).
- [ ] Document the role-creation fallback for managed external Postgres (operator runs the role-creation SQL once; init script detects existing roles).

#### 5.2.4 Repositories (`comradarr/repositories/`)

- [ ] `base.py` — generic async session-scoped base.
- [ ] `connector.py` — list/add/edit/pause connectors with encrypted api_key plumbing.
- [ ] `content.py` — cursor-paginated read APIs over mirror tables.
- [ ] `auth.py` — users, sessions, api_keys, rate_limits, oidc_providers.
- [ ] Use `selectinload` everywhere a relationship is read in the request path (RULE-DB-004).
- [ ] Add cursor-pagination helper using `(sort_value, id)` keyset (PRD §17 / §25 content browser).

### 5.3 Phase 3 — Crypto, Secret type, audit log primitives

#### 5.3.1 `Secret[T]` (PRD §15)

- [ ] Implement generic `Secret[T]` in `comradarr/core/types.py` overriding `__repr__`, `__str__`, `__eq__`, hashing, msgspec encode hook (return redaction marker), and `expose() -> T`.
- [ ] Add a structlog processor recognizing `Secret[T]` as a redaction marker.
- [ ] Add a basedpyright check that `Secret[bytes]` cannot be passed where `bytes` is expected without `expose()` (rely on type system; add example unit test that fails to typecheck).

#### 5.3.2 Crypto service (`comradarr/core/crypto.py`)

- [ ] AES-256-GCM encrypt/decrypt with version registry; in v1 register a single key derived from `COMRADARR_SECRET_KEY`.
- [ ] AAD wiring per call site (connector UUID, OIDC provider name, channel UUID, setup-claim constant).
- [ ] Key denylist enforcement at startup; raise `ConfigurationError` (PRD §15).
- [ ] Argon2id helper using `argon2-cffi` with PRD-defined parameters for password hashing and a separate, stronger parameter set for snapshot key derivation (PRD §15, §30).

#### 5.3.3 Audit log writer (`comradarr/services/audit/`)

- [ ] Implement `record(action, actor, context, ip, user_agent)` running through Secret-aware redaction before insert.
- [ ] Wrap with the application role's connection (insert + select only); ensure the writer never attempts UPDATE/DELETE.
- [ ] Implement retention vacuum background task using audit-admin role; default indefinite, configurable cap (PRD §15, App. B audit_log).
- [ ] Define the action enum exhaustively (PRD §15 / App. B): bootstrap_token_generated, setup_claim_granted, setup_claim_rejected, admin_account_created, setup_completed, login_success/_failed (per provider), logout, password_changed, session_revoked, api_key_created/_revoked/_first_used, connector_added/_edited/_deleted, http_boundary_changed, oidc_provider_added/_edited/_deleted, manual_search_triggered, manual_sync_triggered, snapshot_exported, snapshot_imported, etc.

### 5.4 Phase 4 — Auth providers, sessions, API keys, rate limits

#### 5.4.1 Provider abstraction

- [ ] Define `AuthProvider` Protocol in `comradarr/core/auth/`: `async def authenticate(request) -> AuthOutcome`.
- [ ] Implement provider registry resolved in fixed order (PRD §15).

#### 5.4.2 Local password provider

- [ ] `LocalPasswordProvider` using Argon2id; rehash on login when parameters drift (App. B users); disabled when `COMRADARR_DISABLE_LOCAL_LOGIN=1`; users with sentinel password hash structurally rejected.
- [ ] Per-IP and per-username rate limit checks (PRD §15) reading/writing `auth_rate_limits` with an in-memory hot cache.

#### 5.4.3 Trusted-header provider

- [ ] Verify TCP socket peer is in `trusted_header_auth_proxy_ips` (never trust XFF for that check) (PRD §15).
- [ ] Resolve user via configured username/email header; provision per `trusted_header_auth_provision_policy`.
- [ ] Logout redirects to the configured `trusted_header_auth_logout_url`.

#### 5.4.4 OIDC provider

- [ ] Implement authorization code flow with mandatory PKCE per provider (PRD §15 + Glossary).
- [ ] JWKS cache: in-memory only, refresh on startup and validation failure.
- [ ] Validate issuer, audience, expiry, `nonce`, `iat` window; reject `alg=none`.
- [ ] Discovery doc cache in `oidc_providers` row.
- [ ] Map OIDC subject + issuer to the local `users` row; create on first login per provisioning policy.
- [ ] Logout calls provider end_session_endpoint when present.

#### 5.4.5 Sessions

- [ ] Issue session: random 256-bit token, hash on insert (sha256), set HttpOnly + Secure (gated by `COMRADARR_INSECURE_COOKIES` for dev) + SameSite=Lax cookie (PRD §16).
- [ ] Validate session: constant-time hash lookup, idle + absolute timeout enforcement, last_seen_at update (best-effort).
- [ ] Revocation: delete the row.

#### 5.4.6 API keys

- [ ] Generate `cmrr_live_<random>`; return plaintext exactly once at creation (PRD §15 / §26).
- [ ] Persist hash, prefix, last_four; record optional scope rows in `api_key_scopes`.
- [ ] Authentication via `X-Api-Key` header or `Authorization: Bearer cmrr_live_...`.
- [ ] Permission resolution joins `api_key_scopes ∩ role_permissions(owner.role)` (PRD §26).
- [ ] First-use audit log entry per PRD action enum.

#### 5.4.7 Rate limit machinery

- [ ] Persistent counters keyed on `(scope, key)` survive restarts.
- [ ] Login per-username: progressive backoff; per-IP: window cap.
- [ ] Bootstrap-IP scope used during setup wizard claim (PRD §15 / §16 / §15 setup details).

### 5.5 Phase 5 — Setup gate + bootstrap + setup wizard backend

#### 5.5.1 Setup gate middleware

- [ ] Read `setup_completed` from `app_config` once per request (cache invalidated on change).
- [ ] Allowlist while incomplete: `/`, `/setup/*`, `/health`, `/static/*`, `/schema/*`, `/_app/*` (frontend assets), the bootstrap claim endpoint (the only CSRF-exempt POST), and frontend setup wizard pages.
- [ ] Redirect every other route to `/setup` with 302 (or 401 for API).

#### 5.5.2 Bootstrap token flow

- [ ] At startup, when `setup_completed` is false: generate a random token, log a prominent banner to stdout, write it to a deterministic on-disk path inside the container (PRD §15 — the operator can fish it out of either logs or the file), expire the in-memory copy after a fixed TTL.
- [ ] Audit log: `bootstrap_token_generated` (no token value).

#### 5.5.3 Setup-claim endpoint

- [ ] `POST /setup/claim` accepts the bootstrap token; CSRF-exempt; per-IP rate limited.
- [ ] On success: clear the token from memory + disk; set strict-same-site path-scoped HttpOnly setup-claim cookie; record `setup_claim_granted`.
- [ ] On rejection: increment per-IP counter; record `setup_claim_rejected`.

#### 5.5.4 HTTP boundary verification endpoints

- [ ] Wizard step 1 (proxy trust): server captures observed peer IP + observed `X-Forwarded-For`; proposes a value; live-test endpoint that the operator's browser hits to confirm the chain resolves correctly.
- [ ] Wizard step 2 (public origin): server proposes from observed `Host` + scheme; live-test endpoint that issues a redirect to the proposed origin and verifies the round trip.
- [ ] Wizard step 3 (allowed origins): proposes `[public_origin]`; live-test that a fetch from each origin succeeds with credentials and CORS pre-flight passes.
- [ ] Wizard step 4 (allowed hosts): proposes the hostnames seen in step 1's chain; live-test rejects non-allowed Host headers with 421.
- [ ] Each step persists only on a successful live test; failure returns Problem Details with `context.proposed` and `context.error_kind`.
- [ ] Audit log: `http_boundary_changed` per step.

#### 5.5.5 Admin account creation endpoint

- [ ] `POST /setup/admin` accepts username + email + password; enforces the password length minimum + denylist (PRD §15).
- [ ] On success: provision the admin user with `provisioning_provider="local"`, role=`admin`, issue a session immediately so the wizard can proceed without a separate login.
- [ ] Mark `setup_completed=true` in `app_config`; emit `admin_account_created` and `setup_completed` audit entries.

### 5.6 Phase 6 — HTTP boundary hardening

#### 5.6.1 Trusted proxy resolver

- [ ] Resolve client IP by walking `Forwarded`/`X-Forwarded-For` only when the socket peer is in `trusted_proxy_ips`; fall back to the socket peer otherwise (PRD §16).
- [ ] Bind the resolved IP to structlog contextvars for every request.

#### 5.6.2 Public origin canonicalization

- [ ] Reject requests whose `Host` header is not in `allowed_hosts` with 421.
- [ ] Build outgoing redirect URLs from `public_origin`, never from request headers.

#### 5.6.3 CORS

- [ ] Configure Litestar CORS with `allowed_origins`, `allow_credentials=True`, `allow_methods` matching the API surface, `allowed_headers` minimal, `max_age=86400`.

#### 5.6.4 CSRF

- [ ] Implement double-submit token (PRD §16): cookie `comradarr_csrf` (HttpOnly=false, SameSite=Strict) and `X-CSRF-Token` header on every state-changing request.
- [ ] Verify Origin header matches `allowed_origins` on every state-changing request; the only exception is `/setup/claim` (PRD §16 + Glossary).
- [ ] Issue token on first GET; rotate per session.

#### 5.6.5 Security response headers

- [ ] Apply: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy` minimal, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` (PRD §16).

#### 5.6.6 CSP

- [ ] Build CSP from `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none';` plus the SSE endpoint origin.
- [ ] Switch to report-only when `COMRADARR_CSP_REPORT_ONLY=1`; emit a startup warning (PRD §16, §19).

#### 5.6.7 Cookie attribute matrix

- [ ] Document and apply the per-cookie attributes (PRD §16): session cookie HttpOnly + Secure + SameSite=Lax, csrf cookie HttpOnly=false + SameSite=Strict, theme-pref cookie HttpOnly=false + SameSite=Lax, setup-claim cookie HttpOnly + Secure + SameSite=Strict + path scoped.

### 5.7 Phase 7 — Connector subsystem (HTTP client, factory, errors)

#### 5.7.1 SSRF-defended HTTP client (`comradarr/connectors/http.py`)

- [ ] Build an `httpx.AsyncClient` factory that:
  - [ ] re-resolves DNS on every request and re-classifies the resolved IP (defense against DNS rebinding) (PRD §7 + Glossary);
  - [ ] enforces the URL classification policy (default / strict / permissive) configured by `COMRADARR_CONNECTOR_URL_POLICY`;
  - [ ] applies an explicit `httpx.Timeout` and `httpx.Limits` (RULE-HTTP-002);
  - [ ] respects per-connector TLS toggles (`insecure_skip_tls_verify`, `tls_ca_bundle_path`);
  - [ ] caps response size and aborts on hostile-response patterns (PRD §7 — gzip bombs, recursive nesting, oversized JSON);
  - [ ] runs JSON parsing through msgspec with hard limits.
- [ ] Implement error normalization: every httpx exception is wrapped in a `ComradarrError` subclass with request/response stripped from the message (PRD §20 traceback hygiene) and a transient/permanent classification (PRD §21).
- [ ] One app-scoped client per connector type; created in lifespan (RULE-HTTP-003 + DECIDE-HTTP-CLIENT).

#### 5.7.2 URL classifier (`comradarr/connectors/url_policy.py`)

- [ ] Implement `default`, `strict`, `permissive` per PRD §16 / Glossary.
- [ ] Block link-local, multicast, broadcast, IPv4-mapped exotic ranges, cloud metadata (`169.254.169.254`).
- [ ] Reject schemes other than http/https.
- [ ] Reject userinfo in URL.

#### 5.7.3 Connector factory (`comradarr/connectors/factory.py`)

- [ ] Resolve connector → typed client (Sonarr / Radarr / Prowlarr) based on the discriminator.
- [ ] Decrypt API key via crypto service using connector UUID as AAD.
- [ ] Run health probe at construction time.

### 5.8 Phase 8 — Sonarr / Radarr / Prowlarr clients

#### 5.8.1 Shared models (`comradarr/connectors/shared/`)

- [ ] Define msgspec Structs for shared command and queue shapes.

#### 5.8.2 Sonarr client (`comradarr/connectors/sonarr/`)

- [ ] msgspec models: Series, Season, Episode, Tag, QualityProfile, Command, SystemStatus.
- [ ] Methods: `list_series`, `get_series`, `list_episodes`, `command_episode_search`, `command_season_search`, `command_series_search`, `command_status`, `system_status`.
- [ ] Strict response validation (RULE-SER-001) — reject unexpected shape with `ConnectorApiError`.

#### 5.8.3 Radarr client (`comradarr/connectors/radarr/`)

- [ ] msgspec models: Movie, QualityProfile, Command, SystemStatus.
- [ ] Methods: `list_movies`, `get_movie`, `command_movies_search`, `command_status`, `system_status`.

#### 5.8.4 Prowlarr client (`comradarr/connectors/prowlarr/`)

- [ ] msgspec models: Indexer, Tag, IndexerStatus.
- [ ] Methods: `list_indexers`, `get_indexer`, `system_status`.
- [ ] `mapper.py` mapping Prowlarr indexer → Sonarr/Radarr "indexer in this connector?" via tag matching.
- [ ] `health.py` background task polling Prowlarr indexer status; emits events to the bus when status changes.

#### 5.8.5 Recorded-fixture infrastructure

- [ ] Implement `tests/fixtures/recorder.py` capturing real request/response pairs from a configured upstream; redact the API key to a placeholder; commit fixture files under `tests/fixtures/<connector>/<scenario>/`.
- [ ] Implement `tests/fixtures/replay.py` matching method/path/headers and substituting the placeholder API key.
- [ ] Document the recording workflow in `CONTRIBUTING.md`.

### 5.9 Phase 9 — Sync engine

#### 5.9.1 Fingerprints (`comradarr/services/sync/fingerprint.py`)

- [ ] Compute a fingerprint over (series count, episode count, last-edit timestamps, monitored counts) per connector.
- [ ] Persist the previous fingerprint in `sync_state.fingerprint_json`.

#### 5.9.2 Differ (`comradarr/services/sync/differ.py`)

- [ ] Compare current vs. stored fingerprint and emit a structured changeset (added / removed / modified) per content type.
- [ ] Property-test invariants per PRD §22.

#### 5.9.3 Applier (`comradarr/services/sync/applier.py`)

- [ ] Idempotent upserts to `mirror_series`, `mirror_episodes`, `mirror_movies` plus `search_schedule` row creation/deletion and tier reassignment.

#### 5.9.4 Engine + coordinator

- [ ] `engine.py`: orchestrates one sync run per connector with full / deep / incremental modes (PRD §6).
- [ ] `coordinator.py`: background task tick that decides which connector needs which mode given timestamps in `sync_state` and configured intervals (PRD §6).
- [ ] Per-tick summarization log event (PRD §20).
- [ ] Emits `sync.started`, `sync.progress`, `sync.completed`, `sync.failed` events on the event bus.

#### 5.9.5 Mappers (`comradarr/services/sync/mappers/`)

- [ ] `sonarr.py`: connector model → mirror tables.
- [ ] `radarr.py`: connector model → mirror tables.

### 5.10 Phase 10 — Rotation engine

#### 5.10.1 Tier classifier

- [ ] Implement tier assignment per PRD §10: tier 0 MISSING, tier 1 RECENT, tier 2 MONITORED, tier 3 COMPLETED.
- [ ] Tier reassignment runs at sync apply time.

#### 5.10.2 Planner protocol + implementations (`comradarr/services/rotation/planners/`)

- [ ] Protocol `Planner.plan(eligible_items, budget) -> list[Command]` (PRD §11).
- [ ] Sonarr planner groups episodes → seasons → series; respects per-command limits; minimizes commands (planner invariants per PRD §22 property tests).
- [ ] Radarr planner groups movies into batched MoviesSearch commands.
- [ ] Property tests: output covers all eligible items; no command crosses connectors; total commands ≤ items.

#### 5.10.3 Budget protocol + implementations (`comradarr/services/budget/`)

- [ ] `protocol.py`: `Budget.available_for(connector_id) -> int`.
- [ ] `default.py`: per-connector daily limit + concurrent limit fallback.
- [ ] `prowlarr.py`: derives budget from Prowlarr indexer limits read via the mapper; reduces budget when indicators flip to disabled.
- [ ] `resolver.py`: chooses the right Budget at startup based on whether a Prowlarr connector is configured; can re-resolve when connectors change.

#### 5.10.4 Dispatcher (`comradarr/services/rotation/dispatcher.py`)

- [ ] Pull eligible rows from `search_schedule` ordered by `(tier ASC, last_searched_at NULLS FIRST)` (PRD §10).
- [ ] Consume `priority_searches` first (PRD §11 priority bypass).
- [ ] Hand off to the appropriate planner; insert resulting `planned_commands` rows; call connector client.

#### 5.10.5 Tracker (`comradarr/services/rotation/tracker.py`)

- [ ] Poll arr command status until terminal; update `planned_commands.status`; on success, advance `search_schedule.last_searched_at` for every covered item; on failure or timeout, log + emit event but do not advance (PRD §11).

#### 5.10.6 Engine loop

- [ ] Background task with bounded sleep tick; no-op when setup is incomplete; emits `rotation.dispatched`, `rotation.tracked`, `rotation.idle`.
- [ ] Per-tick summarization log event (PRD §20).

#### 5.10.7 Manual operations

- [ ] Endpoint to enqueue priority searches for a single item or filter.
- [ ] Endpoint to pause/unpause individual `search_schedule` rows.

### 5.11 Phase 11 — Event bus + SSE

#### 5.11.1 Event bus (`comradarr/core/events.py`)

- [ ] In-process pub/sub keyed on a typed enum of event names; subscribers are async iterators (PRD §13).
- [ ] No event Struct contains a `Secret[T]` field (enforce at code review; add a unit test that scans event Struct annotations).

#### 5.11.2 SSE controller (`comradarr/api/controllers/events.py`)

- [ ] `GET /api/events/stream` returning `text/event-stream`; per-client backpressure with bounded queue (PRD §13).
- [ ] Filters events by user permission (e.g., audit-log events to admins only).
- [ ] Emit a heartbeat every 15s to keep proxies alive.

### 5.12 Phase 12 — Notifications

#### 5.12.1 Channels (`comradarr/services/notifications/channels/`)

- [ ] Apprise channel: lazy import `apprise`, encrypted config (URL).
- [ ] Webhook channel: encrypted bundle (URL, method, headers, body template).
- [ ] Per-channel TLS toggles wired through.
- [ ] Test-before-commit: `POST /api/notifications/channels/test` runs a one-shot send; only persists when successful (PRD §14).

#### 5.12.2 Routes

- [ ] `(user, event_type, channel)` rows; absence is the off-switch.
- [ ] Predicate column null in v1.

#### 5.12.3 Templates

- [ ] Constrained engine: `{{var}}` substitution + `{{#if var}}…{{/if}}` (PRD §14 + Glossary).
- [ ] Lookup order at send: user override → translated built-in for recipient locale → English (PRD §14).
- [ ] Built-in defaults registered as gettext message keys under `notification.{event_type}.{channel_kind}.{subject|body}` (PRD §28).

#### 5.12.4 Dispatcher

- [ ] Subscribes to the event bus; resolves routes per event; renders templates; sends.
- [ ] Coalescing window: 60-second rolling group for operational-health events of the same category (PRD §14 + Glossary).
- [ ] Security and user-initiated events bypass coalescing.
- [ ] Audit-log delivery success/failure under `notification.delivery.sent` and `.failed` (PRD §20).

### 5.13 Phase 13 — API layer

#### 5.13.1 Controller layout (`comradarr/api/controllers/`)

- [ ] Implement Controllers per PRD App. A: `auth`, `connectors`, `events`, `health`, `sync`, `search`, plus `views/` BFF controllers (`dashboard`, `content`, `rotation`, `settings`).
- [ ] Permission-check middleware reads `role_permissions` + `api_key_scopes` and returns 403 for missing permissions (PRD §26).

#### 5.13.2 Schemas (`comradarr/api/schemas/`)

- [ ] `auth.py`, `connectors.py`, `content.py`, `views.py`, `common.py` — every request and response is a `msgspec.Struct` (RULE-SER-001).
- [ ] DTOs only when shape projection differs from the Struct (DECIDE-DTO).

#### 5.13.3 Cursor pagination

- [ ] Implement `(sort_key, id)` keyset cursor encoder/decoder using `base64url(json)` with HMAC.
- [ ] Stable sort keys per resource (date, name, tier, last_searched_at).

#### 5.13.4 Endpoint surface

- [ ] **Auth:** login, logout, session validate, password change, OIDC start, OIDC callback, trusted-header probe, recovery flow (gated by `COMRADARR_RECOVERY_MODE`).
- [ ] **API keys:** create (returns plaintext once), list, revoke (own + admin all).
- [ ] **Connectors:** list, add (with live test), edit, delete, pause, manual sync trigger.
- [ ] **Content:** search/filter/sort with cursor pagination at scale (500k+ items); detail view; trigger manual search; pause/unpause item.
- [ ] **Sync:** status per connector, manual full/deep/incremental.
- [ ] **Search:** dispatcher status, in-flight commands, history.
- [ ] **Settings (HTTP boundary):** get/set + live test (mirrors wizard step UX in post-setup).
- [ ] **OIDC providers:** CRUD with secret rotation.
- [ ] **Audit log:** paginated list, filters by action, time range, actor; JSON-lines export.
- [ ] **Notifications:** channels CRUD + test, routes CRUD, templates CRUD.
- [ ] **Snapshots:** export, import (Phase 21).
- [ ] **Users:** v1 self-service only; admin-level management deferred but endpoints stub permission checks.

#### 5.13.5 BFF endpoints

- [ ] `GET /api/views/dashboard` — single composed payload with summary stats + activity feed + per-connector status.
- [ ] `GET /api/views/content` — paginated rows with the exact columns the content browser needs.
- [ ] `GET /api/views/rotation` — current schedule snapshot + next-up items.
- [ ] `GET /api/views/settings/http-boundary` — current values + observed values for inline test cards.

### 5.14 Phase 14 — Frontend foundations

#### 5.14.1 SvelteKit setup

- [ ] Confirm folder layout per frontend rules §7: `src/lib/`, `src/lib/server/`, `src/lib/state/`, `src/lib/api/`, `src/lib/components/ui/`, route groups `(app)/`, `(auth)/`, `(setup)/`, `(public)/`.
- [ ] Configure `app.html` with the inline 4-line theme-resolution script (PRD §25 SSR theme handling).
- [ ] Configure `hooks.server.ts` to: read session cookie, call backend session-validate, populate `event.locals.user` / `event.locals.session`, redirect non-public routes to login when missing (RULE-SEC-003).
- [ ] Configure `app.d.ts` `App.Locals`, `App.PageData`, `App.Error`.
- [ ] Configure `src/lib/utils.ts` `cn()` helper for shadcn class composition (frontend rules §10).

#### 5.14.2 Theme + UnoCSS

- [ ] Confirm `presetWind4` + `unocss-preset-shadcn` + `extractorSvelte` registered (RULE-UNO-001).
- [ ] Move tweakcn Northern Lights tokens into `src/app.css` `:root` and `[data-theme="dark"]`.
- [ ] Add `--spacing-local` override mechanism per surface (PRD §25 density scales).
- [ ] Implement `useReducedMotion` composable (PRD §25 motion contract).

#### 5.14.3 OpenAPI client (`src/lib/api/`)

- [ ] `scripts/gen-api.ts` runs `openapi-typescript http://localhost:8000/schema/openapi.json -o src/lib/api/schema.d.ts`.
- [ ] `client.ts` exports `createBrowserClient()` returning `createClient<paths>({ baseUrl: '' })`.
- [ ] `server.ts` exports `createServerClient(event)` returning `createClient<paths>({ baseUrl: '', fetch: event.fetch })` (RULE-OAPI-003).
- [ ] Add the `gen-api` script to dev-CLI and to a CI step that fails when the regenerated file diffs from the committed one.

#### 5.14.4 App shell

- [ ] Implement sidebar navigation in `src/routes/(app)/+layout.svelte` using shadcn Sidebar primitive; collapses below `md`, hamburger below `sm` (PRD §25 app shell).
- [ ] Sidebar consumes only `sidebar-*` tokens.
- [ ] Implement persistent rotation heartbeat indicator near the wordmark — bound to a `RotationStatusStore` derived from SSE.
- [ ] Implement focus-ring style using `ring` token (a11y baseline).

#### 5.14.5 Motion contract scaffolding

- [ ] Implement `tint-on-change` directive: wrap a card in `<TintOnChange watch={value}>`; CSS keyframe + atomic value swap (PRD §25).
- [ ] Implement page-load cascade utility for above-the-fold reveals; only on hard loads / route-group crossings.
- [ ] Universal `prefers-reduced-motion: reduce` collapse to atomic state swaps (PRD §25 + §28).

#### 5.14.6 Theme SSR

- [ ] Implement `comradarr_theme_pref` cookie read in `hooks.server.ts`.
- [ ] Resolve `data-theme` attribute server-side for authenticated users; for `system` users + unauthenticated visitors use the cookie (PRD §25).
- [ ] Add a form-action endpoint to update theme preference (writes DB row + cookie).

#### 5.14.7 Auth route group

- [ ] `(auth)/login/+page.svelte` + `+page.server.ts` form action; OIDC provider buttons; trusted-header banner.
- [ ] `(auth)/+layout.svelte` minimal centered card layout.

### 5.15 Phase 15 — Frontend setup wizard

- [ ] `(setup)/+layout.svelte` minimal layout that links to `/setup` and never shows the app shell.
- [ ] `(setup)/+page.svelte` claim screen prompting for the bootstrap token; submits to `/api/setup/claim` with the CSRF-exempt fetch path; shows next step after success.
- [ ] `(setup)/boundary/+page.svelte` four-step HTTP boundary verification UI implementing the test-driven configuration affordance: observed → proposed → testing → committed/rejected (PRD §25 + Glossary).
- [ ] `(setup)/admin/+page.svelte` admin account creation form with password strength indicator and denylist enforcement message; submits to `/api/setup/admin`.
- [ ] On success, navigate to `(app)/` and replace the setup-claim cookie (already cleared server-side).

### 5.16 Phase 16 — Frontend dashboard

- [ ] `(app)/+page.svelte` dashboard with: rotation heartbeat status card, sync progress per connector, search throughput, budget consumption, recent activity feed; each card consumes a typed slice of the BFF payload.
- [ ] `+page.server.ts` calls `GET /api/views/dashboard`.
- [ ] `src/lib/state/sse.svelte.ts` class-based store wrapping `EventSource('/api/events/stream')`; reconnect with backoff; exposes `events` reactive list and per-event `subscribe` callbacks.
- [ ] On every applicable SSE event, call `invalidate('app:dashboard')` so SvelteKit re-runs the load.
- [ ] Tint-on-change wraps every counter; numerals render `font-mono`.
- [ ] Hero area carries the subtle aurora gradient wash (PRD §25).

### 5.17 Phase 17 — Frontend content browser

- [ ] `(app)/content/+page.svelte` with virtual scrolling via TanStack Virtual; `$state.raw()` for the row list (PRD §25 content browser at scale).
- [ ] `+page.server.ts` reads `?cursor=&q=&filter=&sort=&size=` from URL, calls `GET /api/views/content`.
- [ ] Search input debounced 300ms before pushing to URL params.
- [ ] Density-tight surface override of `--spacing-local`.
- [ ] No aurora wash in the data grid.
- [ ] Mobile breakpoint collapses to one-line rows.

### 5.18 Phase 18 — Frontend connectors / settings / audit log / API keys / OIDC / notifications

#### 5.18.1 Connectors

- [ ] List page with status badges (healthy / degraded / unreachable) sourced from SSE health events.
- [ ] Add/edit form with TLS toggles and live test button (test runs through the test-driven configuration affordance).
- [ ] Per-connector detail with sync status, last error, recent commands.

#### 5.18.2 Settings

- [ ] HTTP boundary editor with the same affordance used in the wizard (observed/proposed/testing/committed) — shared component lives at `src/lib/components/TestDrivenField.svelte`.
- [ ] OIDC providers list/edit; secret rotation flows.
- [ ] Trusted-header settings.
- [ ] Connection policy selector (default / strict / permissive) with explanatory copy and a "this is destructive" warning when permissive is chosen.
- [ ] Theme + locale + timezone preferences.

#### 5.18.3 Audit log

- [ ] Paginated, filterable list (action, actor, time range).
- [ ] Detail drawer rendering structured context with secret values redacted.
- [ ] Export to JSON-lines via streamed download.

#### 5.18.4 API keys

- [ ] List page with prefix + last_four + last_used_at.
- [ ] Create modal with optional scope picker; one-time plaintext reveal with copy-to-clipboard.
- [ ] Revoke confirmation dialog.

#### 5.18.5 Notifications

- [ ] Channels list + create wizard supporting the apprise URL pattern (with a guided SMTP `mailtos://` builder per PRD Glossary) and the webhook (URL/method/headers/body) bundle.
- [ ] Routes matrix UI: rows = event types, columns = channels, cells = enabled toggle.
- [ ] Templates editor per `(event_type, channel_kind)` showing built-in default + override field; warns when `{{variable}}` placeholders are dropped.
- [ ] Test send button per channel.

### 5.19 Phase 19 — i18n + accessibility

#### 5.19.1 Backend i18n

- [ ] Add gettext infrastructure under `comradarr/core/i18n.py`; load `.po` catalogs at startup.
- [ ] Wrap every user-facing error message; substitute context values into the translated template.
- [ ] Notification template defaults registered as gettext message keys.
- [ ] Dev-CLI command `dev_cli i18n extract` updates source catalogs.

#### 5.19.2 Frontend i18n

- [ ] Adopt the chosen library (default Paraglide; confirm in §3) and configure JSON catalogs by feature area under `frontend/messages/`.
- [ ] Wire SSR-time locale resolution from `event.locals.user.locale` (authenticated) or `Accept-Language` (unauthenticated), output to the html `lang` attribute.
- [ ] Locale selector in user preferences; gates incomplete locales behind a "show incomplete translations" toggle.

#### 5.19.3 Weblate integration

- [ ] Add `translations/` directory with backend `.po` and frontend JSON; document the polling configuration on the Weblate side.
- [ ] CI step extracting strings on every PR and committing the diff for translators.

#### 5.19.4 Accessibility

- [ ] Add `axe-core` to the component test harness; fail on AA violations.
- [ ] Confirm shadcn-svelte components inherit Bits UI a11y; replace any custom-built widgets with shadcn primitives where possible.
- [ ] Implement keyboard-only navigation flows: tab order, focus-trap dialogs that release on close, escape-to-close menus, arrow-key navigation in the sidebar.
- [ ] Use `<label>` with for/id pairing on every input; `aria-describedby` for inline help; live regions for SSE-driven announcements.
- [ ] Verify color contrast across `light` and `dark` themes via the automated contrast check in the test suite.
- [ ] Responsive layout from 360px upward.

### 5.20 Phase 20 — Observability

#### 5.20.1 Logging finalization

- [ ] Implement structlog configuration switching `console`/`json` per `COMRADARR_LOG_FORMAT` (PRD §20).
- [ ] Implement event-name taxonomy across the codebase (`sync.*`, `rotation.*`, `connector.*`, `auth.*`, `notification.*`).
- [ ] Implement request logging policy: completion event with method, path (query values stripped), status, size, timing, resolved IP; never log request or response bodies; redact sensitive headers (PRD §20).
- [ ] Implement traceback hygiene: for unhandled exceptions, log type/message/relevant frame/fingerprint without locals (PRD §20).
- [ ] Implement deduplication processor for repeated ERROR events (PRD §20 log volume controls).

#### 5.20.2 Health endpoint final

- [ ] `/health` does DB connectivity and (optional) connector health probe; minimal response; no auth (PRD §20).

#### 5.20.3 Prometheus

- [ ] `/metrics` opt-in via `app_config`; IP allowlist enforced at the endpoint level.
- [ ] Expose: HTTP request counts/latencies (per route + status), sync duration per connector, rotation dispatch counts per tick, command tracking latencies, budget consumption per connector, active session count, DB pool saturation, Python process metrics (PRD §29).
- [ ] No user-identifying labels.

#### 5.20.4 OpenTelemetry

- [ ] Opt-in OTLP-HTTP exporter; spans cover request lifecycle + background ticks + outbound HTTP; span attributes never include user identity (PRD §29).

### 5.21 Phase 21 — Import / export

#### 5.21.1 Snapshot format

- [ ] Define inner JSON schema with version integer; populate exactly the fields enumerated in PRD §30 (and exclude every excluded item).
- [ ] Define the encryption envelope: header (format version, Argon2id parameters, salt, GCM nonce) + ciphertext (PRD §30).

#### 5.21.2 Export endpoint

- [ ] `POST /api/snapshots/export` accepts a passphrase (with confirm); produces an in-memory plaintext doc, derives key with strong Argon2id, encrypts, returns `application/octet-stream` with `.comradarr-snapshot` extension and a filename containing install name + ISO timestamp.
- [ ] Plaintext doc never written to disk; cleared from memory immediately after encryption (PRD §30).
- [ ] Audit-log entry with the high-level summary + size.

#### 5.21.3 Import wizard

- [ ] Frontend `(app)/settings/import/+page.svelte` with file upload + passphrase + dangerous-operation confirmation; preview screen showing what would change; conflict policy selector (replace / merge / skip).
- [ ] `POST /api/snapshots/import` validates schema version; applies in a single transaction; re-encrypts every secret with the target instance's `COMRADARR_SECRET_KEY`.
- [ ] Audit log on success and on every failure (with error kind, never the passphrase).

### 5.22 Phase 22 — Testing matrix

#### 5.22.1 Unit + property-based

- [ ] `tests/unit/` covering planner, differ, tier classifier, cursor codec, budget computation, URL classifier, HTTP boundary validators, error code → URI mapping, template engine.
- [ ] Hypothesis property tests per PRD §22 invariants (planner cover-all, differ correctness, cursor concat-equals-fullset).
- [ ] Suite must run in <1s on CI.

#### 5.22.2 Integration with real Postgres

- [ ] `tests/integration/` using a session-scoped DB created with the migration role; per-test transaction-rollback isolation; `PYTEST_XDIST_WORKER` per-worker schemas (RULE-TEST-002).
- [ ] Repository tests for every repository.
- [ ] Audit-log permission test: an UPDATE/DELETE on `audit_log` from the application role connection raises a `ProgrammingError`.

#### 5.22.3 Fixture-based connector tests

- [ ] `tests/connectors/` replaying recorded fixtures via `httpx.MockTransport`.
- [ ] One scenario per connector method.
- [ ] Nightly canary workflow runs a small subset against demo upstream; on diff, opens an issue automatically.

#### 5.22.4 API tests

- [ ] `tests/api/` using Litestar's `AsyncTestClient` with the app factory + test settings; cover every error code declared in `comradarr/errors/`.
- [ ] Cover CSRF: state-changing requests without a token return 403; setup claim is the only exception.
- [ ] Cover allowed-hosts: 421 on disallowed Host header.
- [ ] Cover CORS: pre-flight with disallowed origin returns no `Access-Control-Allow-Origin`.

#### 5.22.5 Frontend tests

- [ ] Vitest + browser-mode for Svelte 5 components (no jsdom).
- [ ] `axe-core` runs on every component-rendering test; fails on AA violations (PRD §22 / §28).
- [ ] Tests for: theme SSR resolution, tint-on-change atomicity, reduced-motion guards, sidebar collapse, virtual scroll behavior, content browser URL state round-trip.

#### 5.22.6 Coverage

- [ ] Track coverage with `coverage.py` as a diagnostic, not a gate (PRD §22).

### 5.23 Phase 23 — Supply chain hardening

- [ ] CI: `uv sync --frozen` + `uv pip audit` on every PR; nightly scheduled scan against main with auto-open issues.
- [ ] CI: `bun install --frozen-lockfile`.
- [ ] CI: `prek run --all-files`.
- [ ] CI: a job that runs `dev_cli regen-types` and fails on diff with the committed `schema.d.ts`.
- [ ] Renovate config separating security updates (auto-PR) from routine bumps (manual review).
- [ ] Pin every GitHub Action to a tag; document the tag-pinning posture (PRD §23).
- [ ] Add `bunx biome ci` step; integrate `svelte-check --threshold warning` and `tsc --noEmit` per PRD §23.

### 5.24 Phase 24 — Deployment artifacts

#### 5.24.1 Docker image

- [ ] Multi-stage Dockerfile based on `python:3.14-slim-bookworm` plus PostgreSQL 16; build the SvelteKit frontend with `svelte-adapter-bun` in a Bun stage and copy the build into the final image.
- [ ] Run application as a non-root user; bundled PostgreSQL as `postgres` system user with the data directory mounted from a single operator volume (PRD §24).
- [ ] Configure the bundled PG to listen on a Unix socket only (no TCP) and conservative defaults.
- [ ] Init script: if `DATABASE_URL` is unset → start bundled PG, wait for ready, run migrations, exec Granian; else → skip bundled PG, run migrations against external DB, exec Granian.
- [ ] Granian launch: single worker, single threaded, uvloop, 6h worker lifetime, respawn on failure (PRD §24).

#### 5.24.2 Image tagging

- [ ] Publish under `0.1.0`, `0.1`, `0`, `latest`, plus per-build SHA tag (PRD §23).
- [ ] Multi-arch (amd64 + arm64) build via buildx.
- [ ] Generate SBOM and attach to the release.

#### 5.24.3 Dev CLI (`dev_cli/`)

- [ ] uv-managed Python package with subcommands: `check`, `format`, `lint`, `typecheck`, `test`, `test-fast`, `db-up`, `db-down`, `migrate`, `pg`, `regen-types`, `i18n extract`, `serve`, `record-fixture`, `replay-canary`, `snapshot-export`, `snapshot-import`.
- [ ] Mirrors CI exactly so `dev_cli check` passing locally implies CI passing (PRD §23).
- [ ] Publishes a single console-script entry point.

#### 5.24.4 Compose example

- [ ] `compose.example.yaml` with a single service, one volume mount, one env var (`COMRADARR_SECRET_KEY`), no secrets in the file.
- [ ] Document the external-DB override path in `README.md`.

### 5.25 Phase 25 — Release prep

- [ ] Ensure every Python source file's license header references AGPL-3.0.
- [ ] Generate API reference docs from the OpenAPI spec; publish as part of the docs site.
- [ ] Author CONTRIBUTING.md covering: AGPL inbound-equals-outbound, dependency license matrix, fixture recording, prek setup.
- [ ] Author CHANGELOG.md with v0.1.0 entry.
- [ ] CI release workflow: on tag push matching `^[0-9]+\.[0-9]+\.[0-9]+$`, build multi-arch image, push, attach SBOM, publish GitHub Release with `v` prefix in title (PRD §23).
- [ ] Confirm release-cadence policy in CONTRIBUTING.md (no schedule, releases when ready).

---

## 6. Testing and Validation Tasks

### 6.1 Backend test gates

- [ ] Unit suite (`uv run pytest tests/unit -n auto`) completes in <1s.
- [ ] Property tests pass for: planner cover-all invariant, differ correctness, cursor pagination concat-equals-fullset, URL classifier policies, tier classifier idempotence.
- [ ] Integration suite (`uv run pytest tests/integration -n auto`) passes against PostgreSQL service container.
- [ ] Role-permission tests: confirm UPDATE / DELETE on `audit_log` from the application role raises `ProgrammingError`; confirm DELETE from audit-admin role succeeds; confirm DDL from application role fails.
- [ ] Connector fixture suite passes deterministically; recording tool round-trips a captured fixture without drift.
- [ ] API suite covers every Problem Details code declared in `comradarr/errors/` with at least one provoking test (PRD §22).
- [ ] CSRF / CORS / allowed-hosts behavior covered end-to-end.
- [ ] Setup-wizard end-to-end test: bootstrap claim → boundary phases → admin account creation; subsequent requests routed normally.
- [ ] Auth: local login + lockout, trusted-header trust matrix, OIDC happy path + invalid `nonce` + expired `iat` + invalid issuer + invalid audience + JWKS rotation, session idle/absolute timeout, API key permission scoping.

### 6.2 Frontend test gates

- [ ] Vitest browser tests for every component under `src/lib/components/ui/` plus surface-specific components.
- [ ] Axe-core passes on every component test; AA violations fail the build.
- [ ] Theme SSR test: cookie-driven and DB-driven branches paint correctly without flash.
- [ ] Reduced-motion test: heartbeat, tint-on-change, page-load cascade collapse to atomic state swaps.
- [ ] Content-browser URL state round-trip test.
- [ ] Form-action tests for setup wizard and HTTP boundary settings, with the test-driven configuration component covering observed / proposed / testing / committed / rejected transitions.
- [ ] Generated types in sync: CI step regenerates `schema.d.ts` and fails on diff.
- [ ] Biome `check`, `svelte-check`, `tsc --noEmit` green.

### 6.3 Cross-cutting validation

- [ ] HTTP request paths under load: SSE backpressure, content browser virtual scroll at 500k rows, sync of a connector with 100k+ episodes, rotation under daily 100-command default.
- [ ] Snapshot round-trip: export → import in a fresh instance restores connectors, OIDC, HTTP boundary, users, API keys without re-entering secrets.
- [ ] Bootstrap denylist: starting with a known-bad `COMRADARR_SECRET_KEY` exits non-zero with a structured error.
- [ ] Logging redaction: an injected log call attempting to emit a `Secret[bytes]` renders as the marker; injected sensitive headers are redacted.
- [ ] Recovery: after `kill -9`, restart resumes rotation from `last_searched_at`, sync coordinator detects stale timestamps, planned commands are re-polled.
- [ ] DNS rebinding test: a connector hostname that resolves to a public IP at validation time and `127.0.0.1` at request time is rejected on every request.

### 6.4 Static gates

- [ ] `prek run --all-files` clean.
- [ ] `uv run basedpyright` clean in recommended mode.
- [ ] `uv run ruff check` clean (no `# noqa` without justification).
- [ ] `uv run pip-audit` finds no high-severity findings.
- [ ] `bunx biome ci` clean.
- [ ] `bunx svelte-check --threshold warning` clean.
- [ ] `bunx tsc --noEmit` clean.

### 6.5 Edge cases

- [ ] Sync: a series that disappears upstream is pruned from mirror tables and from `search_schedule` in the same transaction.
- [ ] Rotation: a connector whose Prowlarr health falls to "all indexers disabled" is skipped without raising; resumes when health returns.
- [ ] Notifications: 20 simultaneous indexer flips coalesce to one operational-health notification within the 60s window; security events in the same window do not coalesce.
- [ ] OIDC: id_token with `alg=none` is rejected; expired `iat` (outside replay window) is rejected; missing `nonce` is rejected.
- [ ] Frontend: theme cookie missing on first visit triggers the synchronous inline script and writes the cookie before stylesheet parse.
- [ ] Setup gate: a request to `/api/connectors` while `setup_completed=false` returns 401 (API) and `/api/connectors` is not reachable.
- [ ] CSRF: `/setup/claim` accepts a missing Origin header; every other state-changing endpoint rejects it.
- [ ] Audit log retention: when configured cap is reached, the audit-admin role vacuums oldest rows; the application role cannot.

---

## 7. Risks, Dependencies, and Rollout Considerations

### 7.1 Technical risks

- [ ] **Free-threaded Python (no-GIL).** Backend rules DECIDE-NOGIL: default GIL build for v1; revisit only if a measured GIL-bound hotspot appears and every C-ext wheel is `cp314t`.
- [ ] **OpenAPI / TypeScript drift.** Mitigated by CI gate + dev-CLI `regen-types`. Risk: silently outdated types if developers skip the regen step.
- [ ] **Bundled PostgreSQL conflict with operator-managed Postgres.** Documented by the `DATABASE_URL` override path; risk is operator confusion. Mitigation: single sentence in `README.md` stating the override behavior.
- [ ] **Fixture rot.** Mitigated by canary workflow; residual risk that demo instances are unavailable. Mitigation: opt-in self-hosted canary.
- [ ] **shadcn-svelte CLI depending on Tailwind config.** Mitigated by empty stub; risk is CLI evolution. Track upstream and revisit `RULE-SHADCN-002`.
- [ ] **Setup-wizard test endpoints reachable pre-completion.** Mitigated by setup-gate allowlist; risk of allowlist regression. Test cases enforce.
- [ ] **Bootstrap token leakage.** Token printed to stdout is also written to a file inside the container; risk if the file is mounted to a shared volume. Mitigation: file lives under `/var/lib/comradarr/bootstrap` (not under the operator's data volume).
- [ ] **CSRF + double-submit cookie + SameSite trade-offs.** Risk that an aggressive CSP blocks the inline theme script. Mitigation: nonce-based CSP for the inline theme script, documented.
- [ ] **Argon2id parameter selection.** Need separate parameter sets for password vs. snapshot key derivation. Risk: under-parameterized snapshot key derivation. Mitigation: snapshot params set well above interactive thresholds (e.g., 1 GiB, 4 iters, 4 lanes) per PRD §30.
- [ ] **OIDC clock skew.** Risk: token validation fails on slightly-skewed clocks. Mitigation: tolerate 60s skew on `iat` / `exp`.
- [ ] **PostgreSQL major version drift between bundled and external.** Risk: SQL behavior differs on older operator-managed Postgres. Mitigation: README states minimum 16.x; init script aborts on older.
- [ ] **Apprise dependency churn.** Risk of breaking changes in apprise URL syntax. Mitigation: pin minor version; nightly canary covers SMTP and at least one apprise scheme.

### 7.2 Dependencies

- [ ] External: Sonarr, Radarr, Prowlarr instances reachable at configured URLs. Sonarr v3+, Radarr v4+, Prowlarr v1+.
- [ ] Network: bundled deployment requires the container to reach the *arr instances and any OIDC provider; no inbound connectivity beyond the operator's reverse proxy.
- [ ] Cryptography: `cryptography` library for AES-256-GCM; `argon2-cffi` for Argon2id.
- [ ] Translation: Weblate instance polling the repo's `translations/` directory.
- [ ] Container registry for image publishing.
- [ ] PyPI advisory database + OSV for `pip-audit`.

### 7.3 Sequencing constraints

- [ ] Phase 4 (auth) depends on Phase 3 (crypto + Secret).
- [ ] Phase 5 (setup wizard) depends on Phase 4 + Phase 6 (HTTP boundary middleware).
- [ ] Phase 7 (connector subsystem) depends on Phase 1 (HTTP client lifespan) + Phase 3 (crypto).
- [ ] Phase 9 (sync) depends on Phase 7 + Phase 8 (clients).
- [ ] Phase 10 (rotation) depends on Phase 9.
- [ ] Phase 11 (event bus + SSE) is independent and can land in parallel with Phase 9–10.
- [ ] Phase 12 (notifications) depends on Phase 11.
- [ ] Phase 13 (API layer) depends on Phase 9–12.
- [ ] Phase 14 (frontend foundations) depends on Phase 13's OpenAPI surface.
- [ ] Phases 15–18 depend on Phase 14 + Phase 13 endpoints they consume.
- [ ] Phase 21 (import/export) depends on Phase 3 + Phase 13.
- [ ] Phase 24 (deployment) depends on every functional phase.

### 7.4 Rollout

- [ ] Pre-1.0 is 0.x semver; minor-version bumps may carry breaking changes per PRD §23.
- [ ] First public release: v0.1.0; release notes call out bootstrap flow, three auth providers, single-image deployment.
- [ ] Image tag policy: `0.1.0`, `0.1`, `0`, `latest` all published; document the operator's choice.
- [ ] Forward-only migrations; document recovery via PG restore.
- [ ] Backup reminders surface in container logs at startup whenever a pending migration is detected (PRD §27).
- [ ] No telemetry by default. Operators opt in to `/metrics` and OTLP through the post-setup UI.
- [ ] Provide an upgrade-path doc per PRD §27.

### 7.5 Operational and security considerations

- [ ] Document key management for `COMRADARR_SECRET_KEY` in README and import/export guide.
- [ ] Document recovery scenarios: lost master key, lost passphrase, lost database.
- [ ] Document the `_FILE` env-suffix pattern for every secret-bearing variable.
- [ ] Document the `COMRADARR_DISABLE_LOCAL_LOGIN` and `COMRADARR_RECOVERY_MODE` break-glass toggles.
- [ ] Document the bundled-vs-external Postgres decision and the migration path between them (operator-driven `pg_dump`/`pg_restore`).

---

## 8. Definition of Done

A workstream is done only when **every** item below is true.

- [ ] All checkboxes in §5 are completed.
- [ ] `prek run --all-files` is green on a clean checkout.
- [ ] `uv run basedpyright` reports zero issues in `recommended` mode.
- [ ] `uv run ruff check` and `uv run ruff format --check` are clean; every `# noqa` carries a justified comment.
- [ ] `uv run pytest -n auto` is green, including unit, integration, fixture-based connector, and API suites.
- [ ] `uv run pip-audit` reports no findings above the configured severity threshold.
- [ ] `bunx biome ci`, `bunx svelte-check --threshold warning`, `bunx tsc --noEmit` are clean.
- [ ] `bun test` (browser mode for Svelte 5) is green; axe-core finds zero AA violations on rendered components.
- [ ] OpenAPI spec served by Litestar matches the committed `schema.d.ts` (CI gate green).
- [ ] All endpoints declared in PRD §17 are reachable and authenticated/authorized correctly.
- [ ] Setup wizard end-to-end (claim → HTTP boundary verification × 4 → admin) succeeds against a fresh container; `setup_completed` flips to true.
- [ ] Bootstrap token denylist + master-key denylist refusals exit with structured errors and non-zero status.
- [ ] CSRF, CORS, allowed-hosts, security headers, and CSP behave per PRD §16; report-only and insecure-cookies modes log the warning and behave correctly.
- [ ] Audit log entries exist for every action enum value (verified by API tests provoking each).
- [ ] Snapshot export → import round-trip restores connectors, OIDC, HTTP boundary, users, API keys without re-entering secrets.
- [ ] Recorded-fixture canary runs nightly and opens GitHub issues on drift.
- [ ] Docker image builds for amd64 + arm64; SBOM attached; multi-tag publishing works.
- [ ] Bundled PostgreSQL deployment boots with one env var (`COMRADARR_SECRET_KEY`) and reaches the setup wizard at `/setup`.
- [ ] External-PostgreSQL override path boots, runs migrations, and reaches the setup wizard.
- [ ] Translation catalogs (`translations/`) are emitted; Weblate config in repo; backend and frontend resolve locale per user preference and `Accept-Language` fallback.
- [ ] WCAG 2.2 AA verified on every shipping page via axe-core; manual keyboard-only smoke test passes.
- [ ] Frontend never flashes wrong theme on first paint (verified with cookie-set, cookie-absent, authenticated-with-DB-pref, authenticated-with-system, unauthenticated cases).
- [ ] All numerals representing counts/timings/percentages render in `font-mono`; SSE-driven swaps are atomic.
- [ ] Heartbeat indicator reflects rotation engine state; static when idle.
- [ ] `prefers-reduced-motion: reduce` collapses every animation universally.
- [ ] Health endpoint reachable without auth; metrics + OTLP reachable only when opted in.
- [ ] Logs in production render as JSON lines; secret values render as redaction markers; tracebacks omit frame locals.
- [ ] CHANGELOG.md, CONTRIBUTING.md, and README.md document v0.1.0 surface.
- [ ] License headers present in every source file; AGPL-3.0 LICENSE at root.
- [ ] All open questions in §3 are resolved with the maintainer or moved to a tracked backlog item.
