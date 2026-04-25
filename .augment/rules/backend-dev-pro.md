---
type: "agent_requested"
description: "Litestar + Granian + msgspec + SQLAlchemy 2.0 (Python 3.14) Development Guidelines"
---

# Litestar + Granian + msgspec + SQLAlchemy 2.0 (Python 3.14) Development Guidelines

## 0. Agent Operating Contract

You are generating code for a Python 3.14+ backend built on **Litestar 2.x (ASGI) / Granian 2.x / msgspec 0.20 / SQLAlchemy 2.0 async + asyncpg / PostgreSQL / Alembic / httpx / structlog**, managed with **uv**, linted with **ruff**, type-checked with **basedpyright (recommended)**, tested with **pytest + pytest-asyncio + pytest-xdist**.

Operating rules:

1. Obey every **RULE-\*** in §4 without exception. They are hard gates.
2. Never generate the patterns listed in §5/§12 (FastAPI, Pydantic, Flask, Django, uvicorn CLI, sync SQLAlchemy 1.x, psycopg2, `requests`, stdlib `logging.getLogger` + f-strings, pip/poetry/pipenv, black/isort/mypy, `unittest.IsolatedAsyncioTestCase`). If asked, refuse and redirect to the canonical equivalent.
3. When you must choose between ambiguous options, follow §6 decision trees in order.
4. Every file you generate MUST include its intended path in a header comment in the code block. Every command MUST use `uv run …` unless it is a `uv` subcommand itself.
5. Every public function/method must be fully type-annotated. `Any` and implicit `Any` are rejected under basedpyright `recommended`.
6. All I/O is `async` by default. Synchronous route handlers, dependencies, or DB calls must be explicitly justified with `sync_to_thread=True`.
7. All datetimes are **UTC** and **timezone-aware**. All IDs are **UUIDv7** unless PG-serial is explicitly required.
8. All serialization and validation goes through **msgspec** — never Pydantic, dataclasses-as-API, or TypedDict-as-API.
9. Read the Rule Index (§3) before generating code. If a task touches topic X, re-read the relevant section.

## 0.1 How to Search This Document

| I am generating… | Jump to |
|---|---|
| Project scaffold / `pyproject.toml` | §7, RECIPE-PROJECT-INIT |
| Route handler / Controller | §8.2, RECIPE-CRUD, PATTERN-HANDLER |
| DB model / query | §8.4, PATTERN-MODEL, PATTERN-QUERY |
| DB session wiring | RECIPE-DB-SESSION, PATTERN-SESSION |
| Alembic migrations | RECIPE-ALEMBIC-ASYNC |
| Outbound HTTP | §8.6, PATTERN-HTTPX-CLIENT |
| Logging | §9.3, RECIPE-STRUCTLOG |
| Tests | §13, RECIPE-PYTEST-DB |
| Serving the app | RECIPE-GRANIAN-RUN |
| Type errors from basedpyright | §13.4, DECIDE-TYPING |
| "Should I use Pydantic / FastAPI / requests?" | §5, §12 — NO. |

Search IDs: `RULE-###`, `DECIDE-###`, `PATTERN-###`, `RECIPE-###`, `ANTI-###`, `VERIFY-###`, `SOURCE-###`.

---

## 1. Stack Snapshot

As of **24 April 2026**. All versions verified against PyPI / official changelogs.

| Component | Pinned floor | Status | Notes |
|---|---|---|---|
| CPython | `>=3.14,<3.15` | Stable | 3.14.0 released Oct 2025; 3.14.3 current patch [Source](https://www.python.org/downloads/release/python-3143/) |
| Litestar | `>=2.19,<3.0` | Stable | 2.19.0 released 2026-03-07; 3.0 is pre-release and NOT used here [Source](https://pypi.org/project/litestar/) |
| Granian | `>=2.7,<3.0` | Stable | 2.7.4 released 2026-04-23 [Source](https://pypi.org/project/granian/) |
| msgspec | `>=0.20,<0.21` | Stable | 0.20.0 released 2025-11-24, wheels for cp314 + cp314t [Source](https://pypi.org/project/msgspec/) |
| SQLAlchemy | `>=2.0.46,<2.1` | Stable | 2.0.46 released 2026-01-21; 2.1.0b2 is beta and NOT used here [Source](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html) |
| asyncpg | `>=0.30` | Stable | Required asyncio driver for PostgreSQL |
| PostgreSQL | `>=16` | Stable | 16.x baseline; timestamptz, JSONB, UUID v7 via app |
| Alembic | `>=1.18` | Stable | Async template `pyproject_async` available [Source](https://alembic.sqlalchemy.org/en/latest/cookbook.html) |
| httpx | `>=0.28,<0.29` | Stable | Default timeout 5s (all ops) [Source](https://www.python-httpx.org/advanced/timeouts/) |
| structlog | `>=25.5` | Stable | 25.5.0 current [Source](https://www.structlog.org/en/stable/api.html) |
| uv | `>=0.11,<0.12` | Stable | 0.11.7 released 2026-04-15 [Source](https://pypi.org/project/uv/) |
| ruff | `>=0.15.11,<1.0` | Stable | 0.15.11 released 2026-04-16 [Source](https://pypi.org/project/ruff/) |
| basedpyright | `>=1.38,<2.0` | Stable | 1.38.2 released 2026-02-26; default `typeCheckingMode = "recommended"` [Source](https://docs.basedpyright.com/latest/configuration/config-files/) |
| pytest | `>=8.3` | Stable | |
| pytest-asyncio | `>=1.3,<2.0` | Stable | 1.0 removed `event_loop` fixture [Source](https://pytest-asyncio.readthedocs.io/en/stable/reference/changelog.html) |
| pytest-xdist | `>=3.8` | Stable | [Source](https://pypi.org/project/pytest-xdist/) |

Python 3.14 highlights relevant to this stack:
- **PEP 649/749**: deferred evaluation of annotations is the default; `from __future__ import annotations` is no longer needed and should be dropped [Source](https://docs.python.org/3.14/whatsnew/3.14.html).
- **PEP 779**: free-threaded (no-GIL) build is officially supported but still **optional**; the default CPython build keeps the GIL. Treated as **Conditional** here — see DECIDE-NOGIL.
- **PEP 750**: t-strings (`t"…"`) are available. For logs/SQL/HTML we use structlog key-values, SQLAlchemy parameters, and Jinja — t-strings are not required.
- **PEP 734**: `concurrent.interpreters` is in stdlib. Not used in request-path code.
- **PEP 784**: `compression.zstd` is in stdlib.

## 2. Status & Adoption Policy

Status values (only these three are permitted):

- **Stable** — required or default. Generate this.
- **Conditional** — allowed only when a RULE explicitly lists the condition.
- **Reject** — never generate; refuse if asked.

| Item | Status |
|---|---|
| Litestar 2.x | Stable |
| Litestar 3.x pre-release | Reject (not GA as of 2026-04-24) |
| Granian ASGI interface (`--interface asgi`) | Stable |
| Granian RSGI interface | Conditional — only for Granian-native apps, not Litestar |
| Free-threaded Python (`cpython3.14t`) | Conditional — only if every C-ext wheel (asyncpg, msgspec, granian) is installed as a `cp314t` wheel and load tested. Default build is GIL-enabled. [Source](https://docs.python.org/3.14/whatsnew/3.14.html) |
| `from __future__ import annotations` | Reject on 3.14 (unused; masks PEP 649 semantics) |
| msgspec `Struct` | Stable |
| Pydantic BaseModel | Reject |
| SQLAlchemy 2.0 async + asyncpg | Stable |
| SQLAlchemy 2.1 beta | Reject |
| Sync `Session` / `session.query()` | Reject |
| psycopg2 / psycopg (v3) | Reject |
| httpx `AsyncClient` | Stable |
| `requests` / `urllib3` direct | Reject |
| structlog + `ProcessorFormatter` | Stable |
| Stdlib `logging.getLogger` used directly in app code | Reject |
| uv + `uv.lock` | Stable |
| pip / poetry / pipenv / pdm / hatch-env | Reject |
| ruff check + ruff format | Stable |
| black / isort / flake8 / autopep8 | Reject |
| basedpyright `recommended` | Stable |
| mypy / pyright (unbased) | Reject |
| pytest-asyncio `asyncio_mode = "auto"` | Stable |
| `unittest.IsolatedAsyncioTestCase` | Reject |
| Litestar `AsyncTestClient` | Stable |
| Litestar `TestClient` (sync) | Conditional — only for purely synchronous tests with no external async resources |

## 3. Rule Index

Hard gates (§4):

- RULE-PY-001 Python 3.14+ only
- RULE-PY-002 No `from __future__ import annotations`
- RULE-PY-003 No `typing.Any`, no untyped parameters, no untyped returns
- RULE-ASYNC-001 Every route handler is `async def`
- RULE-ASYNC-002 Sync callables in DI/handlers require explicit `sync_to_thread=`
- RULE-SER-001 All request/response models are `msgspec.Struct`
- RULE-SER-002 No Pydantic, no dataclasses at the API boundary
- RULE-DB-001 `create_async_engine` + `async_sessionmaker(expire_on_commit=False)` only
- RULE-DB-002 `postgresql+asyncpg://…` driver URL only
- RULE-DB-003 All queries use 2.0-style `select()` + `session.execute()` / `session.scalars()`
- RULE-DB-004 No lazy-loaded relationships at request time; use `selectinload`/`joinedload`
- RULE-DB-005 PKs are `uuid.UUID` with `DateTime(timezone=True)` timestamps
- RULE-HTTP-001 Outbound HTTP uses `httpx.AsyncClient` only
- RULE-HTTP-002 Explicit `httpx.Timeout(…)` on every client; never rely on the 5 s default silently
- RULE-HTTP-003 One app-scoped `AsyncClient` per external service, created in `lifespan`
- RULE-LOG-001 Logging goes through structlog via `structlog.stdlib.get_logger(__name__)` with `ProcessorFormatter` bridge
- RULE-LOG-002 No f-string interpolation of log event text; use kwargs
- RULE-TOOL-001 Dependencies are managed with uv + `uv.lock`; CI uses `uv sync --frozen`
- RULE-TOOL-002 Formatting/lint via `ruff format` + `ruff check --fix`
- RULE-TOOL-003 Type checking via `uv run basedpyright` in `recommended` mode
- RULE-TEST-001 `asyncio_mode = "auto"`; fixtures use `@pytest_asyncio.fixture`
- RULE-TEST-002 xdist-safe DB isolation via `PYTEST_XDIST_WORKER` and per-worker schemas
- RULE-SRV-001 Production serving: `granian --interface asgi …`; dev: `uv run granian --reload`
- RULE-SEC-001 No secrets in code, `pyproject.toml`, or logs; environment variables only
- RULE-API-002 HTTP error responses use RFC 9457 problem-details (`application/problem+json`); RFC 7807 is obsoleted — do not cite in new code
- RULE-AUTHZ-MATCH-001 Allowlist comparators in security-adjacent paths use exact-string equality; permissive defaults forbidden unless PRD-mandated
- RULE-TOOL-LINT-001 Ruff `S` (flake8-bandit) selection is enabled and unwaived; per-line `# noqa: S###` requires a justification comment
- RULE-MIGR-001 Alembic uses the async env template; never `op.batch_alter_table` on PostgreSQL

Decision trees (§6): DECIDE-HANDLER, DECIDE-DTO, DECIDE-SYNC, DECIDE-EAGER-LOAD, DECIDE-TYPING, DECIDE-NOGIL, DECIDE-HTTP-CLIENT, DECIDE-TEST-CLIENT, DECIDE-ID.

Patterns (§10): PATTERN-APP, PATTERN-HANDLER, PATTERN-CONTROLLER, PATTERN-DI, PATTERN-SESSION, PATTERN-MODEL, PATTERN-QUERY, PATTERN-HTTPX-CLIENT, PATTERN-STRUCTLOG, PATTERN-LIFESPAN, PATTERN-ERROR.

Recipes (§11): RECIPE-PROJECT-INIT, RECIPE-CRUD, RECIPE-DB-SESSION, RECIPE-ALEMBIC-ASYNC, RECIPE-STRUCTLOG, RECIPE-GRANIAN-RUN, RECIPE-PYTEST-DB.

## 4. Hard Rules

**RULE-PY-001** — `requires-python = ">=3.14"`. The `.python-version` file must contain `3.14` (or a more specific 3.14.x) and be committed. Run `uv python pin 3.14` to create it [Source](https://github.com/astral-sh/uv).

**RULE-PY-002** — Do not write `from __future__ import annotations`. PEP 649 makes annotation evaluation lazy by default in 3.14; the future import changes semantics of `typing.get_type_hints` and Litestar signature introspection in non-obvious ways [Source](https://docs.python.org/3.14/whatsnew/3.14.html). Use native `X | Y`, `list[X]`, `dict[str, X]`.

**RULE-PY-003** — `Any` is rejected. basedpyright `recommended` enables `reportAny` and `reportExplicitAny` among others [Source](https://docs.basedpyright.com/latest/benefits-over-pyright/new-diagnostic-rules/). If you must interface with an untyped library, narrow immediately with `msgspec.convert` or `cast` + a concrete type.

**RULE-ASYNC-001** — All Litestar route handlers are `async def`. Mixing sync handlers forces Litestar to off-thread them and is rejected unless an explicit `sync_to_thread=True` is set on the decorator [Source](https://docs.litestar.dev/2/usage/dependency-injection.html).

**RULE-ASYNC-002** — When a dependency or handler must be synchronous (CPU-bound or blocking library), set `Provide(fn, sync_to_thread=True)` or `@get(..., sync_to_thread=True)`. Never block the event loop silently.

**RULE-SER-001 / RULE-SER-002** — Request bodies, response bodies, and DTOs are `msgspec.Struct` subclasses. Use `litestar.dto.MsgspecDTO[StructType]` when field include/exclude/rename is required [Source](https://docs.litestar.dev/2/reference/dto/msgspec_dto.html). No Pydantic, no plain dataclasses, no TypedDict for the public API.

**RULE-DB-001** — DB access uses `sqlalchemy.ext.asyncio.create_async_engine` + `async_sessionmaker(engine, expire_on_commit=False)`. `expire_on_commit=False` is required for async because lazy re-load of expired attributes after commit is not supported under asyncio [Source](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html).

**RULE-DB-002** — Engine URL must be `postgresql+asyncpg://…`. psycopg / psycopg2 are Reject.

**RULE-DB-003** — 2.0-style only. Allowed: `select(Model).where(…)`, `session.execute(stmt)`, `session.scalars(stmt)`, `session.scalar_one_or_none()`, `session.get(Model, pk)`. Reject: `session.query(...)`, `Model.query`, `Query()` API [Source](https://docs.sqlalchemy.org/en/21/changelog/whatsnew_20.html).

**RULE-DB-004** — Async sessions cannot lazy-load relationships after a handler returns. Every relationship accessed in a response must be loaded with `selectinload(...)` / `joinedload(...)`, or with `AsyncAttrs.awaitable_attrs` inside the handler [Source](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html).

**RULE-DB-005** — Primary keys are `uuid.UUID` (UUIDv7 preferred — stdlib `uuid.uuid7()` is available in Python 3.14 [Source](https://realpython.com/python-news-november-2025/)). Timestamp columns are `Mapped[datetime]` with `mapped_column(DateTime(timezone=True))` and default `lambda: datetime.now(UTC)`. Postgres stores `timestamptz` as UTC [Source](https://www.postgresql.org/docs/current/datatype-datetime.html).

**RULE-HTTP-001 / 002 / 003** — Outbound HTTP uses `httpx.AsyncClient`. The default timeout is 5 s for **every** operation (connect/read/write/pool) [Source](https://www.python-httpx.org/advanced/timeouts/); always pass an explicit `httpx.Timeout(...)`. Instantiate one long-lived client per external service in `lifespan` and inject it; do not create `AsyncClient()` per request.

**RULE-LOG-001 / 002** — The app's loggers are obtained with `structlog.stdlib.get_logger(__name__)` after configuring structlog to bridge into stdlib `logging` via `structlog.stdlib.ProcessorFormatter` [Source](https://www.structlog.org/en/stable/api.html). Logs are structured key/values — never `logger.info(f"user {id} did {x}")`. Write `logger.info("user_action", user_id=id, action=x)`.

**RULE-TOOL-001** — `uv init`, `uv add`, `uv sync`, `uv lock`. `uv.lock` is committed. CI uses `uv sync --frozen`. Do not write `requirements.txt`, `Pipfile`, `poetry.lock`, or `pdm.lock` [Source](https://docs.astral.sh/uv/concepts/projects/dependencies/).

**RULE-TOOL-002** — Formatting and linting are `ruff format` and `ruff check --fix` respectively, configured under `[tool.ruff]` in `pyproject.toml` [Source](https://docs.astral.sh/ruff/configuration/). black/isort/flake8 config sections are Reject.

**RULE-TOOL-003** — Type checking uses `uv run basedpyright` with `[tool.basedpyright]` in `pyproject.toml` and `typeCheckingMode = "recommended"` (this is the default of basedpyright but must be set explicitly so editor defaults like Zed's `"standard"` don't silently weaken it [Source](https://zed.dev/docs/languages/python)).

**RULE-TEST-001** — `pyproject.toml` sets `asyncio_mode = "auto"` and `asyncio_default_fixture_loop_scope = "session"`. Async fixtures use `@pytest_asyncio.fixture` (required since pytest-asyncio 0.23/1.x where `@pytest.fixture` on async functions is deprecated in strict mode [Source](https://pytest-asyncio.readthedocs.io/en/stable/reference/changelog.html)).

**RULE-TEST-002** — Under xdist, each worker gets its own DB schema keyed on `os.environ["PYTEST_XDIST_WORKER"]` (value `"gw0"`, `"gw1"`, … or `"master"` when `-n0`) [Source](https://pytest-xdist.readthedocs.io/en/stable/how-to.html).

**RULE-SRV-001** — Production: `granian --interface asgi --host 0.0.0.0 --port 8000 --workers N --loop uvloop --log-access app.main:app`. Dev: add `--reload`. Do **not** use `uvicorn` CLI flags (`--reload-dir`, `--workers` semantics differ) [Source](https://github.com/emmett-framework/granian).

**RULE-MIGR-001** — Alembic environment is initialized with `alembic init -t async` (or the newer `pyproject_async` template) [Source](https://alembic.sqlalchemy.org/en/latest/cookbook.html). `op.batch_alter_table(...)` is SQLite-only; on PostgreSQL it is unnecessary and Reject.

**RULE-AUTHZ-MATCH-001** — Allowlist comparators in security-adjacent code paths (CORS, CSRF Origin/Referer, route-prefix gating, OAuth/OIDC redirect URIs, IP/host filters, trusted-proxy peer checks, allowed-host validation) MUST use exact-string equality against an explicit list. Permissive defaults — wildcard, prefix-only, case-insensitive substring — are forbidden unless the PRD explicitly mandates them. An empty allowlist denies everything; it never falls back to "allow all". The matcher is the same shape regardless of source language: backend uses `value in allowlist` against a normalized list; frontend uses `URL.pathname.startsWith(prefix)` only when the prefix itself is in the allowlist (never `String.prototype.includes`/substring/regex/fuzzy match).

**RULE-TOOL-LINT-001** — Ruff `S` (flake8-bandit) selection MUST be enabled in `[tool.ruff.lint] select` and unwaived in CI. Per-line `# noqa: S###` requires a justification comment on the same line; bare `# noqa` and file-level `# ruff: noqa: S` are Reject. Pre-commit (`prek`) and CI both run `ruff check`; the rule is the enforcement point for "no eval, no exec, no hardcoded passwords, no weak crypto, no SSL verify-disable, no `requests` without timeout" and similar bandit-class findings [Source](https://docs.astral.sh/ruff/rules/#flake8-bandit-s).

## 5. Top Anti-Patterns

These are the highest-frequency drift hazards from AI training data. Treat any occurrence as a bug.

| ID | Anti-pattern | Correct |
|---|---|---|
| ANTI-001 | `from fastapi import FastAPI` / `app = FastAPI()` | `from litestar import Litestar` |
| ANTI-002 | `Depends(fn)` as default arg | `dependencies={"x": Provide(fn)}` on handler/controller/app |
| ANTI-003 | `response_model=SomeModel` in decorator | Annotate handler return type; Litestar infers |
| ANTI-004 | `class Foo(BaseModel)` / `pydantic.Field` | `class Foo(msgspec.Struct)` / `msgspec.Meta` |
| ANTI-005 | `from flask import …` / `from django…` in an API service | Litestar controllers / route handlers |
| ANTI-006 | `uvicorn app:app --reload --workers 4` | `granian --interface asgi --reload app.main:app` (see RECIPE-GRANIAN-RUN) |
| ANTI-007 | `from sqlalchemy.orm import Session; Session()` / `session.query(X)` | `AsyncSession`, `select()`, `session.scalars()` |
| ANTI-008 | `postgresql+psycopg2://` / `postgresql+psycopg://` | `postgresql+asyncpg://` |
| ANTI-009 | `import requests; requests.get(...)` | `async with httpx.AsyncClient(timeout=Timeout(10.0)) as c: await c.get(...)` |
| ANTI-010 | `logging.getLogger(__name__); logger.info(f"x={x}")` | `structlog.stdlib.get_logger(__name__); logger.info("x_observed", x=x)` |
| ANTI-011 | `pip install …` / `poetry add …` / `pipenv install …` | `uv add …` |
| ANTI-012 | `[tool.black]`, `[tool.isort]`, `[tool.mypy]` in `pyproject.toml` | `[tool.ruff]`, `[tool.basedpyright]` |
| ANTI-013 | `class MyTest(IsolatedAsyncioTestCase)` | `async def test_…` with `asyncio_mode = "auto"` |
| ANTI-014 | `from __future__ import annotations` on 3.14 | Delete it |
| ANTI-015 | `@pytest.fixture` on `async def` | `@pytest_asyncio.fixture` |
| ANTI-016 | `httpx.AsyncClient()` constructed inside a handler | App-scoped client injected via DI |
| ANTI-017 | Lazy-loaded relationship access in handler response | `selectinload(...)` at query time |
| ANTI-018 | `Column(Integer, primary_key=True)` | `mapped_column(primary_key=True)` with `Mapped[UUID]` |
| ANTI-019 | `event_loop` fixture override | `loop_scope="session"` on `@pytest_asyncio.fixture` |
| ANTI-020 | `op.batch_alter_table` on PG Alembic migration | Use plain `op.alter_column`/`op.add_column` |

## 6. Decision Trees

**DECIDE-HANDLER** — *function handler vs `Controller`?*
1. A single endpoint, no shared path/guards/deps → function handler with `@get`/`@post`.
2. ≥ 2 endpoints share a path prefix, guards, dependencies, or DTOs → `class Controller(Controller): path = "/x"` [Source](https://docs.litestar.dev/2/reference/controller.html).
3. Multiple controllers share the same prefix/middleware → `Router(path="/api/v1", route_handlers=[...])`.

**DECIDE-DTO** — *do I need a DTO?*
1. The wire shape equals the Struct shape → no DTO; return the Struct.
2. You need `exclude`, `include`, `rename_fields`, or `partial` → `MsgspecDTO[Struct]` with `DTOConfig(...)` [Source](https://docs.litestar.dev/2/reference/dto/msgspec_dto.html).
3. You're exposing a SQLAlchemy model directly → use `advanced_alchemy.extensions.litestar.SQLAlchemyDTO` [Source](https://docs.advanced-alchemy.litestar.dev/latest/reference/extensions/litestar/index.html); otherwise build a separate Struct.

**DECIDE-SYNC** — *can this be sync?*
1. Pure CPU, < 1 ms → sync is fine, set `sync_to_thread=False`.
2. Calls blocking I/O or does ≥ 1 ms work → `sync_to_thread=True`.
3. Anything awaiting I/O → `async def` (always preferred).

**DECIDE-EAGER-LOAD** — *`selectinload` vs `joinedload`?*
1. Collection relationship (`one-to-many`, `many-to-many`) → `selectinload` (2 queries, no cartesian blow-up).
2. Scalar relationship (`many-to-one`, `one-to-one`) and you will always need it → `joinedload`.
3. Occasional single-attribute access at handler time → inherit from `AsyncAttrs` and `await obj.awaitable_attrs.rel` [Source](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html).

**DECIDE-TYPING** — *basedpyright complaint workflow:*
1. `reportUnknownMemberType` / `reportUnknownVariableType` → add proper annotation; **do not** silence with `# pyright: ignore`.
2. `reportAny` / `reportExplicitAny` → replace `Any` with a concrete type or a tight `Union`; if truly dynamic, `object` + runtime `msgspec.convert`.
3. Third-party stub missing → add a narrow `.pyi` or `cast(ConcreteType, value)` at the boundary; never widen downstream.
4. Use `# pyright: ignore[ruleName]` **with** the rule name, never bare `# type: ignore` (rejected via `enableTypeIgnoreComments = false`) [Source](https://docs.basedpyright.com/latest/benefits-over-pyright/new-diagnostic-rules/).

**DECIDE-NOGIL** — *use the free-threaded build?*
1. Default: **no**. Use the standard GIL build.
2. All of: (a) all deps publish `cp314t` wheels (msgspec 0.20 does [Source](https://pypi.org/project/msgspec/); granian 2.0+ does [Source](https://pypi.org/project/granian/); asyncpg — verify), (b) you have measured a GIL-bound CPU hotspot, (c) you have load tested → you may opt in with `uv python install 3.14t` and `uv python pin 3.14t`.
3. Granian refuses to start if the GIL gets re-enabled on a free-threaded build [Source](https://pypi.org/project/granian/). Ensure your image uses the correct variant.

**DECIDE-HTTP-CLIENT** — *per-request vs app-scoped?*
1. Always app-scoped (`lifespan` creates one `AsyncClient` per external service, DI injects it). Connection pooling and HTTP/2 benefits depend on this [Source](https://deepwiki.com/encode/httpx/6.2-connection-limits).
2. Per-request `AsyncClient()` only for one-off scripts, never in request path.

**DECIDE-TEST-CLIENT** — *`AsyncTestClient` vs `TestClient`?*
1. Any async fixture in the test (DB session, httpx client, etc.) → `AsyncTestClient` [Source](https://docs.litestar.dev/main/usage/testing.html).
2. Purely synchronous probe, no awaited fixtures → `TestClient` is acceptable.

**DECIDE-ID** — *UUID vs serial?*
1. Default: UUIDv7 (`uuid.uuid7()` stdlib in 3.14) — sortable, globally unique, safe for sharding.
2. `BIGSERIAL` only for write-hot append-only tables where UUIDv7 indexing cost is measured.

## 7. Canonical Project Structure

```
my_service/
├── .python-version                 # "3.14"
├── pyproject.toml
├── uv.lock                         # committed
├── alembic.ini
├── migrations/
│   ├── env.py                      # async, see RECIPE-ALEMBIC-ASYNC
│   ├── script.py.mako
│   └── versions/
├── src/
│   └── my_service/
│       ├── __init__.py
│       ├── main.py                 # builds Litestar app
│       ├── config.py               # settings as msgspec.Struct
│       ├── db/
│       │   ├── __init__.py
│       │   ├── engine.py           # create_async_engine, async_sessionmaker
│       │   ├── base.py             # DeclarativeBase + AsyncAttrs
│       │   └── models/
│       ├── domain/
│       │   └── <bounded_context>/
│       │       ├── controllers.py
│       │       ├── services.py
│       │       ├── repositories.py
│       │       └── schemas.py      # msgspec.Struct only
│       ├── plugins/
│       │   ├── logging.py          # structlog config
│       │   └── http.py             # httpx lifespan
│       └── py.typed
├── tests/
│   ├── conftest.py                 # async fixtures, xdist DB isolation
│   └── …
└── README.md
```

Layering rules:
- `db/` knows nothing about Litestar.
- `domain/*/schemas.py` has only `msgspec.Struct` — no SQLAlchemy imports.
- `controllers.py` depends on `services.py`; services depend on `repositories.py`; repositories depend on `db/`.
- `plugins/` holds cross-cutting concerns wired in `main.py`.

## 8. Layer Guidelines

### 8.1 Configuration

```python
# src/my_service/config.py
import os
import msgspec

class Settings(msgspec.Struct, frozen=True, kw_only=True):
    database_url: str
    log_level: str = "INFO"
    http_timeout_seconds: float = 10.0
    env: str = "dev"

def load_settings() -> Settings:
    return msgspec.convert(
        {
            "database_url": os.environ["DATABASE_URL"],
            "log_level": os.getenv("LOG_LEVEL", "INFO"),
            "http_timeout_seconds": float(os.getenv("HTTP_TIMEOUT_SECONDS", "10")),
            "env": os.getenv("APP_ENV", "dev"),
        },
        Settings,
    )
```

No `pydantic-settings`. msgspec's `convert` provides validation [Source](https://jcristharif.com/msgspec/converters.html).

### 8.2 Route handlers & controllers

- Prefer `Controller` when ≥ 2 handlers share any configuration (see DECIDE-HANDLER).
- Return types must be fully specified: a `Struct`, `list[Struct]`, or `Response[Struct]` [Source](https://docs.litestar.dev/main/usage/routing/handlers.html).
- Dependency injection is done through `dependencies={"name": Provide(factory)}` at app/router/controller/handler layer [Source](https://docs.litestar.dev/2/usage/dependency-injection.html). Never use `Depends(...)` in a signature default — that is FastAPI (ANTI-002).

### 8.3 Dependency Injection

- **RULE-DI-001:** Litestar dependency injection uses `dependencies={"name": Provide(factory)}` at the smallest enclosing scope (app/router/controller/handler); async by default, sync requires explicit `sync_to_thread=False|True`; never `Depends()` (FastAPI — see ANTI-002, ANTI-101).
- Async `Provide(fn)` is default. Sync dependencies must pass `sync_to_thread=False|True` explicitly — Litestar warns otherwise [Source](https://docs.litestar.dev/2/usage/dependency-injection.html).
- Scope dependencies to the smallest enclosing layer. DB sessions are handler-scoped (auto-commit/rollback via Advanced-Alchemy `before_send_handler="autocommit"`). HTTP clients are app-scoped.

### 8.4 Database layer

- `Base` inherits `AsyncAttrs, DeclarativeBase`.
- Use `Mapped[T]` + `mapped_column(...)` only [Source](https://docs.sqlalchemy.org/en/20/orm/declarative_tables.html).
- PG-specific types: `from sqlalchemy.dialects.postgresql import JSONB, ARRAY, UUID as PG_UUID`. For UUID PKs prefer the dialect-agnostic `Uuid` type or the PG `UUID(as_uuid=True)`.
- `type_annotation_map` on `Base` maps `datetime → DateTime(timezone=True)`.

### 8.5 Migrations (Alembic)

- Init with `uv run alembic init -t async migrations` (async env template) [Source](https://alembic.sqlalchemy.org/en/latest/cookbook.html).
- Set `target_metadata = Base.metadata` and import all models under `migrations/env.py` so autogenerate sees them.
- DDL safety: add/drop columns with NULL; backfill in a separate migration; index concurrently when large (`op.create_index(..., postgresql_concurrently=True)` in an `op.execute` that disables the migration's transaction per-file).
- Do **not** use `batch_alter_table` on PostgreSQL — it is a SQLite limitation workaround.

### 8.6 Outbound HTTP

- One `AsyncClient` per external service, created in `lifespan`, injected via DI.
- Always pass `httpx.Timeout(connect=…, read=…, write=…, pool=…)` and `httpx.Limits(max_connections=…, max_keepalive_connections=…)` [Source](https://www.python-httpx.org/advanced/resource-limits/).
- Retries: `httpx.AsyncHTTPTransport(retries=N)` retries only on `ConnectError`/`ConnectTimeout` [Source](https://www.python-httpx.org/advanced/transports/). For 5xx / `Retry-After`, wrap calls in `tenacity` — do not hand-roll.
- HTTP/2: pass `http2=True` and install `httpx[http2]` if the upstream supports it.
- Tests: swap the real client for `httpx.AsyncClient(transport=httpx.MockTransport(handler))` [Source](https://www.python-httpx.org/advanced/transports/).

### 8.7 Logging

- Configure structlog once at app startup (see RECIPE-STRUCTLOG).
- Bind request-scoped context (request_id, user_id) via `structlog.contextvars.bind_contextvars` in middleware [Source](https://www.structlog.org/en/stable/contextvars.html).
- Render exceptions with `structlog.processors.format_exc_info` + `dict_tracebacks` (for machine-parsable JSON tracebacks).

### 8.8 Testing

- `AsyncTestClient` for all async tests.
- Per-worker DB with `PYTEST_XDIST_WORKER`.
- Transaction-per-test rollback pattern for fast isolation.

## 9. Cross-Cutting Architecture

### 9.1 Lifespan

The app's single `lifespan` async context manager owns: DB engine, httpx clients, background tasks. On shutdown, Litestar calls context managers in reverse order, then `on_shutdown` hooks [Source](https://docs.litestar.dev/main/usage/applications.html). Use `lifespan=[...]`, not the deprecated `on_startup`/`on_shutdown` pair, for anything that owns resources.

### 9.2 Correlation IDs

Use `asgi-correlation-id` or a minimal custom ASGI middleware to read `X-Request-ID` (or generate a UUIDv7), then:

```python
# src/my_service/plugins/logging.py (excerpt)
from structlog.contextvars import bind_contextvars, clear_contextvars
# inside middleware:
clear_contextvars()
bind_contextvars(request_id=request_id)
```

`structlog.contextvars.merge_contextvars` must be the first processor so the bound vars land in every log event [Source](https://www.structlog.org/en/stable/contextvars.html).

### 9.3 Error handling

- Raise `litestar.exceptions.HTTPException` subclasses (`NotFoundException`, `PermissionDeniedException`, `ValidationException`) for 4xx.
- Business errors subclass a project `AppError` and are translated by a single `exception_handlers={AppError: handle_app_error}` entry on the `Litestar(...)`.
- Responses follow RFC 9457 (Problem Details) — Litestar 2 supports this natively [Source](https://github.com/litestar-org/litestar).

**RULE-API-002** — All HTTP error responses MUST conform to RFC 9457 problem-details: `Content-Type: application/problem+json`; required members `type`, `title`, `status`, `detail`, `instance`; extensions allowed (Comradarr adds `errors[]` for validation, `context` for domain data, `retryable` boolean for connector classification). RFC 7807 is the obsoleted predecessor (superseded July 2023); do not cite RFC 7807 in new code, schemas, OpenAPI documentation, or commit messages. The on-the-wire shape is identical to 7807 — the change is the citation, not the bytes [Source](https://datatracker.ietf.org/doc/html/rfc9457).

**ANTI-API-002** — Citing RFC 7807 in new code, error-class docstrings, OpenAPI `description` fields, or response schemas. Replace with RFC 9457. Pre-existing wording in third-party docs the project does not own (e.g. upstream Litestar source) is fine; project-owned text is not.

## 10. Canonical Patterns

### PATTERN-APP — Application entrypoint

```python
# src/my_service/main.py
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from litestar import Litestar
from litestar.plugins.structlog import StructlogPlugin, StructlogConfig
from advanced_alchemy.extensions.litestar import (
    AsyncSessionConfig,
    SQLAlchemyAsyncConfig,
    SQLAlchemyPlugin,
)
import httpx

from my_service.config import load_settings
from my_service.domain.users.controllers import UserController
from my_service.plugins.http import http_client_lifespan
from my_service.plugins.logging import build_structlog_config

settings = load_settings()

alchemy = SQLAlchemyPlugin(
    config=SQLAlchemyAsyncConfig(
        connection_string=settings.database_url,
        session_config=AsyncSessionConfig(expire_on_commit=False),
        before_send_handler="autocommit",
        create_all=False,
    ),
)

@asynccontextmanager
async def lifespan(app: Litestar) -> AsyncIterator[None]:
    async with http_client_lifespan(app, timeout=settings.http_timeout_seconds):
        yield

app = Litestar(
    route_handlers=[UserController],
    plugins=[alchemy, StructlogPlugin(config=build_structlog_config(settings))],
    lifespan=[lifespan],
    debug=settings.env == "dev",
)
```

Notes:
- `before_send_handler="autocommit"` commits on 2xx responses and rolls back on 4xx/5xx [Source](https://docs.advanced-alchemy.litestar.dev/latest/usage/frameworks/litestar.html).
- `expire_on_commit=False` is mandatory under async [Source](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html).

### PATTERN-HANDLER — Function handler

```python
# src/my_service/domain/health/handlers.py
from litestar import get
from litestar.status_codes import HTTP_200_OK

@get("/health", status_code=HTTP_200_OK, sync_to_thread=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

### PATTERN-CONTROLLER — Class-based controller

```python
# src/my_service/domain/users/controllers.py
from uuid import UUID
from litestar import Controller, get, post
from sqlalchemy.ext.asyncio import AsyncSession

from my_service.domain.users.schemas import UserCreate, UserRead
from my_service.domain.users.services import UserService

class UserController(Controller):
    path = "/api/v1/users"
    tags = ["users"]

    @post()
    async def create(self, data: UserCreate, db_session: AsyncSession) -> UserRead:
        return await UserService(db_session).create(data)

    @get("/{user_id:uuid}")
    async def get_one(self, user_id: UUID, db_session: AsyncSession) -> UserRead:
        return await UserService(db_session).get(user_id)
```

`db_session` is injected by the SQLAlchemy plugin; the handler path param uses Litestar's `uuid` path type [Source](https://docs.litestar.dev/2/usage/routing/overview.html).

### PATTERN-DI — Dependencies

```python
# src/my_service/plugins/http.py
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import httpx
from litestar import Litestar
from litestar.di import Provide

@asynccontextmanager
async def http_client_lifespan(app: Litestar, *, timeout: float) -> AsyncIterator[None]:
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(timeout),
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        http2=True,
    ) as client:
        app.state.http_client = client
        yield

async def provide_http_client(state) -> httpx.AsyncClient:  # state: litestar State
    return state.http_client

# then in main.py:
# dependencies={"http_client": Provide(provide_http_client)}
```

### PATTERN-SESSION — DB engine & sessionmaker

```python
# src/my_service/db/engine.py
from sqlalchemy.ext.asyncio import (
    AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine,
)

def build_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(
        database_url,
        pool_size=20,
        max_overflow=0,
        pool_pre_ping=True,
    )

def build_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
```

### PATTERN-MODEL — Declarative model

```python
# src/my_service/db/base.py
from datetime import UTC, datetime
from uuid import UUID, uuid7
from sqlalchemy import DateTime
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

class Base(AsyncAttrs, DeclarativeBase):
    type_annotation_map = {datetime: DateTime(timezone=True)}

# src/my_service/db/models/user.py
from my_service.db.base import Base
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB

class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid7)
    email: Mapped[str] = mapped_column(unique=True, index=True)
    display_name: Mapped[str]
    metadata_: Mapped[dict[str, str]] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
```

`AsyncAttrs` enables `await user.awaitable_attrs.rel` where selecting eagerly would be wasteful [Source](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html).

### PATTERN-QUERY — 2.0-style queries

```python
# src/my_service/domain/users/repositories.py
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from my_service.db.models.user import User

class UserRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, user_id: UUID) -> User | None:
        stmt = select(User).where(User.id == user_id).options(selectinload(User.roles))
        return await self.session.scalar(stmt)

    async def list_active(self, limit: int) -> list[User]:
        stmt = select(User).where(User.is_active.is_(True)).limit(limit)
        result = await self.session.scalars(stmt)
        return list(result.all())
```

Result API: `scalars()` returns `ScalarResult` — then `.all()`, `.one()`, `.one_or_none()`; `scalar_one_or_none()` combines those on `Result` [Source](https://docs.sqlalchemy.org/en/20/tutorial/data_select.html).

### PATTERN-HTTPX-CLIENT — Outbound call with retry

```python
# src/my_service/domain/billing/gateway.py
import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from my_service.domain.billing.schemas import Charge, ChargeResult

class BillingGateway:
    def __init__(self, client: httpx.AsyncClient, base_url: str) -> None:
        self._client = client
        self._base_url = base_url

    @retry(
        retry=retry_if_exception_type((httpx.TimeoutException, httpx.TransportError)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=0.2, max=2.0),
        reraise=True,
    )
    async def charge(self, charge: Charge) -> ChargeResult:
        import msgspec
        r = await self._client.post(
            f"{self._base_url}/charges",
            content=msgspec.json.encode(charge),
            headers={"content-type": "application/json"},
        )
        r.raise_for_status()
        return msgspec.json.decode(r.content, type=ChargeResult)
```

### PATTERN-STRUCTLOG — Bound logger per module

```python
# src/my_service/domain/users/services.py
import structlog
logger = structlog.stdlib.get_logger(__name__)

async def create(self, data: UserCreate) -> UserRead:
    logger.info("user.create.begin", email=data.email)
    ...
    logger.info("user.create.ok", user_id=str(user.id))
```

### PATTERN-LIFESPAN — Resource ownership

```python
# already shown in PATTERN-APP; rules:
# 1. Resources opened in lifespan are closed by the `async with` on shutdown.
# 2. Order: context managers exit in reverse; on_shutdown hooks fire after [Source: litestar docs].
# 3. Never open DB engines or httpx clients at import time.
```

### PATTERN-ERROR — Domain errors

```python
# src/my_service/errors.py
from litestar.exceptions import HTTPException
from litestar.status_codes import HTTP_404_NOT_FOUND, HTTP_409_CONFLICT

class NotFound(HTTPException):
    status_code = HTTP_404_NOT_FOUND

class Conflict(HTTPException):
    status_code = HTTP_409_CONFLICT
```

## 11. Canonical Recipes

### RECIPE-PROJECT-INIT

```bash
# shell
uv init --lib my_service
cd my_service
uv python pin 3.14
uv add "litestar[standard]>=2.19,<3" "granian>=2.7,<3" "msgspec>=0.20,<0.21" \
       "sqlalchemy[asyncio]>=2.0.46,<2.1" "asyncpg>=0.30" "alembic>=1.18" \
       "httpx[http2]>=0.28,<0.29" "structlog>=25.5" \
       "advanced-alchemy" "tenacity"
uv add --group dev "ruff>=0.15.11" "basedpyright>=1.38" \
                   "pytest>=8.3" "pytest-asyncio>=1.3,<2" "pytest-xdist>=3.8" \
                   "anyio"
```

```toml
# pyproject.toml
[project]
name = "my-service"
version = "0.1.0"
requires-python = ">=3.14"
dependencies = [
  "litestar[standard]>=2.19,<3",
  "granian>=2.7,<3",
  "msgspec>=0.20,<0.21",
  "sqlalchemy[asyncio]>=2.0.46,<2.1",
  "asyncpg>=0.30",
  "alembic>=1.18",
  "httpx[http2]>=0.28,<0.29",
  "structlog>=25.5",
  "advanced-alchemy",
  "tenacity",
]

[dependency-groups]
dev = [
  "ruff>=0.15.11",
  "basedpyright>=1.38",
  "pytest>=8.3",
  "pytest-asyncio>=1.3,<2",
  "pytest-xdist>=3.8",
  "anyio",
]

[build-system]
requires = ["uv_build>=0.11"]
build-backend = "uv_build"

[tool.ruff]
line-length = 100
target-version = "py314"

[tool.ruff.lint]
select = [
  "E", "F", "W",        # pycodestyle / pyflakes
  "I",                   # isort
  "UP",                  # pyupgrade
  "B",                   # flake8-bugbear
  "SIM",                 # simplify
  "C4",                  # comprehensions
  "FA",                  # from __future__ — rejected anyway
  "TC",                  # TYPE_CHECKING hygiene
  "TID",                 # import tidy
  "RET",                 # returns
  "PTH",                 # pathlib
  "ASYNC",               # async pitfalls
  "S",                   # bandit security
  "N",                   # pep8-naming
]
ignore = ["S101"]        # allow assert in tests; tests/* also excluded from S if needed

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101", "S105", "S106"]
"migrations/**" = ["E501"]

[tool.ruff.format]
quote-style = "double"

[tool.basedpyright]
pythonVersion = "3.14"
typeCheckingMode = "recommended"
include = ["src", "tests"]
reportMissingTypeStubs = "warning"
enableTypeIgnoreComments = false        # force pyright: ignore[ruleName]
reportImplicitOverride = "error"

[tool.pytest.ini_options]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
testpaths = ["tests"]
addopts = "-ra --strict-markers --strict-config"
```

uv commands reference [Source](https://docs.astral.sh/uv/concepts/projects/dependencies/):

```bash
uv sync                      # resolve + install from lock
uv sync --frozen             # CI: fail if lock is stale
uv sync --group dev          # include dev group
uv add pkg                   # add runtime dep
uv add --group dev pkg       # add dev dep
uv lock --upgrade            # upgrade lock
uv run pytest                # run in project env
uv run ruff check --fix .
uv run ruff format .
uv run basedpyright
uv run granian --interface asgi my_service.main:app
uv run alembic upgrade head
```

### RECIPE-CRUD — End-to-end vertical slice

```python
# src/my_service/domain/users/schemas.py
from uuid import UUID
from datetime import datetime
import msgspec

class UserCreate(msgspec.Struct, kw_only=True, forbid_unknown_fields=True):
    email: str
    display_name: str

class UserRead(msgspec.Struct, kw_only=True):
    id: UUID
    email: str
    display_name: str
    created_at: datetime
```

```python
# src/my_service/domain/users/services.py
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
import msgspec
import structlog

from my_service.db.models.user import User
from my_service.domain.users.repositories import UserRepo
from my_service.domain.users.schemas import UserCreate, UserRead
from my_service.errors import NotFound

log = structlog.stdlib.get_logger(__name__)

class UserService:
    def __init__(self, session: AsyncSession) -> None:
        self._repo = UserRepo(session)
        self._session = session

    async def create(self, data: UserCreate) -> UserRead:
        user = User(email=data.email, display_name=data.display_name)
        self._session.add(user)
        await self._session.flush()
        log.info("user.created", user_id=str(user.id))
        return msgspec.convert(
            {"id": user.id, "email": user.email, "display_name": user.display_name,
             "created_at": user.created_at},
            UserRead,
        )

    async def get(self, user_id: UUID) -> UserRead:
        user = await self._repo.get(user_id)
        if user is None:
            raise NotFound(detail=f"user {user_id} not found")
        return msgspec.convert(user, UserRead, from_attributes=True)
```

`msgspec.convert(..., from_attributes=True)` reads model attributes, not keys [Source](https://jcristharif.com/msgspec/api.html).

### RECIPE-DB-SESSION — Plugin-driven injection

Using `advanced-alchemy` the `db_session: AsyncSession` parameter in any handler is auto-injected and the before-send handler commits on success / rolls back on exception [Source](https://docs.advanced-alchemy.litestar.dev/latest/usage/frameworks/litestar.html). Do **not** hand-roll `Depends(get_session)`.

If you need a manual pattern without the plugin:

```python
# src/my_service/db/session.py
from collections.abc import AsyncIterator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

def provide_db_session_factory(sm: async_sessionmaker[AsyncSession]):
    async def _provide() -> AsyncIterator[AsyncSession]:
        async with sm() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
    return _provide
```

### RECIPE-ALEMBIC-ASYNC

```bash
uv run alembic init -t async migrations
```

```python
# migrations/env.py
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from my_service.db.base import Base
# IMPORTANT: import every models module so autogenerate sees them
import my_service.db.models  # noqa: F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

import os
config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])

target_metadata = Base.metadata

def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()

async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()

def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())

if context.is_offline_mode():
    raise RuntimeError("Offline mode disabled; set DATABASE_URL and run online")
else:
    run_migrations_online()
```

Workflow:

```bash
uv run alembic revision --autogenerate -m "create users"
uv run alembic upgrade head
uv run alembic downgrade -1
```

Pitfalls [Source](https://alembic.sqlalchemy.org/en/latest/cookbook.html):
- Models must be imported in `env.py` or autogenerate produces empty diffs.
- `connection.run_sync(do_run_migrations)` bridges sync Alembic into the async engine.
- `poolclass=pool.NullPool` is required — migrations must not share the app's pool.
- Never call `op.batch_alter_table` on PG.

### RECIPE-STRUCTLOG — JSON logs + request correlation

```python
# src/my_service/plugins/logging.py
import logging
import sys
import structlog
from structlog.contextvars import merge_contextvars

def configure_logging(level: str = "INFO", *, json: bool = True) -> None:
    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)

    shared_processors: list = [
        merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        timestamper,
    ]

    renderer = (
        structlog.processors.JSONRenderer()
        if json
        else structlog.dev.ConsoleRenderer(colors=True)
    )

    structlog.configure(
        processors=[*shared_processors, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        wrapper_class=structlog.make_filtering_bound_logger(getattr(logging, level)),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared_processors,
        processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta, renderer],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    # Quiet noisy libs
    for noisy in ("sqlalchemy.engine", "uvicorn", "hypercorn", "granian"):
        logging.getLogger(noisy).setLevel("WARNING")
```

ASGI correlation ID middleware (no extra dependency required):

```python
# src/my_service/plugins/correlation.py
from uuid import uuid7
from litestar.types import ASGIApp, Receive, Scope, Send
from structlog.contextvars import bind_contextvars, clear_contextvars

HEADER = b"x-request-id"

def correlation_id_middleware(app: ASGIApp) -> ASGIApp:
    async def inner(scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await app(scope, receive, send); return
        headers = dict(scope.get("headers", []))
        rid = headers.get(HEADER, b"").decode() or str(uuid7())
        clear_contextvars()
        bind_contextvars(request_id=rid)
        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", [])
                message["headers"].append((HEADER, rid.encode()))
            await send(message)
        try:
            await app(scope, receive, send_wrapper)
        finally:
            clear_contextvars()
    return inner
```

Rationale [Source](https://www.structlog.org/en/stable/contextvars.html), [Source](https://gist.github.com/sandipb/7ff119559dc7cf481527e117aea97052).

### RECIPE-GRANIAN-RUN

Dev:
```bash
uv run granian --interface asgi --reload \
  --host 127.0.0.1 --port 8000 --loop uvloop \
  my_service.main:app
```

Production:
```bash
uv run granian \
  --interface asgi \
  --host 0.0.0.0 --port 8000 \
  --workers "$(nproc)" \
  --runtime-threads 1 \
  --loop uvloop \
  --http auto \
  --log --log-access --log-level info \
  --workers-lifetime 10800 \
  --respawn-failed-workers \
  my_service.main:app
```

Notes [Source](https://github.com/emmett-framework/granian):
- `--interface asgi` — Litestar is ASGI. Granian defaults to `rsgi`.
- `--loop uvloop` requires `granian[uvloop]`; add it to deps if you adopt it.
- `--workers` ≈ CPU cores; Litestar is async so `--blocking-threads` is irrelevant for ASGI.
- `--workers-lifetime N` rotates workers every N seconds (memory hygiene).
- `--respawn-failed-workers` auto-replaces crashed workers.
- `--http auto` negotiates HTTP/1 and HTTP/2.
- For SSL: `--ssl-certificate` / `--ssl-keyfile`.
- Free-threaded build: install `cpython3.14t` and Granian's ft wheel; Granian refuses to start if the GIL re-enables [Source](https://pypi.org/project/granian/).

Do **not** port uvicorn flags (`--reload-dir`, `--workers`/`--worker-class`, `--forwarded-allow-ips`, `--proxy-headers`). Use the Granian equivalents above.

### RECIPE-PYTEST-DB — xdist-safe DB isolation with savepoints

```python
# tests/conftest.py
import os
from collections.abc import AsyncIterator
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import (
    AsyncConnection, AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine,
)
from litestar import Litestar
from litestar.testing import AsyncTestClient

from my_service.db.base import Base
from my_service.main import app as real_app

DB_URL_TMPL = os.environ["TEST_DATABASE_URL_TMPL"]  # e.g. postgresql+asyncpg://.../app_{worker}

def _worker_id() -> str:
    return os.getenv("PYTEST_XDIST_WORKER", "master")

@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def engine() -> AsyncIterator[AsyncEngine]:
    url = DB_URL_TMPL.format(worker=_worker_id())
    eng = create_async_engine(url, pool_pre_ping=True)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()

@pytest_asyncio.fixture(loop_scope="session")
async def db_session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    # transactional rollback per test
    async with engine.connect() as conn:
        trans = await conn.begin()
        sm = async_sessionmaker(bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint")
        async with sm() as session:
            try:
                yield session
            finally:
                await trans.rollback()

@pytest_asyncio.fixture(loop_scope="session")
async def app(db_session: AsyncSession) -> Litestar:
    # override the session dependency so handlers use the test-bound session
    real_app.dependencies["db_session"] = lambda: db_session  # pseudocode; use Litestar override API in practice
    return real_app

@pytest_asyncio.fixture(loop_scope="session")
async def client(app: Litestar) -> AsyncIterator[AsyncTestClient]:
    async with AsyncTestClient(app=app) as c:
        yield c
```

Rationale:
- `loop_scope="session"` with `asyncio_default_fixture_loop_scope = "session"` means all fixtures and tests share one event loop [Source](https://pytest-asyncio.readthedocs.io/en/stable/reference/changelog.html).
- Each xdist worker sees `PYTEST_XDIST_WORKER=gw0|gw1|…` and gets its own database [Source](https://pytest-xdist.readthedocs.io/en/stable/how-to.html).
- `AsyncTestClient` calls into the ASGI app directly without starting a server [Source](https://docs.litestar.dev/main/usage/testing.html).

HTTP mocking in tests:

```python
import httpx
def make_mock_client() -> httpx.AsyncClient:
    async def handler(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/charges":
            return httpx.Response(200, json={"id": "x", "status": "ok"})
        return httpx.Response(404)
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))
```

## 12. Full Anti-Pattern Ledger

Every item below is **Reject**. If the user asks for one, refuse and redirect to the cited section.

| ID | Anti-pattern | Why it's wrong here | Correct |
|---|---|---|---|
| ANTI-100 | `from fastapi import FastAPI` | Not in stack | Litestar (§8.2) |
| ANTI-101 | `def handler(x: int = Depends(get_x))` | FastAPI DI | `dependencies={"x": Provide(get_x)}` (PATTERN-DI) |
| ANTI-102 | `@app.get("/x", response_model=Foo)` | FastAPI; Litestar infers from annotation | `@get("/x") async def h() -> Foo:` |
| ANTI-103 | `from pydantic import BaseModel` | Out of stack | `msgspec.Struct` (RULE-SER-001) |
| ANTI-104 | `from flask import Flask` / `from django…` | Out of stack | Litestar |
| ANTI-105 | `uvicorn.run(app, host=…, workers=4)` | Wrong server | `granian --interface asgi …` (RECIPE-GRANIAN-RUN) |
| ANTI-106 | `uvicorn --reload-dir …` | Uvicorn flag | `granian --reload` |
| ANTI-107 | `sync_engine = create_engine(...)` + `Session()` | Sync ORM | `create_async_engine` + `AsyncSession` (RULE-DB-001) |
| ANTI-108 | `session.query(User).filter_by(id=…)` | SA 1.x API | `session.scalar(select(User).where(User.id == …))` (RULE-DB-003) |
| ANTI-109 | `postgresql://…` / `postgresql+psycopg2://…` | Wrong driver | `postgresql+asyncpg://…` (RULE-DB-002) |
| ANTI-110 | `Column(Integer, primary_key=True)` on new code | SA 1.x style | `mapped_column(...)` with `Mapped[...]` (PATTERN-MODEL) |
| ANTI-111 | `relationship(..., lazy="select")` accessed post-commit | Breaks under async | `selectinload` / `AsyncAttrs` (RULE-DB-004) |
| ANTI-112 | `expire_on_commit=True` on async session | Breaks attribute access after commit [Source](https://github.com/sqlalchemy/sqlalchemy/discussions/11495) | `expire_on_commit=False` |
| ANTI-113 | `import requests; requests.get(...)` | Sync, blocking, no pool | `httpx.AsyncClient` (RULE-HTTP-001) |
| ANTI-114 | `httpx.AsyncClient()` created inside a handler | No pooling, no HTTP/2 benefit | App-scoped client via DI |
| ANTI-115 | `AsyncClient(timeout=None)` without justification | Unbounded hang | Explicit `httpx.Timeout(...)` |
| ANTI-116 | `AsyncClient.retries = n` | Not an API | `AsyncHTTPTransport(retries=n)` + tenacity for 5xx |
| ANTI-117 | `logging.basicConfig(...); logger.info(f"x={x}")` | Unstructured | structlog with kv (RULE-LOG-001) |
| ANTI-118 | `print(...)` for diagnostics | Unstructured | structlog |
| ANTI-119 | `pip install …`, `poetry add …`, `pipenv install …` | Not in stack | `uv add …` (RULE-TOOL-001) |
| ANTI-120 | `requirements.txt` as source of truth | Not locked properly | `uv.lock` |
| ANTI-121 | `[tool.black]`, `[tool.isort]`, `[tool.flake8]` | Replaced by ruff | `[tool.ruff]` (RULE-TOOL-002) |
| ANTI-122 | `[tool.mypy]` config | Not used | `[tool.basedpyright]` (RULE-TOOL-003) |
| ANTI-123 | `# type: ignore` bare | `enableTypeIgnoreComments = false` | `# pyright: ignore[ruleName]` |
| ANTI-124 | `from __future__ import annotations` on 3.14 | Interacts poorly with PEP 649 | Delete |
| ANTI-125 | `IsolatedAsyncioTestCase` | stdlib unittest | pytest + pytest-asyncio (RULE-TEST-001) |
| ANTI-126 | `@pytest.fixture` on `async def` in strict mode | Deprecated | `@pytest_asyncio.fixture` |
| ANTI-127 | Custom `event_loop` fixture | Removed in pytest-asyncio 1.0 | `loop_scope="session"` |
| ANTI-128 | `op.batch_alter_table(...)` on PG migration | SQLite-only workaround | Plain `op.alter_column` |
| ANTI-129 | `engine_from_config(...)` in async Alembic env | Sync factory | `async_engine_from_config(...)` |
| ANTI-130 | Committing `uv.lock` omissions | Breaks CI reproducibility | Commit `uv.lock` |
| ANTI-131 | Secrets in `pyproject.toml` / repo | Leakage | Environment variables |
| ANTI-132 | `pytz` timezone usage | Obsolete | stdlib `datetime.UTC` + `zoneinfo` |
| ANTI-133 | `datetime.utcnow()` | Naive datetime | `datetime.now(UTC)` |
| ANTI-134 | Using `requests.Session` across asyncio | Blocking | `httpx.AsyncClient` |
| ANTI-135 | Running migrations in process startup | Race across instances | Separate `alembic upgrade head` step |
| ANTI-136 | `LISTEN/NOTIFY` on pooled connections | Listener is dropped on release by asyncpg [Source](https://magicstack.github.io/asyncpg/current/api/index.html) | Dedicated long-lived connection outside the pool |
| ANTI-137 | Advisory locks on pooled connections without release | `pg_advisory_unlock_all()` runs on release | Use session-scoped locks on a dedicated connection, or transaction-scoped `pg_advisory_xact_lock` |
| ANTI-138 | `msgspec.Struct` with `Any` fields | basedpyright rejects + defeats validation | Typed fields; use tagged unions for variant data |
| ANTI-139 | `msgspec.json.decode(bytes, type=...)` re-instantiating `Decoder` per call in hot paths | Slower | Module-level `msgspec.json.Decoder(Type)` [Source](https://jcristharif.com/msgspec/structs.html) |
| ANTI-140 | Returning a SQLAlchemy ORM object directly as Litestar response body | Serialization ambiguity; lazy-load risk | Return a `msgspec.Struct` built via `msgspec.convert(orm, Schema, from_attributes=True)` |

## 13. Testing, Verification & Tooling

### 13.1 Commands (single source of truth)

```bash
# format / lint
uv run ruff format .
uv run ruff check --fix .

# types
uv run basedpyright

# tests
uv run pytest -q
uv run pytest -q -n auto          # xdist parallel
uv run pytest -q -k users         # subset
uv run pytest --lf                # last failed

# migrations
uv run alembic revision --autogenerate -m "msg"
uv run alembic upgrade head
uv run alembic downgrade -1

# run app
uv run granian --interface asgi --reload my_service.main:app

# full gate (what CI runs)
uv sync --frozen
uv run ruff format --check .
uv run ruff check .
uv run basedpyright
uv run pytest -q -n auto
```

### 13.2 VERIFY checks

- **VERIFY-LOCK** — `uv.lock` exists and `uv sync --frozen` succeeds.
- **VERIFY-TYPES** — `uv run basedpyright` exits 0 with zero errors; warnings allowed only if baselined.
- **VERIFY-LINT** — `uv run ruff check .` exits 0.
- **VERIFY-FORMAT** — `uv run ruff format --check .` exits 0.
- **VERIFY-TESTS** — `uv run pytest -n auto` exits 0; coverage gating optional but if added use `pytest-cov`, not `coverage run`.
- **VERIFY-MIGRATIONS** — `uv run alembic upgrade head` on an empty DB, then `alembic downgrade base` round-trip clean.
- **VERIFY-BOOT** — `uv run granian --interface asgi my_service.main:app &` then `curl /health` returns 200 within 3 s.

### 13.3 pytest-asyncio details

- Mode: `asyncio_mode = "auto"` — every `async def test_*` is treated as `@pytest.mark.asyncio` [Source](https://pytest-asyncio.readthedocs.io/en/stable/concepts.html).
- `asyncio_default_fixture_loop_scope = "session"` aligns fixtures with tests so DB engine + session share one loop [Source](https://github.com/pytest-dev/pytest-asyncio/issues/934).
- The `event_loop` fixture was removed in pytest-asyncio 1.0 [Source](https://thinhdanggroup.github.io/pytest-asyncio-v1-migrate/). Do not define one.
- Use `loop_scope="session"` (event loop sharing) distinct from `scope="session"` (fixture caching) [Source](https://github.com/pytest-dev/pytest-asyncio/discussions/1171).

### 13.4 basedpyright details

- `typeCheckingMode = "recommended"` is the default in the basedpyright CLI but editors (notably Zed) default to `"standard"` [Source](https://zed.dev/docs/languages/python); the `pyproject.toml` value wins and is authoritative.
- `recommended` enables `reportAny`, `reportExplicitAny`, `reportMissingTypeStubs`, `reportUnknownArgumentType`, and tighter defaults than pyright's `strict` [Source](https://docs.basedpyright.com/latest/benefits-over-pyright/new-diagnostic-rules/).
- `enableTypeIgnoreComments = false` — force `# pyright: ignore[ruleName]` with explicit rule codes.
- Pin basedpyright exactly in `uv.lock` so editor and CI agree [Source](https://pypi.org/project/basedpyright/1.1.0/).

### 13.5 ruff details

- One config under `[tool.ruff]` + `[tool.ruff.lint]` + `[tool.ruff.format]`. No `[tool.black]`/`[tool.isort]` [Source](https://docs.astral.sh/ruff/configuration/).
- `target-version = "py314"` so `UP` (pyupgrade) and `FA` rules target 3.14.
- `ruff format` replaces black; `I` rule replaces isort; `F` replaces pyflakes; `E/W` replace pycodestyle [Source](https://github.com/astral-sh/ruff).

## 14. Migration & Upgrade Notes

### 14.1 Upgrading an existing Python 3.12/3.13 codebase to this stack

1. `uv python pin 3.14` and update CI images.
2. Remove every `from __future__ import annotations`. Re-run tests — Litestar signature resolution may surface previously-hidden forward-ref issues.
3. Replace `datetime.utcnow()` with `datetime.now(UTC)` (utcnow is deprecated).
4. Replace Pydantic models with `msgspec.Struct`. For models used with ORM attrs, use `msgspec.convert(orm_obj, Schema, from_attributes=True)` [Source](https://jcristharif.com/msgspec/api.html).
5. Replace `requests` with `httpx.AsyncClient`; move client construction to `lifespan`.
6. Replace sync SQLAlchemy (`Session`, `session.query`) with `AsyncSession` + 2.0 `select()`.
7. Replace psycopg2 URL with `postgresql+asyncpg`. Verify type codecs (UUID, JSONB) — SQLAlchemy handles these automatically.
8. Replace `uvicorn ...` runtime with `granian --interface asgi ...`.
9. Replace `pip` / `poetry` / `pipenv` workflow with `uv add` / `uv sync` / `uv.lock`.
10. Replace `black`/`isort`/`flake8`/`mypy` config with `[tool.ruff]` + `[tool.basedpyright]`.
11. Replace `@pytest.fixture` on async fixtures with `@pytest_asyncio.fixture`; remove custom `event_loop` fixtures.

### 14.2 Alembic: upgrading from a sync env to async

Follow the cookbook's `pyproject_async` template [Source](https://alembic.sqlalchemy.org/en/latest/cookbook.html). Replace `engine_from_config` with `async_engine_from_config`, wrap the config function in `connection.run_sync(do_run_migrations)`, drive via `asyncio.run(...)`.

### 14.3 Litestar 2.x minor-version upgrades

- 2.15+: `litestar.contrib.sqlalchemy` is deprecated — import from `advanced_alchemy.extensions.litestar` [Source](https://github.com/litestar-org/litestar/releases).
- 2.16+: `AsyncTestClient` was re-implemented to be async-native (runs on the current loop) [Source](https://github.com/litestar-org/litestar/blob/main/docs/release-notes/changelog.rst); no code change needed but be aware if you previously relied on a separate thread+loop.
- 2.19: OpenTelemetry `after_exception`/`exclude_spans` options added [Source](https://docs.litestar.dev/2/release-notes/changelog.html).

### 14.4 Litestar 3.x

Pre-release as of 2026-04-24. **Reject** for new production code. Noteworthy upcoming changes to be aware of for forward-compatible code [Source](https://docs.litestar.dev/3-dev/release-notes/whats-new-3.html):
- Handlers typed `Optional[X]` will no longer get an implicit default of `None`; add `= None` explicitly.
- `StaticFilesConfig` replaced by `create_static_files_router()`.

### 14.5 pytest-asyncio 0.21 → 1.x

- Remove any `event_loop` fixture override.
- Set `asyncio_default_fixture_loop_scope = "session"` (or `module`) in `pyproject.toml` or annotate each fixture with `loop_scope=...` [Source](https://pytest-asyncio.readthedocs.io/en/stable/reference/changelog.html).
- Remove legacy mode configuration.

### 14.6 Free-threaded Python (PEP 779/703)

Officially supported in 3.14 but still **optional** [Source](https://docs.python.org/3.14/whatsnew/3.14.html). Single-threaded performance penalty is ~5–10%. Adopt only after:
1. All C-extension deps in `uv.lock` have `cp314t` wheels.
2. You have a measurable, GIL-bound bottleneck (rare for async-IO-bound services).
3. You benchmark with your real workload. Granian 2.0+ supports free-threaded builds but switches workers to threads rather than processes [Source](https://pypi.org/project/granian/).

## 15. Source Ledger

- **SOURCE-PY-314** — What's new in Python 3.14 (PEPs 649, 750, 779, 734, 784, 758, 765, 768). [Source](https://docs.python.org/3.14/whatsnew/3.14.html)
- **SOURCE-PY-RELEASE** — Python 3.14 release, 3.14.1, 3.14.3 pages. [Source](https://www.python.org/downloads/release/python-3143/)
- **SOURCE-LS-PYPI** — Litestar PyPI (2.19 released 2026-03-07). [Source](https://pypi.org/project/litestar/)
- **SOURCE-LS-CHG** — Litestar 2 changelog. [Source](https://docs.litestar.dev/2/release-notes/changelog.html)
- **SOURCE-LS-3** — Litestar 3.x changelog & what's-new-3. [Source](https://docs.litestar.dev/3-dev/release-notes/whats-new-3.html)
- **SOURCE-LS-DI** — Litestar dependency injection. [Source](https://docs.litestar.dev/2/usage/dependency-injection.html)
- **SOURCE-LS-TEST** — Litestar testing (TestClient / AsyncTestClient). [Source](https://docs.litestar.dev/main/usage/testing.html)
- **SOURCE-LS-APP** — Litestar applications / lifespan. [Source](https://docs.litestar.dev/main/usage/applications.html)
- **SOURCE-LS-DTO** — Litestar MsgspecDTO. [Source](https://docs.litestar.dev/2/reference/dto/msgspec_dto.html)
- **SOURCE-AA** — Advanced Alchemy Litestar integration. [Source](https://docs.advanced-alchemy.litestar.dev/latest/usage/frameworks/litestar.html)
- **SOURCE-GR-PYPI** — Granian PyPI (2.7.4, 2026-04-23). [Source](https://pypi.org/project/granian/)
- **SOURCE-GR-GH** — Granian GitHub (CLI flags, RSGI spec, free-threaded). [Source](https://github.com/emmett-framework/granian)
- **SOURCE-GR-CLI** — Granian CLI & config reference. [Source](https://deepwiki.com/emmett-framework/granian/3-server-and-cli)
- **SOURCE-MS-PYPI** — msgspec PyPI (0.20.0, 2025-11-24). [Source](https://pypi.org/project/msgspec/)
- **SOURCE-MS-DOCS** — msgspec docs (Structs, converters, API). [Source](https://jcristharif.com/msgspec/structs.html) / [Source](https://jcristharif.com/msgspec/converters.html) / [Source](https://jcristharif.com/msgspec/api.html)
- **SOURCE-SA20** — SQLAlchemy 2.0 asyncio docs. [Source](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- **SOURCE-SA20-REL** — SQLAlchemy 2.0.46, released 2026-01-21. [Source](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)
- **SOURCE-SA20-DECL** — Declarative w/ `mapped_column`. [Source](https://docs.sqlalchemy.org/en/20/orm/declarative_tables.html)
- **SOURCE-SA20-SELECT** — 2.0 select / scalars. [Source](https://docs.sqlalchemy.org/en/20/tutorial/data_select.html)
- **SOURCE-ASYNCPG** — asyncpg API (pool reset: advisory unlock / UNLISTEN). [Source](https://magicstack.github.io/asyncpg/current/api/index.html)
- **SOURCE-PG-TIME** — PostgreSQL 18 date/time docs (timestamptz = UTC). [Source](https://www.postgresql.org/docs/current/datatype-datetime.html)
- **SOURCE-ALEMBIC** — Alembic cookbook (async template). [Source](https://alembic.sqlalchemy.org/en/latest/cookbook.html)
- **SOURCE-ALEMBIC-ENV** — Alembic async env template on GitHub. [Source](https://github.com/sqlalchemy/alembic/blob/main/alembic/templates/async/env.py)
- **SOURCE-HX-TIMEOUTS** — httpx timeouts (5 s default). [Source](https://www.python-httpx.org/advanced/timeouts/)
- **SOURCE-HX-TRANSPORT** — httpx transports (retries on Connect*). [Source](https://www.python-httpx.org/advanced/transports/)
- **SOURCE-HX-LIMITS** — httpx Limits. [Source](https://www.python-httpx.org/advanced/resource-limits/)
- **SOURCE-SL-API** — structlog API reference (25.5.x). [Source](https://www.structlog.org/en/stable/api.html)
- **SOURCE-SL-CTX** — structlog contextvars. [Source](https://www.structlog.org/en/stable/contextvars.html)
- **SOURCE-SL-BOUND** — `make_filtering_bound_logger` / ProcessorFormatter. [Source](https://www.structlog.org/en/stable/bound-loggers.html)
- **SOURCE-UV-PYPI** — uv PyPI (0.11.7, 2026-04-15). [Source](https://pypi.org/project/uv/)
- **SOURCE-UV-DOCS** — uv dependency management. [Source](https://docs.astral.sh/uv/concepts/projects/dependencies/)
- **SOURCE-RUFF-PYPI** — ruff PyPI (0.15.11, 2026-04-16). [Source](https://pypi.org/project/ruff/)
- **SOURCE-RUFF-CFG** — ruff configuration. [Source](https://docs.astral.sh/ruff/configuration/)
- **SOURCE-BP-PYPI** — basedpyright releases (1.38.x). [Source](https://pypi.org/project/basedpyright/1.1.0/)
- **SOURCE-BP-CFG** — basedpyright config files (typeCheckingMode, reportAny, reportExplicitAny). [Source](https://docs.basedpyright.com/latest/configuration/config-files/)
- **SOURCE-BP-RULES** — basedpyright new diagnostic rules. [Source](https://docs.basedpyright.com/latest/benefits-over-pyright/new-diagnostic-rules/)
- **SOURCE-PA-CHG** — pytest-asyncio 1.x changelog. [Source](https://pytest-asyncio.readthedocs.io/en/stable/reference/changelog.html)
- **SOURCE-PA-CONCEPT** — pytest-asyncio concepts (modes, loop scopes). [Source](https://pytest-asyncio.readthedocs.io/en/stable/concepts.html)
- **SOURCE-PX** — pytest-xdist worker_id / PYTEST_XDIST_WORKER. [Source](https://pytest-xdist.readthedocs.io/en/stable/how-to.html)

## 16. Quick Reference

```text
# Build
uv init --lib my_service
uv python pin 3.14
uv add "litestar[standard]>=2.19,<3" "granian>=2.7,<3" "msgspec>=0.20,<0.21" \
       "sqlalchemy[asyncio]>=2.0.46,<2.1" "asyncpg>=0.30" "alembic>=1.18" \
       "httpx[http2]>=0.28,<0.29" "structlog>=25.5" "advanced-alchemy" "tenacity"
uv add --group dev ruff basedpyright pytest "pytest-asyncio>=1.3,<2" pytest-xdist anyio

# Gate
uv sync --frozen
uv run ruff format --check .
uv run ruff check .
uv run basedpyright
uv run pytest -n auto

# Run
uv run granian --interface asgi --reload my_service.main:app                # dev
uv run granian --interface asgi --workers $(nproc) --loop uvloop \
  --http auto --respawn-failed-workers my_service.main:app                  # prod

# Migrate
uv run alembic revision --autogenerate -m "msg"
uv run alembic upgrade head
```

Imports cheat-sheet (copy verbatim):

```python
from litestar import Litestar, Controller, Router, get, post, put, delete, patch
from litestar.di import Provide
from litestar.exceptions import HTTPException, NotFoundException, ValidationException
from litestar.testing import AsyncTestClient, TestClient

import msgspec
from msgspec import Struct, Meta

from sqlalchemy import select, update, delete as sa_delete, func
from sqlalchemy.ext.asyncio import (
    AsyncAttrs, AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, selectinload, joinedload
from sqlalchemy.dialects.postgresql import JSONB, ARRAY

import httpx
from httpx import AsyncClient, AsyncHTTPTransport, Limits, MockTransport, Timeout

import structlog
```

Forbidden imports (refuse on sight):

```python
# from fastapi import …
# from pydantic import BaseModel
# from flask import …
# from django.* import …
# import requests
# from sqlalchemy.orm import Session, sessionmaker    # sync
# import psycopg2 / import psycopg
# import uvicorn
# from __future__ import annotations                  # on 3.14
```

— *End of Guidelines.*