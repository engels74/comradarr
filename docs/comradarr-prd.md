# Comradarr — Product Requirements Document

## Backend Architecture & System Design

**Version:** 1.0.0-draft
**Status:** Pre-implementation Design
**License:** AGPL-3.0

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [System Overview](#3-system-overview)
4. [Technology Stack](#4-technology-stack)
5. [Monorepo Structure](#5-monorepo-structure)
6. [Backend Architecture](#6-backend-architecture)
7. [Connector System](#7-connector-system)
8. [Data Model & Storage Strategy](#8-data-model--storage-strategy)
9. [Sync Engine](#9-sync-engine)
10. [Rotation Engine](#10-rotation-engine)
11. [Budget & Rate Limiting System](#11-budget--rate-limiting-system)
12. [Prowlarr Integration](#12-prowlarr-integration)
13. [Event System & Real-Time Communication](#13-event-system--real-time-communication)
14. [Notification System](#14-notification-system)
15. [Authentication & Security](#15-authentication--security)
16. [HTTP Boundary Hardening](#16-http-boundary-hardening)
17. [API Design Philosophy](#17-api-design-philosophy)
18. [Application Wiring & Lifecycle](#18-application-wiring--lifecycle)
19. [Configuration & Environment](#19-configuration--environment)
20. [Logging & Observability](#20-logging--observability)
21. [Error Handling Strategy](#21-error-handling-strategy)
22. [Testing Strategy](#22-testing-strategy)
23. [Supply Chain & Code Discipline](#23-supply-chain--code-discipline)
24. [Deployment Architecture](#24-deployment-architecture)
25. [Frontend Integration Contract](#25-frontend-integration-contract)
26. [Roles and Permissions](#26-roles-and-permissions)
27. [Backup, Recovery, and Upgrades](#27-backup-recovery-and-upgrades)
28. [Internationalization and Accessibility](#28-internationalization-and-accessibility)
29. [Telemetry and Metrics](#29-telemetry-and-metrics)
30. [Import and Export](#30-import-and-export)
31. [Appendix A: Full Backend Directory Structure](#appendix-a-full-backend-directory-structure)
32. [Appendix B: Database Schema Overview](#appendix-b-database-schema-overview)
33. [Appendix C: Glossary](#appendix-c-glossary)

---

## 1. Executive Summary

Comradarr is a media library completion service that integrates with Sonarr and Radarr to continuously search for missing and upgradeable content across a user's entire library. Unlike the built-in search capabilities of Sonarr and Radarr — which search once and stop — Comradarr implements a perpetual rotation engine that cycles through every item in the library, searching for better releases indefinitely.

The system is designed to handle extremely large libraries (500,000+ episodes, tens of thousands of movies) without performance degradation, operating within the rate limits of indexers while maximizing coverage per search command.

Comradarr is deployed as a self-hosted Docker container alongside existing *arr application stacks. It is a single-instance application — one installation manages all connected Sonarr and Radarr instances.

---

## 2. Problem Statement

Sonarr and Radarr are excellent at managing media libraries, but they have a fundamental limitation: once content is downloaded, they stop searching for upgrades. If a user wants higher quality releases, they must manually trigger searches. For large libraries with hundreds of thousands of items, manual intervention is impractical.

Additionally, files can go missing from disk due to hardware failures, filesystem corruption, or accidental deletion. Neither Sonarr nor Radarr continuously monitors for and recovers from these situations — they only detect missing files during manual rescans.

Comradarr solves both problems by treating the entire library as a continuous search rotation. Every item — every movie, every episode, regardless of whether it has a file or not — is perpetually cycled through search commands. Missing items are prioritized, but items with existing files are also searched to find upgrades. The system never stops looking.

The core engineering challenge is efficiency: with 500,000 items and limited indexer budgets (typically 50–1,000 queries per day), the system must maximize the number of items covered per search command, spread the budget evenly across time, and respect the rate limits of every indexer in the chain.

---

## 3. System Overview

Comradarr consists of a Python backend and a SvelteKit frontend, structured as a monorepo. The backend is the sole source of truth for all business logic, background processing, and data management. The frontend is a thin presentation layer that consumes the backend's API.

The backend has five major subsystems:

**Connector System** — HTTP clients that communicate with Sonarr, Radarr, and optionally Prowlarr. Each connector handles authentication, request/response serialization, retries, and error normalization. The connector system abstracts away API differences so the rest of the application works with unified domain types.

**Sync Engine** — Periodically fetches the state of all content from connected Sonarr and Radarr instances and maintains a local mirror in PostgreSQL. The sync engine uses a three-tier strategy (incremental, deep incremental, and full) to minimize API calls while ensuring the mirror stays accurate. The mirror is the foundation everything else depends on.

**Rotation Engine** — The core of Comradarr. It continuously selects the "stalest" items from the library (those searched longest ago), groups them into optimally batched search commands, dispatches those commands to the appropriate *arr application, and tracks their completion. Every item in the library participates in the rotation — there is no concept of "done."

**Budget System** — Controls how fast the rotation engine operates. Without Prowlarr, it uses conservative configurable defaults. With Prowlarr connected, it reads actual indexer rate limits and current usage to dynamically compute how many search commands can be safely sent per time window. The budget system is the safety valve that prevents indexer bans.

**Event Bus** — An in-process pub/sub system that connects background services to the API layer. When a sync completes, a search dispatches, or an indexer degrades, an event is published. The SSE endpoint streams these events to connected frontends for real-time UI updates.

---

## 4. Technology Stack

### Backend

**Python 3.14+** is required. The project uses Python 3.14 features throughout: deferred annotation evaluation (no forward reference workarounds), PEP 695 type parameter syntax for generic classes and type aliases, bracketless except clauses, and potentially template strings for safe query building. The `type` statement replaces verbose `TypeVar` declarations. Pattern matching via `match`/`case` is used extensively for dispatching on connector types and command variants.

**Litestar** serves as the ASGI web framework. It was chosen over FastAPI for its first-class msgspec integration (eliminating the Pydantic dependency), its class-based controller architecture (which maps cleanly to Comradarr's domain organization), its DI system with automatic scope inference, and its built-in OpenAPI 3.1.0 schema generation from msgspec Struct definitions. Litestar's layered configuration model — where settings cascade from application through routers to controllers to individual handlers — reduces boilerplate while maintaining fine-grained control.

**Granian** is the ASGI server. Its Rust-based I/O handling delivers higher throughput and lower tail latency than Uvicorn. For a single-instance self-hosted application, Granian runs with a single worker in single-threaded runtime mode with uvloop, with automatic worker recycling to prevent memory leaks over long uptimes.

**msgspec** handles all serialization and validation. API request/response schemas, configuration, internal data structures, and event payloads are all msgspec Structs. The `rename="camel"` option on Structs handles automatic snake_case-to-camelCase mapping for *arr API responses. The `gc=False` option on short-lived API response Structs reduces garbage collection overhead. Tagged unions via `Struct(tag="...")` provide type-safe polymorphic dispatch for search command types.

**SQLAlchemy 2.0 async** with the asyncpg driver provides the database layer. The async session pattern with generator-based dependency injection handles transaction lifecycle (auto-commit on success, rollback on exception). Bulk upserts use PostgreSQL's `INSERT ... ON CONFLICT DO UPDATE` for efficient mirror synchronization. Connection pooling is configured with pre-ping, recycling, and bounded pool sizes appropriate for a single-instance application.

**PostgreSQL** is the sole data store. It handles the mirror tables (synced *arr content), the search schedule (rotation state), dispatched command tracking, sync state, configuration, authentication sessions, and all operational data. There is no Redis, no message broker, no secondary data store. For a self-hosted single-instance application, PostgreSQL provides everything needed.

**structlog** provides structured logging with contextual information (connector name, sync type, items processed). In development, logs render as human-readable colored output. In production, logs render as JSON for machine parsing. The Litestar structlog plugin integrates request/response logging with access logs.

**httpx** is the async HTTP client used for all outbound requests to *arr APIs. It provides connection pooling, timeout configuration, and HTTP/2 support. A shared `HttpClient` wrapper adds retry logic, API key injection, error normalization, and response deserialization via msgspec.

**Alembic** manages database migrations. Migrations are auto-generated from SQLAlchemy model changes and can optionally run on application startup. The migration history is stored in the repository and applied during Docker container startup.

**ruff** handles all linting and formatting with a single tool. basedpyright in recommended mode provides type checking. pytest with pytest-asyncio (auto mode) and pytest-xdist (parallel execution) handles testing.

**uv** is the Python package manager and project tool, managing dependencies, virtual environments, and Python version pinning.

### Frontend (deferred — see Section 25)

The frontend will be implemented as a SvelteKit 2 application using Svelte 5 Runes, Bun runtime, UnoCSS with presetWind4 and presetShadcn, and shadcn-svelte for the component library. It communicates with the backend exclusively through the REST API and SSE event stream.

### Development CLI

A Python-based development CLI (`dev_cli/`) orchestrates local development: starting the backend and frontend with auto-reload, managing an ephemeral or persistent PostgreSQL instance, running migrations, and executing tests with auto-provisioned databases.

---

## 5. Monorepo Structure

The project is organized as a monorepo with clear separation between backend, frontend, and development tooling. Both Python packages (backend and dev CLI) use `uv init --build-backend uv_build` with the src layout convention, which prevents accidental imports from the project root and ensures the package must be properly installed to be importable.

The top-level structure:

```
comradarr/                          Git repository root
├── backend/                        uv init comradarr --build-backend uv_build
│   ├── pyproject.toml              Backend dependencies, tooling config
│   ├── README.md
│   ├── alembic.ini                 Database migration config
│   ├── migrations/                 Alembic migration versions
│   └── src/
│       └── comradarr/              The actual Python package
│           ├── __init__.py
│           ├── app.py
│           └── ...
├── frontend/                       SvelteKit application (deferred)
│   ├── package.json
│   └── src/
├── dev_cli/                        uv init dev_cli --build-backend uv_build
│   ├── pyproject.toml
│   └── src/
│       └── dev_cli/
├── shared/                         OpenAPI spec, generated types
├── .github/                        CI/CD workflows
├── CLAUDE.md                       AI assistant guidance
├── pyproject.toml                  Root-level tooling (pre-commit runner)
└── docker-compose.yml              Production deployment
```

The backend and frontend are fully independent packages. They share no code directly — the API contract is the OpenAPI specification generated by Litestar, from which TypeScript types are generated for the frontend. The `shared/` directory contains this specification and any generated artifacts.

The `dev_cli/` follows the same `uv init --build-backend uv_build` pattern as the backend, making it a standalone Python package with its own dependencies. It is not part of the production application. In development, `uv sync` in the dev CLI's directory installs it along with the backend package if needed.

The Granian production entrypoint references the installed package directly: `granian comradarr.app:app`. In development, `uv sync` in the backend directory installs the package in editable mode, so source changes are reflected immediately without reinstallation.

---

## 6. Backend Architecture

### Layered Design

The backend follows a strict layered architecture where each layer has clear responsibilities and dependencies flow in one direction — inward from API controllers to core domain logic.

**API Layer** (`api/`) — Litestar controllers that handle HTTP request/response concerns: route definition, request validation via msgspec schemas, response serialization, pagination, and error formatting. Controllers are thin — they receive injected services and repositories, call them, and return results. Controllers never contain business logic.

**API Schemas** (`api/schemas/`) — msgspec Struct definitions for request and response DTOs. These are distinct from internal domain types and database models. Request schemas enforce validation constraints via `msgspec.Meta` annotations (string lengths, numeric ranges, regex patterns). Response schemas control what data is exposed to the frontend and how it is serialized. Page-view schemas compose multiple domain results into the shape each frontend page needs.

**Service Layer** (`services/`) — Business logic organized by domain. Services orchestrate repositories, connectors, and other services to implement workflows. The sync engine, rotation engine, budget system, and Prowlarr health monitor are all services. Services operate on domain types, not API schemas or database models. They receive database sessions and other dependencies through constructor injection.

**Repository Layer** (`repositories/`) — Data access abstraction built on a generic `Repository[T]` base class using PEP 695 generics. Repositories encapsulate all SQL queries and return domain-appropriate projections. Bulk operations (upserts, deletes) are handled here. The content repository is the most performance-sensitive, implementing cursor-based pagination with keyset indexes for the content browser and aggregation queries for the dashboard.

**Model Layer** (`models/`) — SQLAlchemy 2.0 declarative models with async support. Models define the database schema and relationships. A `Base` class with `TimestampMixin` (auto-managed `created_at`/`updated_at`) and `UUIDPrimaryKeyMixin` provides common fields. Models are internal to the backend — they are never exposed through the API directly.

**Connector Layer** (`connectors/`) — HTTP clients for external *arr APIs. Connectors handle the specifics of each *arr application's API: URL construction, authentication, request serialization, response deserialization into typed msgspec Structs, retries, and error mapping. A `ClientFactory` creates and caches clients per connector with connection pooling.

**Core Layer** (`core/`) — Cross-cutting infrastructure: database lifecycle management, dependency injection providers, the event bus, cryptographic utilities (AES-256-GCM for stored API keys), authentication (session management, password hashing, API key validation), cursor encoding/decoding for pagination, and the domain exception hierarchy.

### Dependency Injection

Litestar's DI system wires everything together. Dependencies are declared as `Provide()` entries in the application factory and resolved by parameter name in controller methods. Long-lived services (event bus, client factory, budget source) are created during the services lifespan and stored on application state. Per-request dependencies (database sessions) are generator-based with automatic cleanup.

Services that need the database session receive it through their methods, not their constructors. This means service instances are long-lived singletons (created once at startup) while database sessions are per-request (created and destroyed per HTTP request or per background task tick).

### Background Task Model

Comradarr runs several concurrent background tasks alongside the HTTP server. These are not separate processes or workers — they are async tasks running in the same event loop, managed by an `asyncio.TaskGroup` that is a child of the Litestar lifespan. This ensures clean startup ordering (database ready before services start) and clean shutdown (tasks cancelled before connections close).

The background tasks are: the sync coordinator (runs sync operations on schedule), the rotation engine (dispatches search commands and tracks their completion), and optionally the Prowlarr health monitor (polls indexer health). Each task runs an infinite loop with a configurable sleep interval between ticks, with exception handling that logs errors and continues rather than crashing.

All background task state is persisted in PostgreSQL. If the process crashes or restarts, every task resumes from its last known state — the sync engine picks up from the stored fingerprint, the rotation engine picks up from `last_searched_at` timestamps, and dispatched commands that were in-flight are detected and re-tracked on the next tick.

---

## 7. Connector System

### Design Philosophy

The connector system is the boundary between Comradarr's domain model and the external *arr APIs. Its job is to present a clean, typed, Pythonic interface to the rest of the application while handling all the messiness of HTTP communication: authentication, retries, timeouts, rate limiting responses, error normalization, and camelCase-to-snake_case mapping.

### API Version Strategy

Comradarr targets the current stable API versions only: Sonarr v3 (which serves both Sonarr v3 and v4 installations) and Radarr v3. There is no version negotiation or adapter layer — each client is written directly against its target API version. If a future Sonarr v5 API is released, a new client would be added alongside the existing one, with the factory selecting based on detected version.

This deliberately avoids premature abstraction. The Sonarr and Radarr APIs share structural patterns (command system, quality models, tag system) but differ significantly in domain concepts (series/episodes vs movies). Forcing them into a shared interface would create a leaky abstraction that obscures the actual API capabilities. Instead, shared patterns are extracted as mixins and shared types, while domain-specific operations remain in their respective clients.

### Three-Layer Architecture

**HTTP Foundation** — A shared `HttpClient` class wraps httpx with: API key injection via the `X-Api-Key` header (using positional-only parameters to prevent credential leakage in logs), configurable timeouts with separate connect and read timeouts, exponential backoff retry for transient failures (5xx responses, timeouts, connection errors), respect for `Retry-After` headers on 429 responses, immediate failure on 4xx client errors (which indicate bugs, not transient issues), response deserialization directly into msgspec Structs via generic methods, and structured logging of all requests with timing information.

The `HttpClient` provides generic typed methods — `get[T]`, `get_list[T]`, `post[T]` — where the caller specifies the expected response type and the client handles deserialization. This means callers never touch raw JSON or response objects.

**Shared Abstractions** — Both Sonarr and Radarr share identical command systems. A `CommandMixin` provides `send_command()` (posts a command and returns its ID), `get_command_status()` (polls for completion), and `ping()` / `get_system_status()` (health checks). Shared response types like `QualityModel`, `Revision`, and `SystemStatus` are defined once and used by both clients.

**App-Specific Clients** — `SonarrClient` and `RadarrClient` each provide domain-specific methods organized into two categories: sync operations (fetching content for the mirror) and search operations (sending search commands for the rotation engine). Sync operations include fetching all series/movies, fetching episodes by series or season, and fetching quality profiles. Search operations include episode search (accepts a list of episode IDs), season search (series ID + season number), series search (series ID), and movie search (accepts a list of movie IDs).

`ProwlarrClient` is read-only from Comradarr's perspective. It fetches indexer configurations (including rate limits), indexer statistics (query counts, failure rates), indexer status (disabled/healthy), and application mappings (which Prowlarr apps correspond to which Sonarr/Radarr instances).

### Client Factory

A `ClientFactory` creates and caches clients per connector. It decrypts stored API keys using the crypto service, creates an `HttpClient` with the connector's URL and credentials, wraps it in the appropriate typed client, and caches the result. If a connector's configuration changes (URL or API key updated), the factory invalidates the cached client so the next access creates a fresh one. On application shutdown, the factory closes all HTTP client sessions to release connection pool resources.

### URL Validation and SSRF Defenses

When a user enters a connector URL, that URL becomes the destination of authenticated HTTP requests carrying the connector's API key. The URL is therefore not just user input — it is attacker-controllable input that determines where authenticated traffic is sent. A naïve implementation enables a class of server-side request forgery attacks where a tricked user adds a connector pointing at an internal service or a cloud metadata endpoint, causing Comradarr to leak API keys or interact with services the operator never intended to expose. The defenses below are designed to make the realistic attack scenarios — cloud metadata exfiltration (`169.254.169.254`), DNS rebinding to internal addresses, malicious *arr clones returning attacker-controlled redirects — structurally difficult or impossible.

#### URL Structure Validation

Before any network activity, every connector URL is parsed and checked: it must use the `http` or `https` scheme exclusively (no `gopher`, `file`, `ftp`, or other schemes), it must have a host component, it must not contain userinfo (no `http://user:pass@host/` — credentials embedded in URLs are almost always a misunderstanding and would land in the database in a field labeled "URL"), and it must not contain a fragment (`#...` is meaningless in API calls and indicates the user pasted a browser URL by accident). Failures here are returned to the user as specific validation errors before any HTTP traffic is generated.

#### IP Classification Policy

The host portion of the URL is resolved to one or more IP addresses, and every resolved address is classified against a policy. Three categories exist:

**Always rejected** — link-local (`169.254.0.0/16`, `fe80::/10`), which includes cloud metadata endpoints (`169.254.169.254` on AWS, GCP, Azure, Oracle Cloud, DigitalOcean); multicast (`224.0.0.0/4`, `ff00::/8`); unspecified (`0.0.0.0`, `::`); broadcast (`255.255.255.255`); documentation and test ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`); and benchmarking (`198.18.0.0/15`).

**Allowed by default** — loopback (`127.0.0.0/8`, `::1`) covering the common case of Sonarr running on the same host as Comradarr; RFC1918 private space (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) which includes Docker bridge networks (Docker allocates `172.17.x.x` for the default bridge and `172.18.x.x` upward for user-defined bridges, all within `172.16.0.0/12`); IPv6 unique-local (`fc00::/7`); and carrier-grade NAT (`100.64.0.0/10`) which is what Tailscale, Headscale, and similar overlay networks use. These ranges cover essentially every legitimate homelab deployment pattern: localhost, Docker container DNS names, home LAN IPs, Tailscale addresses, WireGuard tunnels.

**Always allowed** — global unicast public addresses.

The classification policy is operator-configurable via `COMRADARR_CONNECTOR_URL_POLICY` with three values. The `default` value applies the classification described above and is the right choice for typical homelab deployments. The `strict` value rejects everything except global unicast public addresses, suitable for cloud-hosted Comradarr instances where Sonarr is reached exclusively via public DNS. The `permissive` value disables the always-rejected category and allows everything including link-local — appropriate only for unusual setups where the operator has audited their network and accepts the risk; this mode logs a prominent warning at every startup.

If a hostname resolves to multiple IPs and they span allowed and rejected categories (rare, but possible for dual-stack hosts misconfigured to return both a public and a metadata IP), the URL is rejected. Mixed classification is a signal that something is wrong, and the safe behavior is refusal.

#### Re-resolution on Every Request

Resolving a hostname once at connector creation and trusting it indefinitely is the trap that DNS rebinding attacks exploit. An attacker who controls a domain can return a public IP for the first lookup (passing initial validation) and then return `169.254.169.254` on subsequent lookups — if Comradarr trusts the hostname for the lifetime of the connector, every subsequent request to that "Sonarr" instance hits the cloud metadata endpoint with an attached API key.

The defense is to re-resolve and re-classify on every outbound request. The HTTP client wrapper, before dispatching, resolves the target hostname, runs every returned IP through the classification policy, and refuses to send the request if any IP falls in the rejected category. This adds essentially no latency — DNS resolution is cached by the system resolver, and the request was going to do a lookup anyway. The added cost is microseconds; the added security is that DNS rebinding is structurally defeated.

When re-resolution causes a request to fail, the connector's health status reflects it and the operator sees a specific error: "connector unreachable — resolved to disallowed IP 169.254.169.254". This is strictly preferable to silent exfiltration.

#### Redirect Policy

`follow_redirects` is set to `False` on every outbound request. The *arr APIs do not legitimately use HTTP redirects, and the threat of a malicious or compromised *arr clone returning `302 Location: http://evil.example.com/api/v3/series` (which would cause the API key to be sent to the attacker's host) outweighs the convenience of handling the rare reverse-proxy misconfiguration that emits redirects.

When a redirect is encountered, the request fails and the operator sees the redirect status in the error message, allowing them to investigate and fix the upstream proxy configuration. A future refinement could allow same-origin redirects (same scheme, host, and port) while continuing to reject cross-origin redirects, but `follow_redirects=False` is the correct starting point and the simpler invariant.

#### TLS Verification

TLS verification is enabled by default for every HTTPS connector. The entire system depends on the API key being transmitted only to the actual Sonarr instance; valid certificate verification is what provides this guarantee on the wire. Disabling verification globally is not supported — there is no environment variable to disable TLS verification across the application, because the blast radius of a misconfigured global toggle is too large.

Two per-connector settings accommodate the homelab reality of self-signed certificates and private CAs. The `insecure_skip_tls_verify` boolean (default false) disables certificate verification for the specific connector when set; the connector list UI displays such connectors with a prominent "TLS verification disabled" warning badge so the operator sees at a glance which connectors operate without cryptographic protection. The `tls_ca_bundle_path` string (nullable, default null) points at a custom CA bundle file; the HTTP client for that connector uses this bundle instead of the system defaults, which is the correct answer for users with a private CA (caddy auto-generated certs, internal Let's Encrypt via DNS-01 on a `.local` domain, internal corporate PKI). Using a custom CA bundle is strictly preferable to skipping verification entirely — the connection is still cryptographically authenticated, just against a CA the operator controls rather than the public web PKI.

#### Response Size and Timeout Bounds

A malicious or buggy *arr response that returns a 10 GB JSON blob would exhaust Comradarr's memory. An infinitely slow response would tie up connection pool slots and degrade the entire system. Both are bounded explicitly.

The response size cap is 256 MB by default, configurable per connector. Sonarr's largest realistic response (full episode list for a 500-series library) is a few MB; the cap is generous and protects against pathological responses. Larger responses are aborted mid-stream, the connection is closed, and a specific error is raised.

Timeouts are always set, never `None`: 5 seconds for connect, 30 seconds for read, 10 seconds for write, 5 seconds for pool acquisition. The read timeout is the longest because some *arr operations (series searches, library refreshes) legitimately take time, but none of them should take more than 30 seconds — if they do, something is wrong upstream and failing is the correct behavior. These are enforced in the HTTP client wrapper rather than relying on httpx defaults, because library defaults change between versions and we want explicit control.

#### Validation Ordering at Connector Creation

When a user submits a new connector through the UI, validation runs in a specific order designed to surface the most actionable error to the user while never silently accepting a bad configuration:

1. **Schema validation** — URL structure, API key format, name length and character class.
2. **URL classification** — DNS resolution and IP classification against the configured policy.
3. **Connectivity check** — a single authenticated request to the *arr system status endpoint, with all the hardening above enabled.
4. **Response validation** — the response is parsed as the appropriate `SystemStatus` struct; if parsing fails, the endpoint is not a *arr instance (or is a hostile one) and the connector is rejected.
5. **API version compatibility check** — the returned version is checked against what the connector type supports.

Each step's failure produces a specific error message. The sequence runs cheap local checks first (schema, classification), then network checks (connectivity), then correctness checks (response shape). Connector edits that change the URL or API key re-run the full pipeline; an existing connector cannot have its URL silently changed to an unvalidated one.

#### Logging Discipline for Connector URLs

Connector URLs appear in logs at INFO level during normal operation (sync started, command dispatched, health check completed) — operators need this for debugging. Two rules apply: query strings are stripped from every logged URL before emission (defense in depth against the legacy *arr endpoints that historically accepted `?apikey=` in addition to the `X-Api-Key` header — even though Comradarr only uses the header, query string stripping costs nothing and removes an entire class of accidental disclosure), and the request itself is logged without its `X-Api-Key` header thanks to the structlog redaction processor described in Section 15. Connector requests therefore appear in logs as "GET https://sonarr.example.com/api/v3/series" with no key material anywhere in the line.

#### Reuse by the Notification System

The URL classification policy, the re-resolution-on-every-request discipline, the TLS posture, the `insecure_skip_tls_verify` and `tls_ca_bundle_path` per-destination overrides, and the redirect-refusal behavior specified above are not exclusive to connector traffic. The notification system (Section 14) applies the same policy and the same implementation to every outbound webhook and apprise URL it dispatches to, because the threat model is identical — a URL field editable through the admin UI that resolves to arbitrary destinations, carrying credentials attached by Comradarr — and splitting the policies would create a weaker surface for an attacker to target. Operators who tighten `COMRADARR_CONNECTOR_URL_POLICY` get the tightening on both subsystems at once.

### Hostile Response Defenses

The SSRF defenses above harden the *request* side of connector communication — they ensure authenticated traffic only goes where it should. The response side requires equal attention. Sonarr is "trusted" right up until it isn't: a compromised instance, a malicious clone shared in a community forum, a man-in-the-middle on a misconfigured network, or simply a Sonarr bug that produces malformed output. Authentication says "this is the host I think it is"; it does not say "this host is well-behaved." Comradarr therefore treats every byte returned from a *arr instance as untrusted data and validates it through layered defenses before it reaches business logic or the database.

#### The Threat Model

Five categories of hostile or pathological response behavior need explicit defenses, each addressing a distinct failure mode:

**Memory exhaustion via response size** — the response is gigabytes of JSON, or a streaming response that never terminates, or chunked data with no Content-Length where each chunk is small but they keep arriving.

**Deserialization exhaustion** — a response that fits within size bounds but is structured to cause pathological parsing: 10,000-deep nesting, dictionaries with millions of keys, strings that decode into something much larger.

**Type confusion and field smuggling** — values whose runtime types don't match expectations (`id: "1; DROP TABLE..."` instead of `id: 1`), values outside the meaningful range (`qualityProfileId: -1`), unexpected fields injected hoping they'll be trusted (`isAdmin: true`).

**Semantic poisoning** — well-formed values designed to misbehave downstream: `episodeCount: 999999999` would cause the rotation engine to misjudge work volume; `airDate: 9999-12-31` would break tier computation; negative `sizeOnDisk` would corrupt aggregations.

**Identity confusion across connectors** — a malicious Sonarr returning IDs that overlap with another connector's data, attempting to corrupt the other connector's mirror.

#### Response Reading Bounds

The 256 MB response cap from the SSRF subsection is enforced as a true byte budget rather than a Content-Length check. The HTTP client wrapper accumulates bytes from the response stream and aborts the moment the budget is exceeded, regardless of whether Content-Length matched, exceeded, or was missing entirely. A hostile server claiming `Content-Length: 1024` while actually streaming gigabytes is bounded by the budget, not by its own headers.

The full response body is read into memory before deserialization begins. There is no streaming-deserialize path. This is a deliberate design choice — streaming deserialization would create a class of attacks where a partial parse triggers application action and the rest of the response continues to flow. The two-phase invariant ("we have all the bytes, then we parse them" or "we abort before parsing begins") is simpler to reason about and structurally eliminates partial-parse exploits.

The wall-clock read timeout from the SSRF subsection (30 seconds) bounds the temporal dimension. A response delivered as 50,000 tiny chunks over 25 seconds — each individually innocent, totaling under the size cap — is still terminated by the timeout. Defense in depth: the timeout catches the time axis, the byte budget catches the volume axis, and either limit hitting first triggers the same termination path.

#### msgspec Strictness Settings

msgspec's default settings are tuned for ergonomic use, not for receiving untrusted input. Three explicit non-default settings apply to *arr response Structs:

**`strict=True` for type coercion.** By default, msgspec coerces between compatible JSON and Python types — a string `"42"` is accepted into an `int` field. Strict mode disables this: an `int` field accepts JSON numbers only, and string-typed values are rejected at deserialization. This closes the type-confusion vector where a hostile server smuggles string values into integer-typed fields hoping for downstream string-handling bugs.

**`forbid_unknown_fields=True` for control-plane Structs.** This setting governs what happens when the response contains fields the Struct doesn't declare. The default permissive behavior (silently ignore unknown fields) is correct for *content* Structs — series, movies, and episodes — because *arr APIs add fields over time and Comradarr should not break when Sonarr adds a new metadata field in a release. The strict behavior (reject responses containing unknown fields) is applied to *control-plane* Structs — system status responses that determine compatibility, command status responses that drive dispatch tracking, indexer configuration responses from Prowlarr — because an attacker injecting an unexpected field there might exploit a typo-based privilege escalation or behavior change. The split policy keeps Comradarr resilient to upstream API evolution while hardening the security-sensitive control paths.

**Bounded sizes via `msgspec.Meta` constraints.** Every string and collection field on a *arr response Struct gets a maximum-size constraint sized appropriately for the field's purpose. Title fields cap at a few hundred characters. Path fields cap at the platform's filesystem path maximum (4096 bytes is generous). URL fields cap in the low thousands. List fields get realistic limits (a `seasons` list capped at 100 entries — no real series has 100 seasons, the cap exists to reject pathological values, not realistic ones). Numeric fields with semantic ranges get `ge` and `le` bounds — `arr_id` is `ge=1`, episode counts are non-negative, and so on. These constraints reject obvious hostility at the deserialization boundary rather than allowing it to propagate into the application.

#### Semantic Validation Beyond Types

msgspec's type system handles "is this an int"; semantic validation handles "is this a sensible int". A lightweight validation pass runs in the mapper layer (between deserialization and database write) and catches values that are structurally valid but operationally implausible:

**Date plausibility** — air dates and release dates are bounded to a reasonable range (1900-01-01 through 2100-01-01). Dates outside this range are coerced to null rather than allowed to corrupt tier computation downstream.

**Identifier plausibility** — *arr IDs are positive integers; values that pass type checking but are zero or negative are rejected.

**Aggregate consistency** — where a response includes both per-item data and aggregate counts (a series response includes a `seasonCount` and a `seasons` list), the aggregates are recomputed from the items and the recomputed values are trusted over the response's stated values. If the response claims `seasonCount: 5` but the seasons list contains 3 entries, the trusted value is 3. This defends against semantic-poisoning attacks where the aggregate field is the actual attack vector — for example, an inflated count that drives sizing decisions in downstream queries.

These validations live in the per-connector mapper modules (`services/sync/mappers/sonarr.py` and `services/sync/mappers/radarr.py`), which were already the layer responsible for translating *arr response shapes into Comradarr's internal domain types. The validation is added work in the same layer, not a new abstraction.

#### Connector Identity Isolation

The mirror tables' composite primary key on `(connector_id, arr_id)` is the structural defense against cross-connector identity confusion. A malicious Sonarr instance returning IDs that overlap with another connector's IDs cannot pollute the other connector's mirror — the rows are in different keyspaces by construction. The same isolation applies to the search schedule and the planned commands tables.

This is an emergent property of the schema design rather than an active runtime check, but it deserves explicit mention in the threat model: if a user accidentally adds two connectors that point at the same hostile *arr clone via different URLs, the rows remain isolated by `connector_id` and the hostile clone cannot use one connector to corrupt another.

#### Error Normalization on Validation Failure

When any layer above rejects a response, the failure path matters as much as the detection. The connector error normalization layer (introduced in Section 15) catches the raw msgspec or validator exception at the HTTP client boundary and extracts its details into a structured form: which field failed, what the constraint was, what type the offending value had. The offending value itself is never captured — it might be enormous (a multi-megabyte string in a title field) or sensitive (data leaked from another tenant on a multi-tenant *arr clone).

A `ComradarrError` is constructed from the structured details, the original exception is dropped, and the error propagates to the calling service (sync engine, dispatcher, health monitor) which logs the failure with bounded context, marks the connector unhealthy if appropriate, and continues without crashing. The user sees a message like "Sonarr 'Living Room' returned a malformed response: field 'seasonCount' had unexpected value type" — informative enough to act on, never large enough to fill logs or accidentally include the hostile payload.

#### Frontend Treatment of Connector-Provided Strings

Every string that originated in a connector response and reaches the frontend is HTML-escaped on render. Svelte does this by default for `{value}` expressions; the `{@html value}` directive bypasses escaping and is therefore forbidden on any connector-sourced field. This is enforced as a code-review invariant rather than a runtime check, because once `{@html}` is in the codebase the escaping is gone and runtime detection would be after-the-fact.

A related concern: connector-provided strings must never be used to construct executable code. They are not concatenated into CSS selectors, JavaScript regex sources, dynamic import paths, or anything else that would let a hostile string become control flow rather than data. Treat them strictly as data values to be displayed, never as tokens in a constructed program.

#### Health Degradation Rather Than Crash

When a connector starts producing failed validations, the goal is graceful degradation, not process death. The HTTP client wrapper increments a per-connector consecutive-failure counter on each validation failure. Once the counter crosses a `degraded` threshold (default 5 consecutive failures), the connector is marked degraded — its health badge in the UI turns yellow, and the rotation engine reduces its dispatch rate but continues to attempt operations. Once the counter crosses an `unhealthy` threshold (default 20 consecutive failures), the connector is marked unhealthy — the rotation engine stops dispatching to it entirely, and only periodic health-check requests continue to probe whether it has recovered.

The recovery path: every successful response decrements the counter; once it reaches zero, the connector returns to healthy status and normal operation resumes. This means a transient bad-response burst (network blip causing partial reads, a Sonarr restart returning errors during initialization, a brief upstream incident) does not permanently disable a connector, while sustained malformed behavior does. The thresholds are fixed defaults in v1 — making them per-connector configuration would add operational surface for little real value, since the defaults are tuned to be conservative enough for legitimate variation and aggressive enough to stop dispatching to a clearly hostile peer.

The health state changes are emitted as `ConnectorHealthEvent` instances on the event bus described in Section 13, so the frontend updates in real time and the operator can see exactly when degradation began and what triggered it.

### Domain Models

Each client has a dedicated models file containing msgspec Structs that represent the subset of the *arr API response that Comradarr actually needs. These are deliberately lean — a `SonarrSeries` struct contains about 10 fields out of the 40+ that the API returns. Fields not needed for sync, rotation, or display are simply omitted. The unknown-field policy follows the split described in the Hostile Response Defenses subsection above: content Structs (series, movies, episodes) ignore unknown fields so that *arr API additions don't break Comradarr; control-plane Structs (system status, command status, indexer config) reject unknown fields as a hardening measure.

All *arr API response Structs use `rename="camel"` for automatic camelCase mapping and `gc=False` to reduce garbage collection pressure since these objects are short-lived (created during API response processing and discarded after the data is written to the mirror). Numeric fields use `strict=True` to disable type coercion, and string and collection fields carry `msgspec.Meta` constraints with appropriate maximum sizes — see the Hostile Response Defenses subsection for the rationale.

---

## 8. Data Model & Storage Strategy

### Separation of Concerns: Mirror vs Operational State

The database has two conceptually distinct groups of tables that serve different purposes and have different update patterns.

**Mirror tables** store a synchronized copy of data from connected *arr applications. They represent "what Sonarr/Radarr knows" — content metadata, file status, quality information. Mirror tables are overwritten during sync operations and should be considered a cache of external state. They include: `mirror_series` (Sonarr series with aggregate statistics), `mirror_episodes` (individual episodes with file status, quality, air dates), and `mirror_movies` (Radarr movies with file status, quality, size).

**Operational tables** store Comradarr's own state — data that doesn't exist in any *arr application. They are never overwritten by sync. They include: `search_schedule` (rotation state — when each item was last searched, its priority tier, search count), `planned_commands` (dispatched search commands — what was sent to which connector, when, and its completion status), `sync_state` (per-connector sync metadata — last sync timestamps, fingerprints, status), `connectors` (connection configuration — URLs, encrypted API keys, settings), and auth tables (users, sessions, API keys).

This separation is critical for correctness. A full sync can safely rebuild mirror tables without affecting rotation state. The `search_schedule` table preserves `last_searched_at` timestamps, `search_count`, and `paused` flags across syncs. The only field that sync updates on the schedule table is the `tier` (because an item's priority may change when its file status changes), and even that is done through a targeted upsert that preserves all other fields.

### Mirror Table Design

Mirror tables store only the fields Comradarr needs for its operations: identification (arr_id, external IDs like tvdb_id/tmdb_id), display (title, year, status), rotation-relevant state (has_file, monitored, quality_profile_id, size_on_disk, air_date), and grouping (series_arr_id, season_number for episodes). They do not store overview text, images, genres, ratings, or other metadata that would only be relevant for a full media management UI.

Each mirror table has a composite unique constraint on `(connector_id, arr_id)` which serves as the upsert target for sync operations. This means the same arr_id can exist for different connectors (a user might have two Sonarr instances with overlapping content).

### The Search Schedule

The `search_schedule` table is the single most important table in the system. It drives the entire rotation engine. Each row represents one searchable item with the following fields:

- **Identity**: connector_id, content_type (episode/movie), content_arr_id — uniquely identifies the item
- **Grouping**: series_arr_id, season_number — used by the planner to batch items into optimal commands. Denormalized from the mirror for query performance so the planner doesn't need joins.
- **Rotation State**: last_searched_at (nullable — null means never searched, which sorts first), search_count (total lifetime searches)
- **Priority**: tier — an integer (0–3) where lower values rotate faster. Tier 0 is MISSING (no file on disk), tier 1 is RECENT (aired/released within 90 days for episodes, 180 days for movies), tier 2 is MONITORED (has file, standard rotation), tier 3 is COMPLETED (has file, series ended or movie is old, slowest rotation).
- **Control**: paused — allows individual items to be excluded from rotation without deletion

The critical index on this table is `(connector_id, tier, last_searched_at NULLS FIRST) WHERE NOT paused`. This index makes the rotation query — "give me the N stalest unpaused items for this connector, prioritized by tier" — a simple index scan regardless of table size. With 500,000 rows, this query returns in under 1 millisecond.

Tier assignment is computed during sync, not manually set by the user. The tier function examines the item's file status, air/release date, and (for episodes) the series status. Missing items are always tier 0 regardless of series status — a missing episode of an ended series is still urgent. Only items with files get downgraded based on recency and series lifecycle.

### Planned Commands Table

Tracks dispatched search commands and their lifecycle. Each row records: the connector, the command type (episode/season/series/movie search), the serialized command payload (as JSONB), the *arr command ID returned by the API, dispatch and resolution timestamps, and the list of schedule item IDs that this command covers.

The `covers_items` relationship is essential. A single season search command covers every episode in that season, even ones that weren't explicitly "due" for search. When the command completes, every covered item's `last_searched_at` is updated, pushing them to the back of the rotation. This prevents the rotation engine from re-searching the same season minutes later because some episodes in it hadn't been individually searched yet.

### Cursor-Based Pagination

For the content browser API endpoint (which must page through potentially 500,000 items), offset-based pagination is avoided entirely. Instead, keyset (cursor) pagination is used. The cursor encodes the sort column value and the item ID from the last row of the previous page. The query uses a `WHERE (sort_col, id) > (cursor_sort_value, cursor_id)` clause with a composite index, making every page fetch O(1) regardless of depth.

Cursors are opaque base64-encoded strings from the frontend's perspective. The backend encodes and decodes them, and they are only valid for the specific sort order they were created with.

### Database Roles and Access Separation

Comradarr operates its database through three logically distinct PostgreSQL roles, each scoped to the minimum privileges its responsibilities require. Role separation at the database level is the structural defense against the class of bug where application code is tricked into doing more than it should — a SQL injection, a logic error in a request path, or a compromised dependency that gains arbitrary-query access. With roles correctly scoped, "the application has full control of its database" is not an accurate description of the runtime posture; only specific, bounded portions of the schema are mutable from the main connection.

**Migration role.** Holds full DDL privileges on the application schema: creating, altering, and dropping tables, indexes, constraints, and sequences. It is used exclusively by Alembic during container startup, before the application process begins handling requests. Once migrations complete, the connection is closed and the role is not used again until the next startup. A bug in request-handling code cannot run DDL because no connection in the request path has the migration role's credentials.

**Application role.** Holds DML privileges (select, insert, update, delete) on every application table *except* the audit log, where it holds only select and insert. This is the role used by the long-running application process for every query during normal operation — sync, rotation, API handlers, background workers. The audit log exception is what enforces write-once semantics for audit entries at the database level: the application cannot modify or delete prior entries through any code path, because its role simply cannot execute those operations on that specific table. A SQL injection that attempts to cover its tracks with an update or delete against the audit log fails at the database, not at the application.

**Audit-admin role.** Holds delete privileges on the audit log table and nothing else. It is used by the retention vacuum task (described in the Audit Log subsection of Section 15) and by no other code path. Its connection is opened briefly, used for the vacuum operation, and closed — it is never pooled alongside the application role's connections and never accessible from the request path.

The runtime posture is therefore simple: one long-lived connection pool using the application role's credentials, which every request handler and every background task draws from. The migration role's connection exists briefly at startup and is gone before the pool opens. The audit-admin role's connection exists briefly during scheduled retention runs and is gone immediately after. This keeps the request path code uniform — there is exactly one way to get a database session — while the security-relevant privilege boundaries are enforced by Postgres rather than by the application's own checks.

**Role provisioning.** In the bundled-PostgreSQL deployment (Section 24), the container's init sequence creates the three roles at first startup with randomly-generated credentials stored in a permissions-protected file inside the PostgreSQL data directory, readable only by the processes running inside the container. The operator sees none of this — from their perspective there is no database configuration at all. In the external-database deployment, the operator provides a `DATABASE_URL` pointing at a database where Comradarr has sufficient privileges to create roles (typically as the database owner). On first startup, Comradarr creates the three roles and switches to using them for subsequent operations; the setup is idempotent, so restarts against an already-provisioned database are a no-op.

**Connection encryption.** The bundled case uses a Unix socket inside the container, where TLS is inapplicable — there is no wire to encrypt. The external case requires TLS with certificate verification enabled by default, consistent with the outbound HTTP client's posture (Section 7). There is no global opt-out for skipping verification; operators with self-signed certificates or private CAs on their PostgreSQL instance follow the same CA-bundle pattern used for connector TLS.

**Raw SQL discipline.** Role separation defends against some injection attacks but not all — a role with insert privileges on the audit log can still be tricked into inserting fabricated entries if user input flows unsanitized into a query. The complementary defense is no raw SQL string construction anywhere in the codebase: every query is parameterized through SQLAlchemy's ORM or Core constructs, every parameter is bound by the asyncpg driver rather than interpolated into the SQL text, and Python 3.14's template strings provide an additional safe construction path for the rare cases where dynamic query composition is needed. The ruff security rule category flags string-formatted SQL construction and execute calls with interpolated content; these are treated as errors in CI, not warnings, so the defense is enforced at code-review time rather than requiring runtime discipline.

---

## 9. Sync Engine

### Purpose

The sync engine maintains the local mirror as an accurate, near-real-time reflection of what exists in connected Sonarr and Radarr instances. It is the foundation for everything else — the rotation engine can only search items it knows about, and it can only assign correct priority tiers if it knows which items have files.

### Three-Tier Sync Strategy

The sync engine operates in three modes, each trading API call volume for accuracy:

**Incremental Sync** runs every 5 minutes (configurable). It makes one API call to fetch the series/movie list from the *arr application, computes a fingerprint of the response, and compares it against the stored fingerprint from the last sync. For series that show changes in their season statistics (episode count, file count, size on disk), it fetches episodes for only those series (or specific changed seasons). For unchanged series, no episode-level API calls are made. This typically results in 1–5 API calls per sync and completes in under a second. It catches the vast majority of day-to-day changes: new downloads, deletions, new episodes airing.

**Deep Incremental Sync** runs every hour (configurable). It fetches all episodes/movies from the *arr application and diffs each one against the corresponding mirror row. This catches edge cases that the incremental fingerprint misses: situations where two changes cancel out in aggregate statistics (a file deleted and a different file added in the same season, leaving counts unchanged), tier drift due to time (an episode aging past the 90-day RECENT threshold), and episode file ID changes (same episode re-downloaded with different quality). For Sonarr, this requires N+1 API calls (one for series, one per series for episodes) and takes 30–60 seconds for a 500-series library. For Radarr, it's a single API call (movies are flat) and takes under a second. Because of this asymmetry, Radarr connectors skip regular incremental sync and always perform deep incremental — the cost is identical.

**Full Sync** runs every 12 hours (configurable) and on first connection. It fetches everything, deletes mirror rows that no longer exist remotely, upserts all current data, and fully reconciles the search schedule. This is the correctness safety net — even if incremental and deep incremental somehow miss a change, the full sync will catch it. Full sync is also the only mode that detects items removed from the *arr application (series deleted, movies removed) and cleans up their mirror and schedule entries.

### Fingerprint System

The series-level fingerprint is a compact representation of the *arr library's state, computed from the series/movie list response without any episode-level API calls. For Sonarr, it captures per-series, per-season: monitored status, episode count, file count, total episode count, and size on disk. For Radarr, it captures per-movie: monitored status, has_file flag, size on disk, and quality profile ID.

Fingerprints are stored as JSONB in the `sync_state` table. On each incremental sync, a new fingerprint is computed and structurally compared against the stored one. The diff produces a changeset listing which series were added, removed, or modified, and for modified series, which specific seasons changed. Only changed items trigger episode-level fetches.

The fingerprint is an optimization, not a correctness mechanism. It reduces API calls from hundreds to single digits on typical syncs. The deep incremental and full sync modes provide correctness guarantees that the fingerprint alone cannot.

### Episode-Level Diffing

When episodes are fetched (during any sync mode), they are diffed against existing mirror rows on a field-by-field basis. The diff detects: new episodes (present in remote, absent in mirror), removed episodes (present in mirror, absent in remote), and modified episodes (field values differ between remote and mirror). Modified episodes also check whether the change warrants a tier reassignment — for example, an episode gaining a file should move from tier 0 (MISSING) to tier 2 (MONITORED).

The diff also detects "tier recomputation" changes where no *arr data changed but the tier should change due to time passing. An episode that aired 89 days ago was RECENT, but at 91 days it should be MONITORED. The deep incremental sync catches this naturally by recomputing tiers for every item.

### Applier: Database Write Strategy

The applier receives diffs and translates them into efficient database operations. Mirror table updates use PostgreSQL's `INSERT ... ON CONFLICT DO UPDATE` for bulk upserts, batched in groups of 1,000 rows to avoid oversized queries. Removals use `DELETE ... WHERE arr_id IN (...)`.

Search schedule updates are carefully designed to preserve rotation state. When upserting schedule entries, only the tier, series_arr_id, and season_number fields are updated. The `last_searched_at`, `search_count`, and `paused` fields are explicitly preserved. This means a sync never resets an item's rotation position.

After episode-level changes are applied, a post-pass applies series-level context to tiers: episodes of ended series that have files are downgraded from MONITORED to COMPLETED. Missing episodes of ended series remain at MISSING — their urgency doesn't decrease just because the series is complete.

### Sync Coordinator

The sync coordinator is a background task that determines when each connector needs a sync and which mode to use. It checks all active connectors on a 30-second tick, comparing each connector's last sync timestamps against the configured intervals. It prioritizes: full sync if overdue or never run, then deep incremental if overdue, then regular incremental if overdue.

Sync operations are executed sequentially per connector (not concurrently) to avoid overwhelming a single *arr instance. Multiple connectors can sync concurrently since they target different *arr instances.

The coordinator handles failures gracefully: if a sync fails due to a connector being unreachable, it records the error and retries on the next tick. Transient failures don't block subsequent syncs.

On completion, the coordinator publishes a `SyncCompletedEvent` to the event bus with summary statistics (items synced, changes detected, tier changes, duration). On failure, it publishes a `SyncFailedEvent` with the error reason. The frontend uses these events to update sync status in real-time.

### Concurrency During Sync

When a Sonarr sync needs to fetch episodes for multiple series, these fetches are executed concurrently using an `asyncio.TaskGroup` with a semaphore limiting concurrency to 5 simultaneous requests. This balances speed (a full sync of 500 series completes in ~60 seconds instead of ~500 seconds) against politeness (not flooding the Sonarr instance with 500 concurrent requests).

Each concurrent fetch task uses the shared `HttpClient` and its connection pool. The semaphore is the concurrency control mechanism, not the connection pool — the pool is sized larger than the semaphore to allow other operations (health checks, command tracking) to proceed during sync.

---

## 10. Rotation Engine

### Core Concept: Continuous Rotation, Not a Queue

The rotation engine is fundamentally different from a traditional work queue. A queue has items that enter, get processed, and exit. The rotation engine has items that are always present and cycle through search indefinitely. Every item in the library participates — there is no "done" state, no "exhausted" state, no backoff timers. Items are simply sorted by staleness (when they were last searched) and the stalest items get searched next.

This model is simpler to understand, implement, and operate than a state machine with transitions. There are no edge cases around items stuck in intermediate states, no recovery logic for crashed-during-search scenarios, and no complex reactivation rules. If the system restarts, the rotation continues exactly where it left off because the only state is a timestamp per item.

### Tier-Based Priority

While every item rotates, not all items rotate at the same speed. The tier system provides soft prioritization without introducing separate queues or complex priority logic. Tiers are simply an additional sort dimension: items are sorted first by tier (ascending — lower tier = higher priority), then by `last_searched_at` (ascending, nulls first — never-searched items surface first).

This means all tier-0 (MISSING) items will be searched before any tier-2 (MONITORED) items, and within each tier, the stalest items come first. The effect is that MISSING items cycle through search rapidly (every few days with a moderate budget), while COMPLETED items cycle slowly (every few months). But critically, COMPLETED items do still cycle — they just take longer to reach the front of the line.

The tier assignments are: tier 0 (MISSING) for items without a file on disk; tier 1 (RECENT) for items with files that aired or were released within 90 days (episodes) or 180 days (movies) — these are most likely to get quality upgrades; tier 2 (MONITORED) for items with files in active (continuing) series or recent movies; tier 3 (COMPLETED) for items with files in ended series or old movies.

Tier assignment is computed by the sync engine during mirror updates, not by the rotation engine. The rotation engine only reads tiers — it never modifies them. This separation ensures that tier logic is in one place (the sync engine's tier computation function) and that tier changes are tied to actual state changes in the library, not to search outcomes.

### The Planning Phase: Maximizing Coverage Per Command

The planning phase is the most important optimization in Comradarr. The fundamental constraint is indexer rate limits — each search command sent to Sonarr or Radarr triggers queries against all configured indexers. The planner's job is to minimize the number of commands needed to cover the maximum number of items.

Sonarr exposes three search granularities: `EpisodeSearch` (a list of episode IDs — one indexer query per episode), `SeasonSearch` (a series ID and season number — one indexer query for the entire season), and `SeriesSearch` (a series ID — one indexer query for the entire series). The coverage ratios are dramatically different. Searching 12 individual episodes costs 12 indexer queries. Searching the entire season costs 1 indexer query but covers all 12 episodes plus any others in the season.

The Sonarr planner operates on the batch of "due" items (the stalest items pulled from the schedule) and groups them by series, then by season. For each group, it decides the optimal search granularity:

If items span many seasons of the same series (more than half the total seasons, or at least 3), a single series search covers everything at the cost of one indexer query. If multiple items exist in the same season (2 or more, or more than 30% of the season's episodes), a season search is used. For isolated individual episodes, an episode search is used.

Critically, when a season or series search is selected, the planner expands the `covers_items` list to include every episode in that season or series — not just the ones that were "due." This means all covered items get their `last_searched_at` updated after dispatch, preventing them from immediately surfacing as "stale" in the next rotation tick.

The Radarr planner is simpler. Each movie is one indexer query regardless. The planner batches movies into groups of configurable size and sends them as a single `MoviesSearch` command (which accepts a list of movie IDs).

The planner is a Protocol (structural subtype), so each connector type provides its own implementation. The rotation engine doesn't know how planning works — it just asks the planner for commands and dispatches them.

### Search Command Types

Search commands are modeled as msgspec tagged union types. Each variant (EpisodeSearchCmd, SeasonSearchCmd, SeriesSearchCmd, MovieSearchCmd) carries the data needed to dispatch it and the list of schedule items it covers. The tag field enables pattern matching in the dispatcher — the match expression is exhaustive, so adding a new command type produces a type error everywhere it needs to be handled.

### Dispatch

The dispatcher takes planned commands, checks rate limits against the budget system, sends the appropriate *arr API call, and records the dispatched command with its *arr-assigned command ID. Dispatch is the I/O boundary — it handles the actual HTTP call via the connector client and records the result in the database.

After dispatching a command, the dispatcher immediately updates `last_searched_at` for all items in the command's `covers_items` list. This is the rotation mechanism — items move to the back of the line as soon as their search is dispatched, not when it completes. This prevents the rotation engine from re-dispatching searches for items that are already in-flight.

### Command Tracking

A separate tracking loop polls the *arr API for the status of dispatched commands. Both Sonarr and Radarr expose a `GET /api/v3/command/{id}` endpoint that returns the command's current status: queued, started, completed, failed, aborted, cancelled, or orphaned.

When a command reaches a terminal state, the tracker marks it as resolved. For completed commands, the tracker optionally triggers a targeted re-sync of the affected items to detect whether files appeared (the search found something and it downloaded). This re-sync updates the mirror and may change tier assignments — an item that was MISSING may become MONITORED if a file appeared.

For failed or timed-out commands, the tracker simply marks them as resolved. There is no retry logic — the items covered by the failed command will naturally surface again in rotation when they become the stalest items in their tier. This is the simplicity advantage of the rotation model over a queue with retry states.

### The Rotation Loop

The rotation engine runs a single async loop that ticks every 15–30 seconds (configurable). Each tick iterates over active connectors and for each one: queries the budget system for available command capacity, pulls the appropriate number of stalest items from the schedule, passes them to the connector's planner, dispatches the resulting commands, and updates the schedule. A separate concurrent loop handles command tracking on a 30-second interval.

User-initiated searches ("search now" from the UI) bypass the rotation entirely. They are stored in a separate `priority_searches` table and dispatched before any rotation items on the next tick, subject only to the concurrent command limit (not the daily budget). After dispatch, the item's `last_searched_at` is updated normally, integrating it back into the regular rotation.

---

## 11. Budget & Rate Limiting System

### The Core Problem

Comradarr must balance two competing pressures: searching as much content as possible (to maximize the chance of finding upgrades and recovering missing files) versus not exceeding indexer rate limits (which results in temporary bans, degraded service, or permanent account issues). The budget system resolves this tension.

### Budget Source Abstraction

The budget system is built around a `BudgetSource` Protocol with two implementations. The rotation engine depends on the Protocol, not a concrete implementation — it never knows whether budget intelligence comes from conservative defaults or from real Prowlarr data.

The Protocol defines three operations: `get_budget()` returns how many commands can be sent for a given connector right now, `report_dispatched()` records that a command was sent (for usage tracking), and `get_health()` returns the health status of the connector's indexers.

The `ConnectorBudget` response includes: the number of available commands, the daily limit, the number used today, and an optional human-readable reason explaining the current constraint (for display in the UI).

### Default Budget Source

Without Prowlarr, the budget source uses conservative configurable defaults. Each connector has a daily search command limit (default 100, meaning roughly 4 commands per hour across a 24-hour day), a maximum concurrent commands setting (default 2, meaning at most 2 in-flight commands per connector at any time), and a minimum interval between commands (default 30 seconds).

The default source spreads the daily budget evenly across the day rather than allowing burst consumption. If the daily budget is 100 commands and the rotation ticks every 30 seconds, that allows roughly one command every 14 minutes. This steady drip prevents the system from consuming the entire daily budget in the first hour and then sitting idle for 23 hours.

These defaults are configurable in the UI per connector, with explanatory hints. The intent is that most users will never need to change them — the defaults are safe for typical indexer configurations. Users with generous indexer limits or many indexers can increase them.

### Prowlarr-Aware Budget Source

When a Prowlarr connector is configured, the budget source becomes dramatically more intelligent. See Section 12 for full details.

### Rate Limiter Implementation

The rate limiter implements a compound constraint model: the available budget is the minimum of three independent limits. The daily remaining budget (how many commands are left in the day), the interval budget (how many commands are allowed in the current time window, computed by dividing the daily budget evenly across the day), and the concurrent limit (how many commands can be in-flight simultaneously).

The concurrent limit is particularly important because it controls how much load comradarr places on the *arr instance at any moment. A Sonarr instance processing 5 concurrent search commands is querying all of its indexers 5 times simultaneously. Keeping this low (2–3) prevents resource exhaustion on both the *arr instance and the indexers.

---

## 12. Prowlarr Integration

### Role of Prowlarr

Prowlarr is the *arr ecosystem's indexer manager. Most users configure their indexers in Prowlarr, which then syncs indexer configurations to Sonarr and Radarr. When Sonarr or Radarr sends a search command, the indexer queries are routed through Prowlarr.

Comradarr never talks to indexers directly. It sends search commands to Sonarr/Radarr, which query indexers (through Prowlarr or directly). Prowlarr's value to Comradarr is purely informational — it provides rate limit intelligence, usage statistics, and health status that Comradarr cannot obtain from Sonarr/Radarr alone.

Prowlarr integration is entirely optional. Comradarr functions fully without it, using conservative default budgets.

### What Prowlarr Provides

**Indexer Rate Limits** — via `GET /api/v1/indexer`, each indexer's capabilities include `limitsMax` and `limitsDefault`. These represent the indexer's API query limits, typically expressed as queries per day or per hour.

**Current Usage Statistics** — via `GET /api/v1/indexerstats` with date range parameters, Prowlarr reports per-indexer query counts, grab counts, and failure rates. This tells Comradarr how much of the budget has been consumed by all sources (Sonarr RSS sync, manual searches, other tools, and Comradarr itself).

**Indexer Health** — via `GET /api/v1/indexerstatus`, Prowlarr reports which indexers are currently disabled (temporarily banned or erroring), when they were disabled, and when they will be re-enabled.

**Application Mapping** — via `GET /api/v1/applications`, Prowlarr reports which Sonarr/Radarr instances it manages. By matching these against Comradarr's connector URLs, Comradarr determines which indexers serve which connectors.

### Intelligent Budget Computation

The Prowlarr-aware budget source fetches indexer data (cached with a 5-minute TTL to avoid hammering the Prowlarr API) and computes the budget based on the tightest constraint across all indexers.

The key insight: when a search command is sent to Sonarr, it queries *all* configured indexers. Therefore, the rate limit that matters is the most restrictive indexer. If one indexer allows 1,000 queries/day but another only allows 100, the effective daily budget is 100 (minus usage, minus a safety margin).

The safety margin is 20% — Comradarr never uses more than 80% of any indexer's limit. This headroom accommodates queries from other sources (RSS sync, manual searches, other tools) that are not under Comradarr's control.

The budget source normalizes hourly and daily limits to a per-interval rate so the rotation engine doesn't need to know the unit. An indexer allowing 100 queries/hour is treated differently from one allowing 2,400 queries/day, even though they average the same — the hourly-limited indexer has burst constraints that the daily-limited one does not.

### Indexer-to-Connector Mapping

A mapper component resolves which Prowlarr indexers serve which Comradarr connectors. It fetches Prowlarr's application list, matches each application to a Comradarr connector by URL, and then determines which indexers sync to that application (via Prowlarr's tag system). The mapping is cached and refreshed during sync.

When computing the budget for a specific connector, only the indexers that serve that connector are considered. If a user has separate indexers for movies vs TV, the Radarr connector's budget is not constrained by the TV-only indexers.

### Health Monitoring

A `ProwlarrHealthMonitor` background task periodically polls Prowlarr for indexer health and publishes events to the event bus. It detects three conditions:

**Indexer disabled** — an indexer has been temporarily disabled by Prowlarr (typically due to rate limiting or repeated failures). The event includes the disable duration and the failure timeline. The budget source automatically excludes disabled indexers from budget calculations.

**High failure rate** — an indexer is responding but failing more than 30% of queries. This indicates degradation that hasn't triggered a disable yet. The rotation engine can optionally reduce its command rate when indexers are degraded.

**Approaching limit** — an indexer has used more than 80% of its query limit. This is an informational warning for the user, surfaced in the dashboard.

### Settings Philosophy

Comradarr never allows direct configuration of indexer limits. If Prowlarr is connected, limits come from Prowlarr. If not, Comradarr uses its own conservative command-level defaults. The user can tune how aggressively Comradarr operates (daily command budget, concurrent limit), but they cannot set indexer-level query limits — that would create a risk of misconfiguration leading to indexer bans.

The connector detail page in the UI shows inherited information: which indexers are detected (via Prowlarr), what their limits are, current usage, and the computed effective budget. All of this is read-only.

---

## 13. Event System & Real-Time Communication

### In-Process Event Bus

The event bus is an async pub/sub system that runs in the same process as the rest of the application. Events are fire-and-forget from the publisher's perspective — publishing is non-blocking and never raises exceptions.

All events are msgspec Structs, which makes them trivially serializable to JSON for SSE transmission. Event types include: `SyncCompletedEvent`, `SyncFailedEvent`, `RotationSearchedEvent`, `TierChangedEvent`, `IndexerHealthEvent`, `ConnectorHealthEvent`, and `PrioritySearchCompletedEvent`.

The bus supports two subscription modes: type-specific (a handler receives only events of a specific type) and global (a handler receives every event). Type-specific subscriptions are used by internal services (for example, the budget source could listen for `RotationSearchedEvent` to update its usage count). Global subscription is used by the SSE stream and by the notification dispatcher (Section 14), which consumes every event and fans the matching ones out to external destinations via per-user routing rules.

### Server-Sent Events (SSE)

The SSE endpoint at `/api/events/stream` provides a persistent connection for real-time frontend updates. Each connected browser gets its own event queue via the global subscription mechanism. Events are serialized as SSE format with the event type as the SSE event name and the JSON-encoded struct as the data payload.

If a client's queue fills up (the client is consuming events slower than they are produced), events are dropped silently. This is acceptable because SSE clients automatically reconnect on disconnection, and the current state is always available via regular API calls. SSE events are for real-time notification, not for state replication.

The frontend connects to the SSE endpoint from a layout component and uses incoming events to trigger SvelteKit's `invalidate()` on relevant data dependencies. For example, a `SyncCompletedEvent` triggers invalidation of the dashboard and content browser data, causing SvelteKit to re-fetch from the backend's view endpoints.

### Why Not WebSockets

SSE was chosen over WebSockets because Comradarr's real-time needs are unidirectional (server-to-client only). The frontend never needs to push real-time data to the backend — mutations use standard HTTP requests via form actions. SSE is simpler to implement, works through reverse proxies without special configuration, auto-reconnects natively, and has lower overhead than WebSocket for this use pattern.

---

## 14. Notification System

### Purpose and Architectural Fit

Section 13's event bus delivers real-time updates to any browser tab the operator has open on Comradarr. The notification system extends that same surface outward — to Discord, Slack, email, generic HTTP webhooks, and the long tail of destinations self-hosters actually use — so that security and operational events reach the operator even when no Comradarr tab is open. The notification system is a consumer of the event bus, never a source of events; it translates internal events into external messages according to per-user routing rules and renders them through editable templates.

The design commitments are conservative and homelab-appropriate. The apprise library handles the long tail of destinations behind uniform URL strings. A generic HTTP webhook channel covers the "route it through my automation platform" case without forcing operators to learn apprise's URL schemes. SMTP rides on apprise's mail plugin rather than being a separate channel kind, with a guided UI that assembles the apprise URL from discrete host/port/credentials/TLS-mode fields. There is no durable delivery queue and no dead-letter store — individual delivery failures are best-effort with bounded retries and then dropped to the structured log stream, on the principle that a homelab operator discovering a misconfigured webhook will see the problem next time they open Comradarr and nothing is meaningfully lost.

The notification dispatcher is a long-lived service instantiated during the services lifespan alongside the sync coordinator and rotation engine (Section 6). It subscribes to the event bus globally, receives every event Comradarr publishes, and for each event consults the routing-rules table to resolve the set of (user, channel) pairs that match. For each pair it renders the appropriate template and hands the rendered message to the channel-specific sender. Channel sends are dispatched concurrently via `asyncio.TaskGroup` with per-send timeouts; one slow destination cannot block another. The subscriber loop itself never waits for delivery — it schedules the sends and returns immediately, so notification latency never backpressures the event bus or the SSE stream.

### Event Scope: System vs User

Every event that enters the notification system carries an explicit scope. System-scoped events — connector unreachable, indexer health flip, sync failing persistently on a connector — belong to no particular user; they describe the state of the system as a whole. User-scoped events — your priority search completed, a new session opened on your account, your API key was revoked — belong to a specific user identified by `user_id`.

Routing resolves accordingly. For system-scoped events, every user who holds the "receive system notifications" permission and has a matching routing rule receives the notification. For user-scoped events, only the owning user's matching routing rules fire. In v1 the single admin holds every permission, so the permission check is trivially satisfied; the scope distinction exists in the schema and the dispatcher so that the operator and viewer roles introduced post-v1 (Section 26) slot in without changes to the notification code path. A viewer, for example, will not receive system-level operational alerts under the same defaults an admin does.

### Channel Kinds

Three channel kinds are recognized in v1:

**apprise** — the long-tail destination kind. The channel config holds an apprise URL string: `discord://…`, `slack://…`, `mailtos://…`, `ntfys://…`, `gotifys://…`, `tgram://…`, `matrixs://…`, and so on. Apprise is BSD-2-Clause licensed, AGPL-3.0 compatible, and covers several dozen destination services with a single dependency. A single apprise URL can fan out to multiple destinations using apprise's own config-file syntax, but each Comradarr channel row holds exactly one URL string for simplicity; operators who want fan-out create multiple channels.

**webhook** — a generic HTTP POST target. The channel config holds a URL, an HTTP method (POST or PUT), optional HTTP headers (for bearer tokens or custom authentication), and a JSON body template that is rendered from the event payload. This kind exists specifically so operators can forward events into n8n, Huginn, their own scripts, or custom Slack apps without encoding those destinations into apprise URL strings. The body template follows the same constrained substitution language used for message templates (below).

**SMTP (guided apprise)** — not a distinct channel kind in storage, but a distinct configuration affordance in the UI. An operator who wants email opens a "Configure SMTP" UI that presents host, port, username, password, TLS mode, and optional per-channel TLS overrides as discrete fields. Two TLS modes are offered: implicit TLS on port 465 (connection-open negotiation) and STARTTLS on port 587 (the submission-port standard). The UI assembles the apprise `mailto://` or `mailtos://` URL under the hood with the chosen TLS mode encoded in the URL query string; the resulting channel row is indistinguishable from any other apprise channel at the storage and dispatch layers. Plaintext SMTP on port 25 is not offered in the guided UI — an operator who needs it can hand-write a `mailto://` URL in the raw-apprise-URL path, accepting the absence of transport security.

### Channel Configuration and Secret Storage

Every channel's configuration contains at least one secret. An apprise URL embeds tokens or passwords for its destination service. A webhook's authorization header is secret material. An SMTP password is obviously so. Channel secrets are stored using the four-column AES-256-GCM encrypted-field layout introduced in Section 15 for connector API keys: a nonce column, a ciphertext column, an auth-tag column, and a key-version column. The channel's primary key UUID is used as AAD, binding each ciphertext to the specific row it belongs in. This reuses the exact storage pattern used for connector credentials, OIDC client secrets, and setup-claim proofs, with no parallel crypto machinery introduced.

The non-secret portion of the channel configuration — name, kind, enabled flag, last-tested-at, last-test-status, per-channel TLS overrides — lives in regular columns on the channels table. Only the sensitive payload (the apprise URL, or the webhook's URL/method/headers/body-template bundle) is encrypted.

### Test-Before-Commit for Channel Configuration

Every channel save triggers a live test before the new configuration is persisted. For an apprise channel, the test is an `Apprise.notify()` call with a fixed "Comradarr notification test" message. For a webhook channel, the test is an HTTP request with a documented `{"event": "test", …}` body. Success persists the channel and updates `last_tested_at` and `last_test_status` to `ok`. Failure returns the specific error to the operator — SMTP TLS handshake failure, webhook 404, apprise URL parse error, unreachable host — and leaves the previous saved config active; a channel is never committed to a broken state.

This mirrors the test-driven configuration pattern applied throughout the HTTP boundary (Section 16) and the wizard's HTTP boundary verification phase (Section 15). An operator cannot save a Discord webhook URL with a typo and discover days later that security alerts never fired, because the typo surfaces at save time against the actual destination.

### Outbound Target Hardening

Webhook URLs and apprise URLs that wrap HTTP destinations go through the same SSRF defenses as connector URLs (Section 7). At save time, the resolved hostname is classified against the `COMRADARR_CONNECTOR_URL_POLICY` policy; destinations that fail classification are rejected with a specific error. At send time, the hostname is re-resolved and re-classified, defeating DNS rebinding attacks where an attacker-controlled domain returns a benign IP at save time and a metadata-endpoint IP thereafter. The TLS posture mirrors connectors: verification enabled by default, with per-channel `insecure_skip_tls_verify` and `tls_ca_bundle_path` overrides available for homelab operators whose destination endpoints use self-signed certificates or private CAs.

Using one classification policy across both the connector and notification subsystems is deliberate. The threat model for a compromised admin account using the channel-URL field to probe cloud metadata is identical to the threat model for the connector-URL field; splitting policies would create a surface where one restriction is tighter than the other for no security benefit and would give an attacker a second place to look for the weaker setting. Apprise URLs targeting non-HTTP transports (Matrix, Telegram over HTTPS, SMTP hosts) go through a transport-appropriate hardening pass: SMTP hosts are classified against the same policy as HTTP hosts, Matrix and Telegram rely on apprise's own TLS-verified clients with certificate verification enabled by default.

### Routing Rules

Routing is expressed as rows in the `notification_routes` table: each row binds a `(user_id, event_type, channel_id)` tuple with an enabled flag. A single event fires one notification per matching enabled row. Multiple rows for the same user and event type fan out the same notification to multiple channels (Discord and email simultaneously, for instance). A user with no matching routing rules for an event receives no notification — the absence of a rule is the off-switch, and there is no separate "mute" state to manage.

The routing-rule UI presents the set of event types grouped by category (security, operational health, user-initiated) as a matrix against the user's configured channels. Each cell is a toggle. The dispatcher reads the enabled rows once per event via an indexed lookup on `(user_id, event_type)`.

v1 does not support predicate filters — a rule that fires only when the connector name equals a specific value, for example. The schema includes a nullable predicate column reserved for post-v1 filtering; v1 populates it with null on every row. The rationale is the same as the routing-row approach generally: the complexity of a predicate language is not justified by a single-admin deployment, but the schema column exists so that predicates can be added later without a migration that touches existing rows.

### Default Routing Profile

When a user creates their first channel, a default set of routing rules is inserted for that `(user, channel)` pair. Subsequent channels are created with no routes enabled by default — the defaults are a one-time onboarding convenience, not a channel-provisioning behavior. A user who disables the "new session" notification on their first channel and then creates a second channel does not get "new session" re-enabled on the second channel, because the second channel is routed per the user's explicit choices.

Enabled by default for any user's first channel:

- **Security.** New session opened on the account. Password changed on the account. API key created or revoked on the account. For admins, a burst of failed logins against any account (5+ within 5 minutes).
- **Operational health (admin only).** Connector reachability changed (healthy → unreachable or vice versa). Indexer disabled or re-enabled (coalesced — see below). Sync failing persistently on a connector (3 or more consecutive failures, not transient). Budget threshold crossed (default: 80% of daily cap consumed).
- **User-initiated.** Priority search completed.

Disabled by default but available to enable:

- Tier-change events (high volume — most libraries produce many of these per day).
- Per-cycle sync and rotation completions (firmly SSE territory, surfaced here for completeness).
- Connector add, edit, or delete events (audit-log-worthy, rarely push-worthy).

The defaults are defined in code and seeded at first-channel-creation.

### Template System

Every notification renders from a template. Templates exist in two tiers: built-in defaults that ship with the application and flow through the Weblate translation pipeline, and per-user overrides stored verbatim and not translated.

#### The Constrained Substitution Language

Templates use a deliberately small substitution language with exactly two constructs: variable interpolation written as `{{variable_name}}`, and a single conditional form written as `{{#if variable_name}}…{{/if}}` for optional fields. There are no nested conditionals, no loops, no arbitrary expressions, no method calls, no attribute access, and no computed values. The rendering engine is a straightforward regex-driven pass that substitutes variables and strips conditional blocks whose guard is absent or null.

The constraints are motivated primarily by security: a template stored in the database and editable by an admin account is reachable by any attacker who compromises that account, and a template language with expression evaluation is a server-side template injection surface. The constrained form has no code-execution surface — the worst an attacker-written template can do is render mangled text. The constraints are also motivated by translator ergonomics: Weblate's placeholder validation natively understands `{{…}}` markers and warns translators who drop or malform a placeholder, so there is no custom Weblate integration to maintain. And the expressiveness matches the actual need — every realistic notification template is variable-substitution-plus-optional-fields; nothing in Comradarr's notification surface requires a loop or a computed value in a Discord alert.

Each event type has a documented set of available variables. A connector-unreachable event exposes `connector_name`, `connector_type`, `connector_url`, `since_time`, and `last_error`. A new-session event exposes `user_name`, `session_ip`, `session_user_agent`, and `session_created_at`. These are published in-UI as a copy-paste reference alongside the template-editing surface, so an operator editing a template sees the available variables in context.

#### Built-In Defaults and Weblate Integration

Built-in default templates ship with the application as gettext message keys in the backend `.po` catalogs (Section 28), following the naming convention `notification.{event_type}.{channel_kind}.subject` and `notification.{event_type}.{channel_kind}.body`. Weblate sees these exactly like any other translatable string in the backend; translators localize them in Weblate's UI; Weblate's placeholder validator catches mistakes at translation time. The backend catalog is therefore the single source of truth for what variables an event exposes, because a translator depending on Weblate's placeholder validation needs the source English template to list the real set.

At send time, the built-in template is resolved by looking up the gettext key in the recipient user's preferred locale (from `user_preferences.locale`), falling back to the source English string if no translation exists for the locale. This is the same fallback policy used throughout the i18n system for any other translatable string.

#### User Overrides

A user may override the built-in default for any `(event_type, channel_kind)` pair. Override rows live in the `notification_templates` table, keyed by `(user_id, event_type, channel_kind)`, and store the `subject_template` and `body_template` verbatim. Override rows are not translated — the user wrote those words deliberately in a language they chose, and the system respects them without running them through gettext. A user who wants overrides in multiple languages writes multiple override rows keyed on their preferred language, but v1 does not surface this in the UI; the v1 override UI is single-language per user.

Editing an override in the UI loads the English default as the starting text so the operator sees the available variables in context without having to cross-reference documentation. Deleting an override row reverts the user to the translated built-in.

#### Lookup Order at Send Time

For each notification to be delivered, the renderer resolves the template in this order: user override for the `(user_id, event_type, channel_kind)` triple if one exists; otherwise the translated built-in for the recipient's locale; otherwise the English built-in. One lookup, one render, no merging. This keeps the semantic simple: a user override completely replaces the default, and a translation completely replaces the English source.

### Delivery Semantics

Each notification attempt is bounded on both the timeout axis and the retry axis. The initial attempt uses a 10-second timeout. On failure, the attempt is retried after 1 second with a 15-second timeout, then after 5 seconds with a 20-second timeout, then after 30 seconds with a 30-second timeout. Three retries total after the initial attempt, then the adapter abandons the send and logs a WARN entry to the structured log stream with the event type, the target channel name (not its decrypted config), and a structured error summary.

Delivery is fire-and-forget from the event-bus subscriber's perspective. The dispatcher schedules sends on an `asyncio.TaskGroup` and returns immediately to the subscriber loop; the subscriber never awaits delivery. A slow or dead destination cannot backpressure the event bus, and it cannot accumulate a backlog — the retry budget is bounded per notification, and abandoned notifications are simply gone.

There is no dead-letter queue. There is no delivery-attempt table. The structured log stream is the delivery record; an operator investigating "why didn't I get that alert" greps the log for the event type and destination name. This is a deliberate simplicity choice: durable notification delivery is a non-goal for a single-user homelab tool, and a durable queue would introduce operational surface (retention, retry scheduling, dead-letter handling, recovery semantics on crash) that is not justified by the v1 audience.

### Coalescing

Bursts of similar events would produce a stream of redundant notifications that trains the operator to ignore them. Twenty indexers going unreachable in the same Prowlarr poll, a cascade of sync failures across multiple connectors during a network blip, a burst of reconnections after a homelab router reboot — without coalescing, each would fire a separate notification.

The dispatcher coalesces within the operational-health category over a 60-second rolling window. When the first event in the category arrives, a coalescing timer starts; events arriving during the window are accumulated in memory; when the window expires, a single grouped notification is rendered from a summary template that lists what changed. The summary template is translatable through the same gettext pipeline as any other notification template.

Security events and user-initiated events do not coalesce. A new session opening on an account is always a single notification regardless of other activity — coalescing there would mask individual events the operator needs to see distinctly, and the volume is low enough that redundancy is not a concern.

The 60-second window is a single constant in code, not configuration. If the behavior proves wrong in practice for real operators, the constant is a one-line change rather than a configuration surface to design.

### Audit Log vs Structured Log Boundary

The notification subsystem respects the same audit-versus-structured-log boundary drawn throughout the rest of the application (Section 20). Channel creation, edit, and deletion are audit-log actions. Routing rule changes are audit-log actions. Template override writes and deletions are audit-log actions. These are operator-initiated configuration changes and belong in the record of "who changed what."

Individual notification deliveries are structured-log territory. Every attempt logs at DEBUG level on success and WARN on permanent failure after retries are exhausted. Event names follow the `notification.delivery.sent` and `notification.delivery.failed` convention established in Section 20, so log consumers can filter the notification surface cleanly. This matches the same boundary drawn for authentication events (successful logins audit-logged; the HTTP request itself structured-logged) and for sync operations (sync completion structured-logged; the connector edit that changed the sync interval audit-logged).

The rationale for keeping deliveries out of the audit log is volume — a busy deployment with a dozen routing rules across five channels produces hundreds of delivery events per day, none of which answer the "who changed what" question the audit log exists to answer.

### Kill Switch and Configuration Model

The notification subsystem introduces no new environment variables. Channels, routes, and template overrides are runtime configuration in the database, edited through the post-setup UI, subject to the two-tier configuration model described in Section 19. The apprise dependency ships as a regular locked dependency under the supply chain discipline from Section 23, with lockfile-enforced install and vulnerability scanning applied uniformly.

A single operator-facing setting lives in `app_config` as a global kill switch: `notifications_enabled`. When false, the dispatcher's event-bus subscriber remains active but every delivery short-circuits to a no-op before any adapter is invoked. This lets an operator silence the notification system during maintenance windows, debugging, or extended network outages without deleting their channel configuration or disabling routes one by one. The default is true. The settings UI surfaces the kill switch as a prominent toggle with a banner that appears on every notification-related settings page whenever notifications are suppressed, so the state is impossible to forget.

---

## 15. Authentication & Security

### Authentication Model

Comradarr uses session-based authentication with HttpOnly cookies as the universal session representation, but the means by which a user becomes authenticated is pluggable. Three authentication providers are supported out of the box: local password (the default), trusted-header (for deployments behind authelia, authentik, tinyauth, traefik ForwardAuth, and similar), and OIDC (for direct identity provider integration). All three can coexist in a single deployment; the operator chooses which to enable.

#### The Provider Abstraction

Every authentication path in Comradarr is implemented as an `AuthProvider` — a structural interface with a single conceptual operation: given an incoming request, either produce an authenticated user or decline. Providers are registered in a configured order and the auth middleware walks them on each request until one succeeds. A successful provider result includes the resolved user and an identifier for which provider authenticated, recorded on the session row for audit purposes.

The registration order is fixed and reflects the security and performance profile of each mechanism: session cookie check first (the cheapest and most common case — a user with an active session), then trusted-header if enabled, then OIDC callback handling if a callback is in-flight, with local password form authentication as the fall-through for unauthenticated users who should see the login page. API key authentication is checked separately on API-only endpoints before falling into the session-cookie flow. Adding a future provider (LDAP, SAML, mTLS) is an addition to this chain, not a restructuring.

This abstraction is what makes the three providers coexist cleanly. A deployment can enable local password plus trusted-header (the common homelab pattern where authelia handles most access and local password is the break-glass). A deployment can enable OIDC plus local password (the pattern where most users sign in via authentik but the bootstrap admin retains local login). A deployment can enable all three. Downstream code — the session model, authorization checks, API key creation, audit logging — does not care which provider authenticated the user.

#### Local Password Provider

The default and most thoroughly specified provider. The user submits a username and password to the login endpoint; the backend looks up the user row by username; if found, the password is verified against the stored Argon2id hash using the parameters described in Section 15's Credential and Secret Handling; if the stored hash's parameters are outdated, the password is rehashed under current parameters and the user row is updated atomically with the successful login; a new session is created. If the username is not found, a dummy Argon2id verification runs against a fixed placeholder hash to match the timing of a real verification — this prevents username enumeration via response-time analysis. The error returned on any failure is a single generic "invalid credentials" message; there is no distinction between "unknown username" and "wrong password" in the response surface.

The login endpoint is rate-limited on both axes described below in the Rate Limiting subsection. The response always takes approximately the same time whether the user exists or not, and whether the password is correct or not (a correct password returns after the Argon2id verification; an incorrect password returns after the same verification plus the failure-recording path).

Local password authentication can be disabled entirely with `COMRADARR_DISABLE_LOCAL_LOGIN=1`. When disabled, the login form is not rendered, the login endpoint returns 403, and the only paths into the application are trusted-header and OIDC. The bootstrap admin account created during setup remains in the database regardless — it is a break-glass account that can be re-enabled by clearing the disable flag if the operator's IdP breaks.

#### Trusted-Header Provider

The trusted-header provider is for deployments where a reverse proxy (authelia, authentik, tinyauth, traefik ForwardAuth, nginx auth_request, or any other HTTP-level auth proxy) handles authentication upstream and forwards the authenticated request to Comradarr with an identity header. Comradarr trusts the header because it trusts the specific network peer that attached it.

The security of this provider hinges entirely on correctly identifying which peers are trusted. Getting this wrong is the single most common mistake in trusted-header implementations and is the difference between a legitimate proxy auth feature and a trivial authentication bypass. The design below is written to make the wrong thing structurally difficult.

**Trusted proxy allowlist.** The operator configures the list of IP addresses and CIDR ranges that are trusted to attach authentication headers through the post-setup UI — not through an environment variable. Adding a peer to this list means that any request from that peer, bearing the configured identity header, will authenticate as whatever user the header names, so the UI surrounds this action with deliberate friction: a confirmation modal that states in plain language "Adding this IP or range grants permission to log in as any user by setting an HTTP header. Only proceed if you control every host in this range and every process on it. Do you want to continue?" The confirmation must be typed-out rather than clicked, because a click-through is too easy to do reflexively. The resulting list is persisted to app_config, and every entry in the audit log for the resulting login records both the authenticating user and the trusted-proxy IP that attached the identity header, so a later forensic review can trace "which peer said this was user X."

Typical entries for Docker-based deployments include Docker's default bridge network range, specific container IPs for fixed-address deployments, or the loopback addresses for same-host proxy setups. Kubernetes deployments typically use the pod network range. The list is parsed into a fast-lookup structure at every read; invalid entries are rejected at the form level with a specific error rather than accepted and later silently ignored. An empty list disables the trusted-header provider entirely — this is the default state, and the provider becomes usable only after the operator has both enabled it and populated the allowlist.

The list is separate from the reverse-proxy-forwarding allowlist described in Section 16 because the populations may differ. The proxy that handles general request forwarding may not be the same proxy authorized to attach identity headers, and conflating them would grant more trust than intended to either set.

**Socket peer address, never headers.** The IP check uses the TCP socket's peer address as seen by Granian. It never consults X-Forwarded-For, X-Real-IP, or any other header-based source — those are attacker-controllable when the peer isn't yet trusted, which is exactly the condition we're trying to evaluate. This is stated as an explicit invariant in the code and enforced by the middleware: the socket peer is the only input to the trusted-proxy check, and the check happens before any header is read.

**Header configuration.** The header containing the username is configured through the post-setup UI when trusted-header auth is enabled (common values are well-known for each upstream: Remote-User for authelia and traefik ForwardAuth, X-authentik-username for authentik, X-Forwarded-User for nginx-ingress auth — the UI offers these as presets along with a custom option). A companion email header is optionally specified, which when set becomes the preferred user-lookup key (email is typically a more stable identifier than username across identity-provider configurations). Only one header name per role is supported; operators running multiple proxies should normalize at the proxy layer rather than at Comradarr.

**User matching and provisioning.** When a trusted header arrives and the peer is in the allowlist, Comradarr maps the header value to a user row using a configurable policy. The default is auto-provision: if the header's email (or username, when no email is present) matches an existing user, that user is used; otherwise a new user row is created with the name from the header, a placeholder password hash explicitly marked as unusable for local login (using a distinctive non-hashable sentinel so local password auth cannot ever succeed against these rows), and the default role. A strict-match setting switches this to refuse authentication for unknown identities — they must be pre-created by an administrator.

**Session creation.** When a trusted-header authentication succeeds, a normal Comradarr session is created — the same session row, the same cookie, the same lifetime as a local-password login. The session row records the authenticating provider as trusted-header. Subsequent requests authenticate via the cookie and do not re-validate the header on every request (which would break if the proxy ever changed behavior and would add unnecessary load). The cookie path makes the user experience identical regardless of provider.

**Logout.** A configurable logout-redirect URL in the trusted-header settings specifies where the logout handler redirects after clearing the Comradarr session. Typical values reference the proxy's sign-out endpoint (authentik's outpost sign-out route, authelia's logout portal, and similar). Without this, clicking logout in Comradarr is meaningless — the proxy will re-authenticate the user on the next request. When the trusted-header provider is enabled, the settings UI flags a missing logout URL as a warning.

**Coexistence with local password.** By default, trusted-header and local password coexist: users can come through the proxy or go directly. This is important for operational reasons — if the proxy breaks, the operator can still log in locally. Operators who want exclusive proxy auth set the `COMRADARR_DISABLE_LOCAL_LOGIN` environment variable as described above. The trusted-header provider never conflicts with local password; the two never collide because trusted-header runs before local password in the provider chain, and local password requires an explicit form submission to the login endpoint which the proxy will have intercepted.

#### OIDC Provider

The OIDC provider makes Comradarr a direct OpenID Connect relying party, able to authenticate users against authentik, authelia, Keycloak, Auth0, Okta, Google Workspace, or any other OIDC-compliant identity provider. Unlike trusted-header auth, OIDC does not require a reverse proxy in the authentication path — Comradarr speaks the protocol directly.

**Provider configuration.** Multiple OIDC providers can be configured simultaneously; each is identified by a short name used in the configuration surface and displayed to the user on the login page. Per-provider configuration includes an issuer URL (from which the OIDC discovery document is fetched at startup, yielding the authorization, token, and JWKS endpoints), a client ID, a client secret (stored as an encrypted field using the four-column AES-GCM layout from Section 15, with the provider name as AAD), the redirect URI Comradarr advertises to the IdP, and the scope list to request (minimally `openid email profile`). The configuration surface uses prefixed environment variables: `COMRADARR_OIDC_<NAME>_ISSUER`, `COMRADARR_OIDC_<NAME>_CLIENT_ID`, `COMRADARR_OIDC_<NAME>_CLIENT_SECRET` (or `_FILE` equivalent), `COMRADARR_OIDC_<NAME>_DISPLAY_NAME`.

**Discovery and JWKS.** At startup and on a periodic refresh cycle (every 24 hours by default, with earlier refresh on signature validation failure), Comradarr fetches each provider's OIDC discovery document and JWKS. The JWKS is cached in memory; signature validation on incoming ID tokens uses the cached keys. Cache refresh on validation failure handles key rotation gracefully — if the IdP rotates its signing key, the next failing token triggers a refresh and the retry succeeds with the new key. Discovery document fetching uses the same hardened HTTP client as everything else in Comradarr (TLS verification on, timeouts bounded, response size capped).

**Flow.** The login page displays a "Sign in with <display name>" button for each configured provider alongside the local password form (if enabled). Clicking the button initiates the authorization code flow with PKCE. PKCE is mandatory on every flow regardless of client classification — there is no non-PKCE path. The state parameter carries a CSRF-protected nonce bound to the browser's pre-auth session; the nonce is validated on callback to prevent cross-session authorization code injection. The callback endpoint receives the authorization code, exchanges it for tokens at the provider's token endpoint, validates the ID token's signature against the cached JWKS, validates the `iss`, `aud`, `exp`, `iat`, and `nonce` claims, and extracts the user identity from `sub`, `email`, and `preferred_username`. User matching and provisioning follow the same policy as the trusted-header provider — email-first with auto-provisioning by default, strict-match available via configuration.

**Library choice.** OIDC implementations are a historically rich source of authentication CVEs, and rolling a custom client is not considered. The implementation uses a well-audited library — the defensible choices in the Python ecosystem at the time of writing are `authlib` and `joserfc`. The selection criterion is active maintenance, clean separation between JOSE primitives and OIDC flow logic, and a track record of prompt security response. `python-jose` is explicitly rejected due to its history of unresolved signature validation issues.

**Session creation and logout.** Successful OIDC authentication creates a normal Comradarr session with `auth_provider` set to `oidc` and a reference to which provider (by name) authenticated. The session cookie behaves identically to local-password and trusted-header sessions. Logout clears the Comradarr session and, if the provider's discovery document advertises an `end_session_endpoint`, redirects the user there to terminate the IdP session as well. Without RP-initiated logout, the Comradarr session ends but the IdP's session persists, which is typically what single-sign-on users expect anyway.

**Account linking policy.** If local password auth is also enabled and a user with email `alice@example.com` already exists as a local-password user, the OIDC provider's behavior when `alice@example.com` arrives via OIDC is governed by a configurable policy. The default is `link`: the existing user row is used, and the session records that this session was authenticated via OIDC rather than via the stored password hash — the local password remains usable for direct login but is not required for the OIDC flow. The alternative policy `require_separate` refuses to authenticate via OIDC if a local-password user with the same email exists, forcing the operator to delete the local user first. The default reflects the common case of "I created a local admin during setup, now I want to add OIDC and continue using the same account."

#### Session Lifecycle

Sessions are rows in the `sessions` table keyed by the SHA-256 hash of the session token (Section 15). Each session has an absolute lifetime, an idle lifetime, and timestamps tracking creation, expiry, and most recent activity.

**Absolute and idle timeouts.** The absolute timeout is the maximum lifetime from creation regardless of activity; default 30 days. The idle timeout is the maximum inactivity window between requests; default 7 days. A session expires when either timeout is hit, whichever comes first. Both are configurable, but the defaults reflect a balance between convenience (not logging in every week) and exposure (a cookie leaked to an archive is not a lifetime credential).

**Activity tracking.** On every authenticated request, `last_seen_at` is updated to the current time. This is a best-effort update — if the database write fails, the request still succeeds; authentication is not allowed to fail because of an activity-logging write. The update path is therefore fire-and-forget after the session validation has already succeeded.

**Session rotation on privilege change.** Any operation that changes the user's authentication state — password change, role assignment (future), account settings touching security-relevant fields — rotates the current session. A new random token is generated, its hash replaces the current session row's hash, and the cookie is updated on the response. This defends against the narrow case of a briefly-compromised session cookie continuing to grant access after the user has responded to the compromise.

**Concurrent sessions.** A user can have any number of active sessions simultaneously. The session list UI shows each active session with its creation time, last-seen time, source IP, and user-agent, and offers individual revocation as well as a "revoke all other sessions" action. The IP and user-agent fields are informational — they are never used for authorization decisions, because enforcing IP-stability as an auth requirement breaks users on mobile networks, users behind load-balancers with multiple egress IPs, and users on VPNs.

**Revocation.** Revoking a session deletes its row from the database rather than marking it expired — there is no ambiguity about whether a replayed cookie might still match. The next request bearing the revoked cookie finds no row and returns 401. This includes logout, which is a self-revocation: the session row is deleted and the cookie is cleared on the response.

#### API Key Lifecycle

Comradarr's own API keys (for external programmatic access to Comradarr's API) inherit their storage design from Section 15 — stored as SHA-256 hashes with the `cmrr_live_` prefix and last-four display. The operational surface:

**Creation.** A user visits the API keys settings page, clicks "create new key", enters a human-readable name (for their own reference — "homeassistant integration", "tautulli webhook"), optionally sets an expiry, and confirms. The plaintext key is displayed exactly once with a prominent "this will never be shown again" warning and a copy-to-clipboard action. Navigating away makes the plaintext irretrievable.

**Scope.** API keys inherit the privileges of the user who created them. There is no separate scope configuration in v1; when roles are eventually introduced, API key scope will be a subset of the owning user's scope evaluated on each request rather than frozen at creation, so role changes propagate to API keys without requiring re-creation.

**Revocation.** Each key can be revoked individually from the settings UI. Revocation is immediate — the row is deleted (or marked revoked, to preserve audit history; behavior TBD) and the next request using that key fails with 401. There is no grace period.

**Last-used tracking.** Every successful authentication with an API key updates a `last_used_at` timestamp and optionally the source IP. Like session activity tracking, this is a best-effort fire-and-forget write after the auth check has already succeeded. The list UI surfaces this prominently — "which of my 5 API keys are actually in use" is the single most useful piece of information for a user managing keys.

**Rate limiting.** Failed API key authentications are rate-limited per source IP, not per key — per-key limiting is trivially defeated by rotating through guessed keys. Successful authentications flow through normal API throttling and are not auth-rate-limited.

#### Rate Limiting and Abuse Resistance

Authentication endpoints are natural targets for credential stuffing, username enumeration, and brute-force attacks, and defensive rate limiting is applied at two dimensions.

**Per-IP limits** defend against an attacker hammering endpoints from a single source. The default is 10 login attempts per minute per source IP, with a longer window for sustained attacks (50 attempts per hour). Exceeding the limit returns 429 with a `Retry-After` header. The limits are deliberately loose for legitimate users (a human typing the wrong password a few times is not penalized) and tight for automated attacks.

**Per-username backoff** defends against distributed attacks where an attacker uses many IPs to stay under per-IP limits. After repeated failed attempts on a given username, subsequent attempts incur an artificial delay that doubles per failure up to a ceiling (1s, 2s, 4s, 8s, 16s, capped at 60s). The backoff state is keyed by the submitted username string, not the user_id, so the timing characteristics are identical whether the username exists or not — no enumeration via backoff observation. Successful authentication clears the backoff state for that username.

**Hard lockout is rejected.** Locking an account after N failures creates a denial-of-service vector: an attacker can lock any user out by attempting logins with their username. Backoff imposes mild friction on legitimate users during an attack while preventing automated cracking, without offering a lockout-as-a-DoS primitive to attackers.

**Storage.** Rate limit state lives in a hybrid arrangement: a hot-path in-memory counter with periodic eviction, backed by a database table that persists across restarts. The in-memory layer handles the common case cheaply; the database layer ensures that a persistent attacker cannot reset their limits by cycling the Comradarr container.

**What's limited.** The local-password login endpoint, the bootstrap claim endpoint (Section 15), the password change endpoint (which validates the current password and is itself brute-forceable), and API key authentication failures. The OIDC callback endpoint is not rate-limited in the same way — its abuse model is different (the attacker would need to hijack the state parameter), and rate limiting there would break legitimate retry behavior after transient IdP errors. The trusted-header provider does not rate-limit per se; if the trusted peer is sending bogus headers, the problem is upstream, not something Comradarr can defend against from within its own process.

#### Password Change and Recovery

**Password change (authenticated user).** The user submits the current password plus the new password. The current password is verified against the Argon2id hash; on success, the new password is hashed under current parameters and stored atomically with session rotation — a new session token is generated, the current session's hash is replaced, and all other sessions for this user are revoked (on the assumption that a password change may be responding to a suspected compromise, and the user wants every attacker session killed). The endpoint is rate-limited per user on the current-password validation step.

**Password recovery (forgotten password).** Comradarr does not provide an in-application password reset flow — no email-based reset (which would require SMTP configuration and introduces a whole class of token-handling concerns for a self-hosted tool used primarily by one operator), no security questions, nothing in-band. Recovery is handled by a bootstrap-token-style mechanism reusing the existing Section 15 machinery: the operator sets `COMRADARR_RECOVERY_MODE=1`, restarts the container, reads the newly-generated recovery token from the logs (same format and TTL as a bootstrap token), and uses it to claim a password-reset flow that replaces the admin account's password. On successful recovery, the recovery-mode flag is cleared. This reuses the "log access = privilege" trust model from bootstrap: anyone who can read the container's logs has a level of access that already implies control over the instance.

#### Cookie Attributes and CSRF Defense

Cookie attributes (the `HttpOnly`, `Secure`, `SameSite`, and `Path` settings on the session and setup-claim cookies, plus the `COMRADARR_INSECURE_COOKIES` development opt-out) and CSRF defenses (the `Origin` / `Referer` validation against the allowed-origins list, the SvelteKit form-actions interaction, and the API-key exemption) are specified in Section 16: HTTP Boundary Hardening. Both are HTTP transport concerns rather than authentication primitives, and they apply uniformly across authenticated and unauthenticated endpoints — Section 16 is the single source of truth for them.

### First-Run Setup & Bootstrap

#### The Bootstrap Threat Model

The bootstrap problem is "how does the very first user prove they are the legitimate owner of a freshly installed instance, without any pre-existing credentials, and without shipping a default password?" Default credentials, environment-variable-based admin passwords (which leak into process listings, container inspect output, and shell history), and "first browser to reach the install wins" approaches are all common in self-hosted software and all dangerous. Comradarr takes the position that ownership of a fresh install must be proven by demonstrating access to the running process's logs — a privilege that already implies meaningful access (container exec, host access, or the ability to read the application's stdout). This is the same mental model security-conscious projects like Vault and Authelia use, and it is what Comradarr's bootstrap flow is designed around.

#### Three Distinct Credentials

First-run authentication uses three separate credentials with different lifetimes, storage characteristics, and scopes. They are deliberately not collapsed into a single token because each one defends against a different class of failure.

The **bootstrap token** is a one-time proof of log access. It is generated in process memory at startup if and only if setup is incomplete, printed to the application's stdout and to a file on disk, and never persisted to the database. It is sized for at least 80 bits of entropy, uses a Crockford base32 alphabet (no ambiguous 0/O/1/I/L characters that lead to typos), and is formatted in hyphen-separated five-character segments for readability when typed manually. It expires after 15 minutes by default. Its only purpose is to authorize a single action: claiming the setup wizard.

The **setup-claim cookie** proves that a specific browser owns the in-progress setup wizard. It is created when the bootstrap token is successfully validated by the claim endpoint, scoped strictly to the setup path, marked HttpOnly, Secure, and SameSite=Strict, and given a 10-minute sliding TTL that renews on each successful wizard action. Its purpose is to prevent another browser (or another tab) from hijacking the wizard mid-flow while the legitimate operator is partway through.

The **admin session** is the real long-lived authentication credential. It is created only when the wizard reaches successful completion, never earlier. From this point on, the bootstrap token is cleared, the setup-claim cookie is deleted, and the user is treated like any other authenticated admin.

#### TTL Ordering Is Intentional

The bootstrap token TTL (15 minutes) is deliberately longer than the setup-claim TTL (10 minutes). This ordering creates an intentional recovery path: if a user gets distracted partway through the wizard for 11 minutes and their claim cookie expires, they can re-paste the bootstrap token and reclaim the wizard rather than restarting the entire process. If 16 minutes pass, both have expired, and a process restart is required to generate a new token. This handles the realistic "I went to make coffee" case without compromising security.

#### Setup State Detection

A single configuration key, `setup_completed`, drives all setup state decisions. It is set to the string `"false"` the moment any setup-related state changes (notably, when the admin account is created), and only to `"true"` at the final completion step. The explicit `"false"` value is critical: it prevents an interrupted setup that has already created an admin account from being mistakenly identified as complete on the next startup just because an admin row exists in the database. There is no legacy fallback to admin-existence checks because Comradarr is a greenfield project — the explicit key is always authoritative.

#### Setup Gate Middleware

While `setup_completed` is not `"true"`, a middleware layer redirects all non-setup requests to the setup page. The allowlist is intentionally minimal: the setup routes themselves, the health endpoint, and the static assets required for the setup UI to render. Every other endpoint — the API, the OpenAPI spec, the event stream — returns 503 or redirects to setup. This ensures no functionality is reachable before authentication is established, even by accident, and removes the possibility of an attacker probing the API surface during the bootstrap window.

#### Token Generation and Visibility

When the setup gate determines that setup is incomplete, the application generates a bootstrap token and emits it through two channels simultaneously: the application's stdout/stderr (the conventional Docker logs path), and a file at a documented location with restrictive 0600 permissions. Two channels exist because real-world deployments swallow stdout in inconsistent ways — orchestration tools, log shippers, and daemon mode all behave differently. The file is auto-deleted on either successful claim or token expiry to prevent stale tokens from accumulating on disk.

The token is printed inside a visually distinctive banner with prominent separators, the token itself, the suggested setup URL (derived from the configured origin or host/port, with bind-all addresses substituted to localhost for the URL), the absolute expiry time, and a brief explanation of what the token is for. The banner is designed to stand out in a noisy startup log stream where it would otherwise scroll past between framework initialization, sync engine startup, database migration logs, and other normal output. The setup URL is a convenience and may not be reachable from the user's actual location (reverse proxy, different domain, port mapping) — the banner explicitly says so and instructs users to navigate to their own Comradarr URL with the setup path appended if needed.

#### Token URL Handling on the Frontend

When the user follows the printed setup URL, the bootstrap token arrives as a query parameter. The setup page pre-fills the token input field for convenience, then immediately strips the query parameter from the displayed URL via the History API. This prevents the token from being captured in browser history, screenshots, or HTTP referrer headers if any external resource is loaded from the setup page. The backend has already received the token before stripping occurs, so functionality is preserved while the disclosure surface is reduced.

#### Claim Flow

The single setup endpoint that accepts the bootstrap token performs the following sequence, in order: it checks whether an active claim already exists from the requesting browser (in which case it renews the TTL and returns success); checks whether an active claim exists from a different browser (in which case it returns 409 Conflict to prevent claim-stealing); enforces a per-IP rate limit; validates the bootstrap token using constant-time comparison; generates a new claim proof (a random UUID); persists the claim proof and timestamp to configuration storage with the proof encrypted at rest; and returns the claim proof in the path-scoped HttpOnly cookie.

#### Validate Without Consume

The claim endpoint validates the bootstrap token but does not consume it. This is the mechanism that enables the recovery path described above: if the claim cookie expires before the bootstrap token does, the user can re-claim with the same token. A strict mode is available behind an explicit environment variable for paranoid deployments that prefer true single-use semantics at the cost of recoverability — in strict mode, the first successful claim consumes the token and any subsequent claim attempt requires a process restart.

#### Wizard Phases

Comradarr's setup wizard runs in distinct phases, each of which must complete before the next is unlocked. The wizard cannot reach the completion endpoint without passing every required phase, and the setup-complete flag is only flipped to true at the final phase — an interrupted setup at any earlier phase leaves the application in the gated bootstrap state on next startup, with a fresh bootstrap token.

**Phase 1 — Bootstrap claim.** The operator pastes the bootstrap token, and the claim endpoint issues the setup-claim cookie as described above in the Claim Flow subsection. This is the only POST in the entire application that is not subject to CSRF Origin checking, because the allowed-origins configuration does not yet exist to check against. Claim is protected instead by the bootstrap token requirement, the strict-same-site cookie policy, and per-IP rate limiting — the layered protections specified in the Claim Flow subsection.

**Phase 2 — HTTP boundary verification (mandatory).** Immediately after a successful claim, before any other wizard action, the wizard walks the operator through a sequence of test-driven configuration steps covering the HTTP boundary — proxy trust, public origin, allowed origins and hosts, and a final rollup confirmation. Each step proposes values derived from the wizard's observations of the operator's actual request, explains in plain language what the value means and what the consequences of getting it wrong are, accepts operator confirmation or correction, and then runs a live end-to-end test against the operator's own browser before advancing. The live test either proves the setting works (green check, advance to the next step) or returns a specific error identifying what went wrong and offering a retry.

This phase exists specifically to catch the dominant operational failure mode of a reverse-proxy deployment: the operator finishes setup, every form action in the post-setup UI fails silently with a 403, and the operator has no clear path to diagnosis. The test-driven structure surfaces each potential misconfiguration while the operator is still in the setup mindset and can act on clear errors, rather than later when the symptoms are disconnected from the cause. It also means the operator does not need to know reverse-proxy networking in advance — the wizard shows what it sees, explains what it means, and verifies that the proposed fix actually works. The detailed mechanics of each step are specified in Section 16 under "Setup-Time HTTP Boundary Verification."

**Phase 3 — Admin account creation.** The operator submits a username, email, and password. The request goes through the now-active HTTP boundary middleware stack that Phase 2 configured — CSRF Origin check, CORS middleware, Host header validation, reverse-proxy resolution. This gives the wizard's defenses their first real workout against a meaningful action. On success, the admin user row is created with the local password provider, an admin session is issued, the setup-claim cookie is cleared, the bootstrap token is invalidated and its on-disk file deleted, the setup-complete flag is set to true, and the operator is redirected to the post-setup application UI.

**Future phases (placeholder).** Subsequent phases are deliberately undefined in v1. Candidates for future expansion include initial connector configuration (Sonarr, Radarr, Prowlarr), preference defaults, and telemetry opt-in if Comradarr ever adds telemetry. Each additional phase increases the interrupted-setup surface area, so adding one is a deliberate design decision rather than a default. Connector configuration in particular is intentionally left to the post-setup UI in v1 so it receives the full set of post-authentication protections (CSRF, audit logging, session validation) from the very first save.

The three-phase v1 structure is the minimum that establishes a verified HTTP boundary and creates an admin account. Every test-driven step in Phase 2 is mandatory — there is no skip option — because the whole point is that the operator leaves setup with a configuration that has been proven to work end-to-end rather than one that might happen to be correct.

#### CSRF During Setup

The bootstrap claim endpoint (Phase 1) is the only POST in the application that is not subject to CSRF Origin checking. The reason is structural rather than philosophical: the allowed-origins list does not yet exist when the claim arrives, because the operator has not yet had any opportunity to configure it. Claim is protected instead by the bootstrap token requirement, the `SameSite=Strict` policy on the claim cookie, the bootstrap rate limit, and the audit log capturing every attempt — the layered defenses already specified in the Claim Flow subsection.

From Phase 2 onward, CSRF Origin checking is active. The HTTP boundary verification phase populates the allowed-origins list (auto-derived from the claim request, confirmed by the operator), and every subsequent request — Phase 2's own test POST, Phase 3's admin account creation, and every action in the post-setup application — runs through the same CSRF middleware described in Section 16. There is no "setup-time exemption" beyond the single claim endpoint, and there is no transition moment where CSRF is configured but inactive. This collapses the special-case surface to one well-defined point (the claim) and gives the wizard's verification phase teeth — passing Phase 3 proves CSRF works end-to-end with the operator's actual configuration, not just that they checked a box.

#### Audit Logging from the First Action

Every state change during bootstrap and setup is recorded in the audit log: bootstrap token generation, claim attempts (both successful and rejected), claim takeover attempts, admin account creation, and setup completion. The audit table exists from the very first row written by the application — there is no period during which state changes are unlogged. A future operator asking "how was this install set up, and by whom?" can read the full chain of events from the first boot. The complete audit log model — action scope, context payload shape, integrity guarantees, retention, and access — is specified in the Audit Log subsection later in this section.

#### Single-Worker Requirement

The bootstrap token is per-process and lives only in memory. This works correctly because the production deployment runs Granian with a single worker, as specified in the technology stack. If the configuration is ever changed to multi-worker mode, only one worker will hold a valid token and only requests routed to that worker can validate the claim — leading to confusing intermittent failures. A startup warning is logged if multi-worker mode is detected while setup is incomplete, alerting the operator to the inconsistency before they hit the failure mode.

#### Process Restart

If the application restarts before setup completes, the in-memory token is lost by design. The next startup re-detects incomplete setup, generates a fresh token, and prints a fresh banner. This is correct behavior — restart access already implies the same trust level as log access, so regenerating the token grants no additional privilege to anyone who didn't already have it.

### Credential and Secret Handling

Comradarr treats secret material as a first-class design concern rather than an implementation detail. Huntarr-class projects typically fail on one of three axes: secrets leaking into logs, tracebacks, or error responses; encryption schemes that cannot be rotated without a database rewrite; and conflation of the primitives used to protect different kinds of secrets. The design below is organized to make each of those failure modes structurally difficult to reach.

#### Primitive Selection: Encrypt vs. Hash

Every secret in the system is classified by the operation the application needs to perform on it, and the primitive is chosen accordingly.

**Encryption** applies to secrets that the application must recover in plaintext to use. The connector API keys for Sonarr, Radarr, and Prowlarr are the primary case: Comradarr must send the plaintext key in the `X-Api-Key` header on every outbound request. Hashing is not applicable — a hash cannot be sent to Sonarr. The encryption primitive is AES-256-GCM with the shape described below.

**Hashing** applies to secrets that the application only needs to verify for correctness. User login passwords are hashed with Argon2id, which is memory-hard and intentionally slow to defend against offline brute-force attacks on low-entropy human-chosen inputs. Session tokens and Comradarr's own API keys are hashed with SHA-256, which is fast and entirely sufficient because the underlying tokens are 256-bit random strings — an attacker who steals the hash gains no meaningful advantage, because brute-forcing a 2²⁵⁶ search space is infeasible regardless of hash speed. Using Argon2id on high-entropy random tokens would add no security while imposing per-request CPU and memory costs on every authenticated API call.

Every secret comparison, regardless of primitive, uses a constant-time comparison (Python's `secrets.compare_digest` or equivalent). Non-constant-time comparison is treated as a code-review defect.

#### Encrypted-Field Storage Layout

The naïve approach of storing an encrypted value as a single delimited string (e.g., `nonce:tag:ciphertext`) is rejected. It forces parsing code on every read, it makes additional authenticated data awkward to introduce later, and it makes key versioning painful to retrofit. Comradarr instead stores every encrypted field as four distinct columns:

- **Nonce** — a 96-bit random value generated fresh for every encryption from a cryptographically secure random source. Nonces are never derived from the plaintext, never counter-based, and never reused under the same key. GCM nonce reuse is catastrophic in the worst case (plaintext recovery and authentication key compromise), so fresh random generation on every encrypt is non-negotiable.
- **Ciphertext** — the AES-256-GCM ciphertext output.
- **Tag** — the 128-bit GCM authentication tag.
- **Key version** — an integer referencing which key in the key registry was used to encrypt this row. Decryption looks up the correct key by version.

This layout applies to every encrypted field in the database today (connector API keys, the setup-claim proof) and to any encrypted field added in the future.

#### Additional Authenticated Data (AAD)

AES-GCM supports optional additional authenticated data: input that is not encrypted but is cryptographically bound to the ciphertext via the authentication tag. If the AAD presented at decryption does not match the AAD used at encryption, decryption fails.

Comradarr uses AAD to bind every ciphertext to its containing row. The connector API key's AAD is the connector's primary key (a stable UUID). The setup-claim proof's AAD is a fixed constant identifying the claim context. This defends against an attack class the PRD would otherwise leave open: an attacker with database write access swapping ciphertext between rows to steal one connector's API key under another connector's identity. The AAD binds the ciphertext to the row it belongs in — moving the ciphertext to a different row breaks the tag and decryption fails.

The AAD is chosen to be stable for the lifetime of the row. Fields that could legitimately change during the row's lifetime (connector name, URL) are not used as AAD, because a legitimate edit would then invalidate the ciphertext.

#### Key Versioning and Rotation

The key registry is an abstraction that maps version numbers to actual key material. It is constructed at startup from environment variables (or files — see below): `COMRADARR_SECRET_KEY` (or `COMRADARR_SECRET_KEY_FILE`) provides version 1; future versions are introduced via `COMRADARR_SECRET_KEY_V2`, `COMRADARR_SECRET_KEY_V3`, and their `_FILE` equivalents. A configuration value tracks which version is "current" for new encryptions.

Encryption always uses the current version. Decryption looks up the version stored on the row and retrieves the corresponding key from the registry. This is what makes key rotation a routine background operation rather than a one-shot migration: the operator introduces a new version, marks it current, and a background rotation worker re-encrypts rows one at a time under the new version. Progress is resumable; partial rotation is a valid state; the old key remains in the registry until every row has been migrated.

The rotation worker itself is deferred — the schema and service layer support rotation from day one, but the actual worker is not implemented until it is needed. What matters now is that the option is preserved structurally; retrofitting `key_version` into the schema later would be painful.

#### The Crypto Service

A single `CryptoService` owns every encryption and decryption operation in the application. It is constructed at startup from the key registry and injected into every component that needs it — primarily the client factory (which decrypts connector API keys when creating HTTP clients) and the auth layer (which handles the setup-claim proof). It exposes two conceptual operations: encrypt a plaintext under a given AAD, returning the four-column output under the current key version; decrypt a four-column record under a given AAD, returning the plaintext or raising a specific error on authentication failure.

No other component in the application performs AES operations directly. This concentrates the cryptographic surface in one auditable place.

#### The `Secret[T]` Wrapper Type

The leak class that sank huntarr — secrets appearing in logs, tracebacks, error responses, and debug output — is addressed structurally through a generic wrapper type rather than through discipline alone. A `Secret[T]` type wraps any secret value (strings, bytes, whatever) and overrides its string representation, repr, and msgspec serialization to return a fixed redaction marker. The only way to access the underlying plaintext is to call an explicit unwrap method (`expose()`), which is chosen for its grep-distinctiveness — a code reviewer auditing the application for leak sites can search the codebase for `.expose(` and enumerate every location where plaintext is touched.

Every secret in the system is typed as `Secret[T]`. Connector API keys in memory are `Secret[str]`. Session tokens before hashing are `Secret[str]`. Bootstrap tokens are `Secret[str]`. The setup-claim proof at the decryption boundary is `Secret[str]`. Master key material in the registry is `Secret[bytes]`.

With basedpyright in recommended mode, the type system catches any attempt to pass a plain `str` where a `Secret[str]` is expected, or to concatenate a `Secret` with a plain string (which would produce a plain string and lose the wrapper). Accidental leakage becomes a type-check failure rather than a runtime defect. The only remaining leak surface is explicit `.expose()` calls, which are a localized and auditable set of points rather than an unbounded search space.

#### Defense in Depth Beyond the Type System

Three additional layers complement the type-level enforcement:

**structlog processor chain** — A dedicated processor inspects every log event before rendering and redacts any `Secret` instance regardless of context. The same processor also recognizes sensitive header names (`Authorization`, `X-Api-Key`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`) and redacts their values whenever they appear in header-like dictionaries, which handles the case where raw httpx response headers are passed to the logger during debug traces.

**msgspec encode hook** — The `Secret` type registers a type-specific encode hook with msgspec so that any accidental inclusion in an API response schema, event payload, or other serialized structure renders as the redaction marker rather than exposing the value. The type system should prevent this from happening; the encode hook is belt-and-suspenders.

**Exception traceback hygiene** — The connector error normalization layer strips request/response objects from raised exceptions before they propagate. An httpx `HTTPStatusError` carries the full request object including headers; those are removed and replaced with a structured `ComradarrError` whose context dict has an explicit allowlist of fields (status code, connector name, endpoint path with query string stripped). The frontend never receives a raw exception surface.

#### Secret Lifecycle: Entry, Handling, Display, Egress

**Entry.** Connector API keys enter the system exclusively through the connector creation/edit endpoint. The request schema types this field as `Secret[str]` with length and character-class validation. Request body logging is disabled for this endpoint via an explicit allowlist in the request logging middleware; normal endpoints can log bodies at debug level, connector creation cannot.

**In-memory handling.** From the moment a plaintext key is received, it lives inside a `Secret` wrapper. The wrapper crosses the boundary into the encryption service (which unwraps it only to feed AES-GCM) and the HTTP client factory (which unwraps it only to place it into the httpx headers dictionary for outbound requests). No other component in the application ever unwraps a connector API key.

**Display.** Comradarr follows the "never show after storage" pattern. Once a connector API key is saved, it is never shown in the UI again. Editing a connector allows replacing the key but not viewing it. The connector-list API returns a masked representation — a fixed-width series of dots or asterisks followed by the last four characters of the key — so a user can visually confirm "yes, this is the key I pasted" without the plaintext ever leaving the backend after initial entry. A forgotten key is recovered by generating a new one in the upstream *arr application and pasting it into Comradarr; there is no destructive consequence to forgetting the Comradarr-side copy, so the convenience tradeoff for "reveal on re-auth" is not worth the additional plaintext-in-transit surface.

**Egress.** The only legitimate outbound path for a connector API key is the `X-Api-Key` header on a request to the corresponding *arr instance. The HTTP client wrapper is the single component allowed to unwrap the `Secret` for this purpose, and it does so only at the moment of insertion into the headers dictionary for a specific request. Every other layer — dispatcher, sync engine, rotation engine, health monitor — works with the wrapped form and never needs the plaintext.

#### Error Response Discipline

When a *arr request fails and surfaces to the frontend, the error representation passes through a normalization layer that enforces what can appear. The `ComradarrError` context dict has an explicit allowlist: connector name, status code, endpoint path (with query string stripped), and a human-readable reason. Raw request URLs, raw headers, raw response bodies, and any `Secret`-typed values are never included. This defends against a classic disclosure vector where helpful-seeming error messages leak credentials or internal state.

#### Master Key Management

`COMRADARR_SECRET_KEY` is the root of the trust hierarchy for encrypted fields. If it leaks, every ciphertext in the database becomes decryptable. Its handling is correspondingly strict.

**Startup validation.** The application validates `COMRADARR_SECRET_KEY` at startup and refuses to start if validation fails. Validation requires at least 64 hex characters (32 bytes of entropy), rejects values matching a denylist of known-weak or default-looking patterns (`changeme`, `secret`, `password`, all-zeros, sequential digits, obvious repetition), and rejects values whose structure suggests they are not randomly generated. Failure is fatal and produces a specific startup error identifying what is wrong. There is no "weak key warning" that allows continuation.

**`COMRADARR_SECRET_KEY_FILE` support.** The application accepts the key either as `COMRADARR_SECRET_KEY` (the value directly) or as `COMRADARR_SECRET_KEY_FILE` (a path to a file containing the key). If both are set, `COMRADARR_SECRET_KEY_FILE` wins with a logged warning. File-based loading is the pattern used by Docker secrets, Kubernetes mounted secrets, and systemd `LoadCredential`; supporting it avoids exposing the key via `docker inspect`, process environment dumps, or kernel `environ` memory regions. The same pattern applies to additional key versions: `COMRADARR_SECRET_KEY_V2`/`COMRADARR_SECRET_KEY_V2_FILE` and so on.

**Key generation script.** A standalone script within the repository generates a cryptographically strong key and prints it to stdout. It exists so operators do not roll their own with shell snippets that may have poor entropy. Documentation for initial setup directs operators to run this script and paste the output into their `.env` file, secrets manager, or Docker secrets volume.

#### Argon2id Parameters and Upgrade-on-Login

User password hashing uses Argon2id with parameters pinned in code (not configurable — configuration is a footgun in this layer): 64 MiB memory cost, 3 iterations, 4-way parallelism, matching current OWASP guidance for interactive authentication. The parameters are encoded into each hash so that a future parameter change can be detected.

On every successful login, the application compares the stored hash's parameters against the current target. If they differ, the password (which is present in plaintext during the authentication exchange) is rehashed under the current parameters and the database row is updated atomically with the login. This means parameter hardening propagates automatically as users log in over time, with no administrative intervention and no migration script.

#### Session Tokens and Comradarr API Keys

Session tokens are generated from a cryptographically secure random source with at least 256 bits of entropy. The plaintext token is returned to the browser in an HttpOnly cookie; only its SHA-256 hash is stored in the database. Session validation hashes the incoming cookie value and looks up by hash. A database read therefore does not grant session impersonation — the stored hash cannot be replayed as a cookie.

Comradarr's own API keys (for external programmatic access to Comradarr's API) follow the same pattern with an additional UX refinement. On creation, the plaintext key is shown to the user exactly once, with a distinctive human-readable prefix (candidate: `cmrr_live_`) followed by the random portion. The prefix serves two purposes: it lets automated secret scanners (such as GitHub's) identify leaked keys committed to public repositories and surface the leak to the affected user, and it lets users visually distinguish Comradarr keys from other tokens in their credential stores. After initial creation, the UI shows only the prefix and the last four characters of the random portion; the plaintext is never retrievable, and a lost key is replaced by revoking and creating a new one.

### Audit Log

The audit log is the append-only record of every security-sensitive state change in Comradarr, beginning with the very first row written by the application during bootstrap and continuing for the lifetime of the install. Its purpose is to answer the question "who changed what and when" with sufficient fidelity that a future operator — possibly a different person than the one who set the install up — can reconstruct the history of the system without needing external records.

#### What Gets Logged

The scope is deliberately narrow: security-sensitive state changes and user-initiated operational actions, nothing more. The exhaustive list follows.

**Authentication and session events.** Bootstrap token generation, every claim attempt (successful and rejected, including claim-takeover attempts from a second browser), admin account creation, setup completion, every login attempt across all three providers (local password, trusted-header, OIDC) with the authenticating provider recorded, every session revocation (self-initiated via logout and admin-initiated from the sessions UI), password changes, and password recovery flow activations.

**API key lifecycle.** Creation of a Comradarr API key, first use (so the operator can see when a new integration came online), and revocation.

**Configuration changes.** Connector add, edit, and delete — with the URL and type recorded but the API key plaintext never captured; the audit trail says the key changed, not what it changed from or to. HTTP boundary configuration changes (public origin, allowed origins, allowed hosts, trusted proxies, trusted-header authentication settings) with old-value and new-value pairs. OIDC provider add, edit, and delete. Role assignments, when roles are introduced post-v1.

**User-initiated operational actions.** Manual sync triggers, manual search triggers (user-initiated rotation bypasses), and connector pauses and un-pauses when that feature exists.

What does *not* get logged: routine sync cycle ticks, routine rotation engine ticks, health check probes against connectors, individual search dispatches during normal rotation, and any other high-volume operational event whose volume would drown the signal. These belong in the structured log stream (Section 20), which is operational telemetry rather than an audit trail. The distinction is that the audit log answers "what did humans and external callers change," while the structured log answers "what did the application do over time."

#### The Context Payload

Every audit entry carries a JSONB context payload that captures the parameters of the action in a structured form. The schema of this payload is stable per action code and is defined by msgspec Structs in the backend codebase, giving author-time type-checked guarantees about what each action records.

For a connector-edit action, the payload contains the connector ID, the set of fields that changed, and the old-value / new-value pair for each field. The API key field is redacted on both sides. For a login action, the payload contains the provider that authenticated, the matched user ID on success or the attempted username on failure, the resolved source IP from the reverse-proxy chain (Section 16), and the user-agent. For an HTTP boundary configuration change, the payload contains the full diff of the old and new configuration so a reviewer can see exactly what shifted.

The `Secret` wrapper type (Section 15, Credential and Secret Handling) is respected throughout this path — any attempt to include a wrapped secret in the payload renders as the redaction marker, not the plaintext. This means even a bug in payload construction cannot leak secrets into the audit log.

#### Integrity Model

The audit log's integrity relies primarily on the database-level role separation described in Section 8. The application role, which handles every request during normal operation, has insert and select privileges on the audit log table but no update or delete. A bug in the application — a SQL injection, a request-handler error, a compromised dependency with arbitrary-query capability — can forge new entries but cannot modify or erase prior ones, because the role it connects as simply does not have those privileges at the database level. This covers the realistic compromise scenario for a homelab tool (application-layer bug) structurally rather than procedurally.

A stronger guarantee — tamper-evidence against an attacker who has bypassed the application entirely and gained direct database access — is designed into the schema but not implemented in v1. Two columns on the audit log table (`previous_hash` and `content_hash`, both nullable) are reserved for future hash-chain construction: each entry's content is hashed together with the prior entry's content hash to form a chain in which any modification to a historical entry invalidates every subsequent entry's verification. The columns are populated with null in v1. If a future operator or compliance requirement demands hash-chain verification, the upgrade is a background worker plus a verification endpoint plus a one-time backfill rather than a schema migration that locks the table during application operation.

Reserving the columns now is essentially free; retrofitting them later means altering a potentially-large audit table while the application is running, which requires either downtime or careful coordination. Designing the columns in at v1 keeps the option open without committing to the implementation.

#### Retention

The default is indefinite retention. Audit log entries are small (a few bytes of structured data per entry) and even a heavily-used Comradarr install produces orders of magnitude less data than the mirror tables. There is no storage concern for a typical homelab deployment, and the full history is genuinely useful — "when did I last change this setting" and "how was this install configured" are questions operators ask. The table is allowed to grow without bound by default.

For operators who want a cap — storage constraints, a compliance regime that mandates deletion after a fixed window, or a personal preference for bounded state — a configurable retention limit is available, expressed in either days or entry count. A scheduled background task runs daily, connects using the audit-admin role (Section 8), deletes entries older than the configured threshold in small batches, and then closes its connection. The task's execution is itself audit-logged — recording how many entries were pruned and the cutoff date — so the act of pruning is visible to a future reviewer. Setting the retention cap to zero (the default) disables the vacuum task entirely, so the audit-admin role's connection is never actually opened on the default configuration.

#### Access

The audit log UI is admin-only in v1. When roles are introduced post-v1, access becomes a specific permission that the default admin role has and other roles do not. The UI displays entries in reverse-chronological order with filtering by action code, actor (user ID or source IP for unauthenticated actions), date range, and free-text search across the stringified context payload.

The SELECT queries driving the UI go through the application role's connection pool, which has select privileges on the audit log table. Admin-level authorization is enforced at the API layer via the standard permission middleware; the database-level role separation is a secondary defense ensuring that even an authorization-bypass bug cannot turn a read into a write — the application role's select-and-insert privileges on the audit log mean a compromised read endpoint cannot be pivoted into tampering, only into unauthorized disclosure.

### API Rate Limiting

Comradarr's rate limiting posture is deliberately lopsided: tight on authentication endpoints (Section 15's "Rate Limiting and Abuse Resistance" subsection), loose everywhere else. The reasoning is that Comradarr is overwhelmingly a single-user application running on the operator's own hardware — the main justification for general-purpose API rate limiting in most web applications (protecting shared infrastructure from one user exhausting it for others) does not apply when there is one user and the infrastructure is theirs. Layering aggressive rate limits across the general API surface would mostly just get in the operator's way, throttling the UI they themselves are using.

The nuanced cases where rate limiting does apply on the general API:

**API-key-authenticated requests** get per-key rate limiting with a generous default (several hundred requests per minute per key, configurable in the post-setup UI). The defense is against a leaked key being abused by an external caller — a scenario where the attacker is not the operator and the operator would benefit from the request flow being throttled until they notice and revoke. Session-authenticated requests (the operator themselves in the browser) are not rate-limited because throttling one's own UI is user-hostile, and the structural defenses against credential theft (HttpOnly cookies, strict CSP, `SameSite=Lax`) already constrain abuse.

**Unauthenticated endpoints** — the health endpoint, the CSP report endpoint, the OIDC callback — get per-IP rate limiting sized to realistic legitimate traffic (a few requests per minute for the health endpoint, a few per hour per IP for the CSP report endpoint). These limits are not configurable; their defaults are low enough that any legitimate caller will never approach them and high enough that transient bursts don't get penalized.

**Outbound traffic to *arr instances and to Prowlarr** is governed by the budget system (Section 11), not by the inbound rate limiting described here. The two systems solve different problems: the budget system protects external indexers from Comradarr's search volume, while the inbound rate limiter protects Comradarr from external abuse. They are specified separately and tuned independently.

Rate limit state lives in the same `auth_rate_limits` table described in the Credential and Secret Handling subsection, with a hot-path in-memory cache for the per-IP and per-key lookups. The persistence across restarts is a deliberate choice: an attacker who has triggered rate limiting cannot reset their state by waiting for the container to restart.

### Session Management for the Split Architecture

In the Python backend + SvelteKit frontend architecture, authentication spans both layers. The Python backend issues and validates sessions. The SvelteKit server (`hooks.server.ts`) checks the session cookie on every page request by calling the Python backend's session validation endpoint, and gates route access based on the result. The SvelteKit client-side uses the same cookie for direct API calls to the Python backend.

This means the Python backend is the single source of truth for authentication state, while SvelteKit handles the page-level access control and redirect logic.

---

## 16. HTTP Boundary Hardening

### Threat Model

The HTTP boundary is where Comradarr meets the internet — or, more accurately, where it meets whatever sits between the operator's browser and the application: a reverse proxy, an authentication gateway, a CDN, a tunnel, or in the simplest case nothing at all. Every input crossing this boundary is shaped by intermediaries the application does not control, and every output is exposed to consumers the application cannot verify. Five threat categories shape the defenses below.

**Source-IP spoofing for rate limiting and audit.** The rate limiter in Section 15 keys on source IP. The audit log records source IP for every action. Both rely on knowing the *real* originating IP, which means correctly handling the `X-Forwarded-For` and `Forwarded` headers when Comradarr sits behind a reverse proxy — and pointedly *not* trusting them when no proxy is present or when the request comes from outside the proxy. Getting this wrong turns the rate limiter into a sieve (an attacker spoofs `X-Forwarded-For: 1.2.3.4` and gets fresh limits) or poisons the audit log (every entry shows whatever IP the attacker chose). Worse, the OIDC redirect URI and any absolute URLs Comradarr constructs depend on host/proto trust that flows from the same headers; spoofing those can redirect the OIDC flow through an attacker-controlled host.

**Cross-origin attacks on authenticated endpoints.** A logged-in user visiting an attacker-controlled page can be made to issue cross-origin requests to Comradarr that carry the session cookie. CSRF (forged state-changing requests) and CORS misconfiguration (an attacker's origin allowed to read responses) are the two faces of the same problem: the browser will attach credentials to requests the user never intentionally made, and the application has to decide what to do about it.

**Information disclosure through HTTP responses.** Headers, error pages, the OpenAPI spec, and the SvelteKit client bundle can all leak more than intended. A missing `X-Content-Type-Options` lets a hostile upload be sniffed as HTML and executed. A permissive `Referer` policy leaks URLs (with their query strings and embedded tokens) to every external resource. A publicly exposed OpenAPI spec hands an attacker the complete API surface for free.

**Active content injection in the frontend.** XSS in a SvelteKit application is harder than in a templating-string-based one because Svelte escapes by default, but `{@html}`, dynamically constructed event handlers, and innerHTML-equivalents in third-party components remain real surfaces. A Content Security Policy that forbids `unsafe-inline` and `unsafe-eval` raises the cost of any successful injection from "execute attacker JavaScript" to "execute nothing."

**Clickjacking and framing.** A malicious page that frames Comradarr can trick a logged-in user into clicking actions they didn't intend. The defense is straightforward but has to be applied uniformly.

The sections below address each in turn. Cookie attributes and CSRF, previously paragraphs in Section 15, are relocated here in expanded form; Section 15 keeps a pointer.

### Configuration Surface

Comradarr deliberately minimizes the environment variables the operator must set before first launch. Networking configuration is an area where operators vary enormously in confidence — a homelab user may be a professional who has been running Kubernetes clusters for a decade, or may be running their first Docker container and discovering what a reverse proxy is as they go. Rather than requiring pre-launch decisions from every operator, Comradarr observes the reality of each incoming request during the bootstrap flow and walks the operator through a guided configuration process where every setting is tested end-to-end before the wizard advances. The split:

**Required pre-launch.** Only `COMRADARR_SECRET_KEY` (or `COMRADARR_SECRET_KEY_FILE`). This is the master encryption key described in Section 15 and cannot be deferred because it protects database-resident secrets before the database is reachable.

**Defaulted by the Docker image.** `DATABASE_URL` is set by the Comradarr Docker image to point at an in-container PostgreSQL instance that the image bundles and starts alongside the application process. The 98% homelab case is therefore zero database configuration — the operator pulls the image, starts the container, and the application boots with a working database. Operators who prefer to use an external PostgreSQL instance (a shared database server, a managed cloud database, an existing homelab Postgres container) override `DATABASE_URL` explicitly; the bundled PostgreSQL is not started when an external URL is configured. The bundled-versus-external split is discussed further in Section 24.

**Optional pre-launch, development-only.** `COMRADARR_INSECURE_COOKIES` set to 1 disables the Secure cookie attribute for HTTP development; `COMRADARR_CSP_REPORT_ONLY` set to 1 switches CSP to report-only mode. Both log a prominent warning at every startup so they cannot be left on in production by accident.

**Optional pre-launch, operator-specific break-glass.** `COMRADARR_RECOVERY_MODE` (for password recovery, Section 15) and `COMRADARR_DISABLE_LOCAL_LOGIN` (for deployments that exclusively use trusted-header or OIDC auth) are operational escape hatches that are set deliberately when needed and unset otherwise.

**Wizard-collected, tested end-to-end, persisted to app_config.** Everything else related to the HTTP boundary — the public origin, the allowed origins list, the allowed hosts list, the trusted reverse-proxy IPs (for forwarded-header trust), and the trusted-header authentication proxy IPs (if trusted-header auth is later enabled) — is observed by the wizard, proposed to the operator with clear explanations of what each setting means, confirmed by the operator, and then verified with a live end-to-end test before the wizard advances. Every value is editable through the post-setup UI thereafter. The mechanics are described in detail in the "Setup-Time HTTP Boundary Verification" subsection below and in Section 15's "Wizard Phases" subsection.

**Always-on, no configuration surface.** The full security response header set, the Content Security Policy, Host header validation, redirect blocking on outbound connector requests, and TLS verification on outbound connector requests are non-configurable in production. There is no operational reason to weaken them, and configurability invites well-meaning operators to turn off protections they don't understand.

The intent is that a typical homelab operator sets exactly one environment variable (`COMRADARR_SECRET_KEY`) and answers a sequence of clearly-explained questions in the setup wizard, each with a live test confirming the setting works before moving on. Networking knowledge is not a prerequisite — the wizard surfaces what it sees and asks the operator to confirm it, rather than demanding the operator know the right answer in advance.

### Reverse Proxy Header Trust

#### The Default Before Configuration

At the instant the very first bootstrap request arrives — before the wizard has run, before any configuration has been collected — Comradarr has no basis for trusting any forwarded header. The default at this moment is no proxy trust: the source IP is the TCP socket peer, the scheme is whatever the listener bound to, and the host is whatever the browser sent in the Host header. Forwarded headers are observed so they can be surfaced to the operator during the wizard, but they are not trusted for any security decision until the operator confirms which peers are legitimate proxies.

This is the secure default because it is the only configuration that cannot be exploited by an attacker — there is no header to spoof if no header is trusted. The cost of the default is that deployments behind a reverse proxy see every request as originating from the proxy's IP, which is exactly what the wizard phase exists to correct.

#### Observation During the Bootstrap Claim

When the bootstrap claim arrives, the wizard records a set of observations about the request that it will present to the operator: the TCP socket peer address (the immediate network neighbor that delivered the packet), the Host header the browser sent, any X-Forwarded-For chain present, any X-Forwarded-Proto value, any X-Forwarded-Host value, and any RFC 7239 Forwarded header. These observations are raw facts — they are not yet acted upon. The claim itself is authorized by the bootstrap token alone, not by any trust decision derived from these headers.

The observations let the wizard reason about the deployment shape without the operator having to describe it. If X-Forwarded-For is present and the TCP peer is an RFC 1918 or loopback address, the wizard can infer with high confidence that the operator is running Comradarr behind a reverse proxy on the same machine or Docker network. If the TCP peer is a public IP and no forwarded headers are present, the operator is probably exposing Comradarr directly (unusual for homelab setups, but legitimate in some cloud deployments). If forwarded headers are present but the TCP peer is public, something unusual is going on and the wizard flags it for review.

#### Resolution Algorithm After Configuration

Once the wizard has collected and confirmed the trusted-proxy list, the HTTP boundary middleware uses it on every subsequent request. The algorithm:

The TCP socket peer address is read. This is the only input to the trust check; no header is consulted at this step. If the peer address is not in the trusted-proxy list, every forwarded header on the request is ignored, the effective source IP is the socket peer, the effective scheme is whatever the listener bound to, and the effective host is the raw Host header. If the peer address is in the trusted-proxy list, the standard forwarded header set is honored: X-Forwarded-For is parsed as a comma-separated chain, with the rightmost entry replaced by the trusted-proxy address itself and the leftmost entry treated as the original client. The effective source IP is the leftmost entry in the chain that is not itself in the trusted-proxy list, which handles chained proxies correctly (CDN then load balancer then app) where every hop is trusted but only the originating client is audit-relevant. The effective scheme comes from X-Forwarded-Proto if present and trusted; the effective host comes from X-Forwarded-Host if present and trusted.

Two edge cases need explicit handling. If X-Forwarded-For from a trusted peer is empty or malformed, the resolver falls back to the socket peer rather than failing the request — the operator's proxy is misconfigured, but failing every request is worse than logging the proxy's IP. A warning is logged at INFO level so the misconfiguration surfaces. If the chain contains addresses that are syntactically invalid (not parseable as IP), the entire chain is rejected and the resolver falls back to the socket peer; this catches X-Forwarded-For injection attempts that put non-IP content into the chain hoping to confuse downstream consumers.

#### Host Header Validation

The Host header is not a forwarded header — it is the request target the browser used. Comradarr validates it against the allowed-hosts list persisted in app_config (collected and tested during the wizard, editable thereafter) and rejects requests whose Host does not match. This defends against host header injection attacks where an attacker submits a request with Host set to an attacker-controlled domain hoping that absolute URLs constructed by the application (OIDC redirect URIs, links in any future email notifications) will be built against the attacker's host.

The allowlist supports wildcards for subdomain trees and exact-match entries. It does not support the lone wildcard that would accept any host, because a wildcard-everything policy is structurally indistinguishable from no validation and is therefore not offered as a configuration choice. The wizard surfaces the auto-derived value during verification and the post-setup UI allows editing it; in both cases the value is constrained to non-wildcard-everything entries.

#### Where the Effective Values Are Used

The resolved source IP is used by the rate limiter as the per-IP key, by the audit log as the recorded actor IP for unauthenticated actions and as supplementary context for authenticated ones, and by the trusted-header authentication provider — which uses its own separately-confirmed proxy allowlist, because the populations may differ. The proxy that handles general request forwarding may not be the same proxy authorized to attach identity headers.

The resolved scheme and host are used by OIDC redirect URI construction, any absolute-URL link generation in API responses, the CSRF Origin check described below, and the CORS allowlist comparison described below. Inconsistency between these consumers is the bug class to avoid: if the rate limiter trusts X-Forwarded-For but the audit log records the socket peer, an attack at the rate limit layer will not appear in the audit trail with the right IP. Centralizing the resolution in a single middleware that runs early and stamps the resolved values onto a request-state object — which every downstream consumer reads from — is the structural defense.

### CORS

#### The Threat

CORS is the browser's mechanism for deciding whether JavaScript on origin A is allowed to read responses from origin B. Comradarr's API endpoints can be called from JavaScript on the SvelteKit frontend; they should not be readable by JavaScript on any other origin. Misconfigured CORS — specifically a wildcard Allow-Origin paired with credentials-allowed (which most browsers refuse but some library defaults still emit), or worse, an Allow-Origin that is reflected verbatim from the request's Origin header — turns the API into a free-for-all from any cross-origin page a logged-in user happens to visit.

#### Configuration

The allowed-origins list persisted in app_config holds the set of origins that may make cross-origin requests to the API. Each entry is a complete origin including scheme, host, and where non-default the port. Wildcards are not supported — every allowed origin is listed explicitly. Subdomain trees that legitimately need to share a CORS allowlist enumerate their members. This is more verbose than wildcards and that's the point: every origin in the list represents a deliberate trust decision by the operator, either during the wizard verification phase or through the post-setup UI.

The default value contains only the public origin of the Comradarr instance. The common deployment pattern — frontend and backend served from the same origin — needs no CORS at all in the strict sense, but the public origin is in the allowlist anyway so that the allowlist is authoritative and consumers (the CORS middleware and the CSRF Origin check described below) read from a single source. Operators who genuinely need additional origins (a separate frontend deployment, a development instance pointing at a shared backend) add them through the post-setup UI, where each addition triggers the same live-test verification pattern the wizard uses.

#### Middleware Behavior

The CORS middleware compares the request's Origin header against the allowed-origins list using exact string equality after normalization (lowercase scheme and host, default port elision). For an allowed origin on a simple request, the response echoes the origin back in the Allow-Origin header exactly (never as a wildcard), marks credentials as allowed, and sets a Vary header keyed on Origin so intermediate caches do not cross-pollinate responses between origins. For an allowed origin on a preflight OPTIONS request, the response adds the set of allowed methods (the HTTP verbs the API uses) and the set of allowed request headers (the ones the frontend sends, including the API key header and the content-type header) along with a ten-minute preflight cache lifetime — long enough to amortize the OPTIONS round-trip, short enough that allowlist changes propagate in reasonable time. For a disallowed origin, no CORS headers are emitted at all, and the browser interprets the absent Allow-Origin as a refusal; the response body and status code are otherwise unchanged, because a special "not in CORS allowlist" error response would leak the allowlist to probers. For a request with no Origin header at all, the request is treated as non-CORS (a same-origin request, a server-to-server call, or a direct API client), no CORS headers are emitted, and authorization is handled by the normal auth machinery.

The Vary-on-Origin header is non-negotiable on every CORS response. Without it, an intermediate cache that sees a successful response for one allowed origin may serve that response (with its cached Allow-Origin header) to a subsequent request from a different, disallowed origin, defeating the entire allowlist. The Vary header tells caches to key on the request's Origin header, eliminating this class of bug.

#### The SSE Endpoint

The SSE endpoint for real-time events is a special case worth calling out. EventSource connections in older browsers do not send Origin on the initial connection; modern browsers do. Either way, the connection carries cookies. The CORS middleware applies to SSE the same way it applies to any other endpoint: the Origin header, when present, must be in the allowlist, and the response carries the appropriate headers. EventSource does not support custom headers, so the auth path for SSE is the session cookie exclusively — which is fine, because EventSource is only used by the frontend, which already has the cookie.

### CSRF

#### Defense in Depth

CSRF protection in Comradarr is layered. `SameSite=Lax` on the session cookie (cookie attributes consolidated below) handles the dominant case: a hostile third-party site cannot cause the browser to attach the session cookie to a forged POST. This is the structural defense and the primary line.

The `Origin` and `Referer` header check is the secondary line. Every state-changing request (POST, PUT, PATCH, DELETE) is required to carry an `Origin` header — modern browsers send it on all cross-origin requests and on same-origin POSTs, so its absence on a mutating verb is a strong signal of either a non-browser caller (which should be using API key auth, handled separately) or an attempt to bypass `SameSite` via an exotic browser. The header value must match an entry in `allowed_origins`. Mismatch returns 403.

If `Origin` is absent (which happens with some legacy proxy configurations that strip it) and `Referer` is present, `Referer`'s origin component is checked against the allowlist instead. This is a fallback, not a preferred path, because `Referer` can leak information and is suppressed by some user privacy configurations — but a present-but-wrong Referer is just as good a CSRF signal as a present-but-wrong Origin.

If both are absent on a mutating request, the request is rejected with 403. The error message is generic — "missing or invalid origin" — and does not distinguish "absent" from "wrong", because an attacker probing for the difference learns nothing useful from being told.

#### Setup-Time HTTP Boundary Verification

The bootstrap claim endpoint (Phase 1 of the wizard, described in Section 15) is the single POST in the application that does not run through the CSRF Origin check. It cannot, because the allowed-origins list does not yet exist when the claim arrives. Claim is protected instead by the bootstrap token, the SameSite-Strict claim cookie, and per-IP rate limiting.

Phase 2 of the wizard exists specifically to close this gap through a sequence of test-driven configuration steps. The operator never has to know the right answer in advance — the wizard proposes values based on what it observed during the claim, explains what each value does in plain language, and then runs a live test with the operator's actual browser before advancing. Any test failure returns the operator to the relevant step with a specific error and a concrete suggestion for how to correct it. The wizard cannot complete with a broken HTTP boundary configuration because each test is a precondition for the next step.

**Step A, proxy trust.** The wizard shows the operator what it observed about the request path: the TCP socket peer address, whether forwarded headers were present, and what those headers claimed. If the pattern matches a typical reverse-proxy deployment (internal-range TCP peer plus X-Forwarded-For), the wizard presents this plainly — something to the effect of "Your request arrived from an internal address with forwarded headers, which means you are running behind a reverse proxy. If you confirm this, Comradarr will trust the forwarded headers from the observed internal address as identifying your real client IP. Otherwise, all requests will appear to come from the internal address in your audit log and rate limiter." The operator confirms, corrects (the proxy address field is editable — the operator can enter a CIDR range instead of the exact IP, for example, to cover a range of Docker container addresses), or declines (no proxy trust, all requests show the immediate peer). On confirmation, the setting is held in a candidate state and a live test is run: a second request from the operator's browser, through whatever proxy chain exists, against an endpoint that returns the resolved client IP. The wizard displays the result — "Your client IP is correctly identified as 192.168.1.42" on success, or "Your IP now appears as <different address>, which is unexpected — review your reverse proxy configuration" on failure. Only on test success does the candidate value get persisted to app_config and the wizard advance.

**Step B, public origin.** The wizard shows the operator the scheme, host, and port derived from the now-correctly-resolved request (after Step A has established proxy trust). It explains what public origin means in terms the operator can verify against their own expectations: "This is the URL your browser is using to reach Comradarr. It will be used to construct login redirects, OIDC callbacks, and links in any future email notifications. It is also the origin that browser security checks will compare incoming requests against." The operator confirms or corrects the value. The live test for this step is a same-tab navigation round-trip: the wizard redirects the browser to a setup verification URL constructed from the candidate public origin and then back to the wizard, confirming the operator's browser can reach the candidate URL in both directions. If the redirect round-trips successfully, the value is persisted; if it fails (wrong port, wrong scheme, DNS issue), the error includes the specific failure and a retry control.

**Step C, allowed origins and hosts.** With public origin established, the wizard proposes the allowed-origins list (a single-entry list containing public origin) and the allowed-hosts list (a single-entry list containing the host portion of public origin). For the 98% case these defaults are exactly right and the operator accepts them with one click. The rare operator who legitimately needs additional origins (a separate frontend deployment, a development instance pointing at this backend) can add them here or defer to the post-setup UI. The live test for this step activates the CSRF middleware and CORS middleware with the candidate values, then performs a mutating POST against a dedicated CSRF verification endpoint with the browser's actual Origin header. The endpoint runs through the live middleware stack; success means CSRF and CORS are correctly configured for the operator's deployment. Failure returns a specific error, typically revealing either a mismatch between the public-origin that the operator confirmed and the Origin header the browser actually sends (usually a scheme or port discrepancy introduced by the reverse proxy) or a subtle proxy misconfiguration that didn't show up in Step A.

**Step D, rollup confirmation.** Before the wizard advances to Phase 3 (admin account creation), a summary page shows all the persisted values with edit controls for each. This is the operator's last chance to review the full HTTP boundary configuration before it becomes the live security posture. Edit re-runs the relevant test.

The verification has teeth because Phase 3's admin account creation also runs through the now-active CSRF middleware, CORS middleware, Host header validation, and reverse-proxy resolver. Even if the operator clicked through Phase 2 carelessly, Phase 3 will fail with a clear error if any piece of the configuration is broken. The wizard cannot complete with a broken HTTP boundary.

Every value collected in Phase 2 is editable through the post-setup UI's settings page. Changes to allowed origins, allowed hosts, or trusted proxies re-run the same live test pattern before taking effect, so the operator cannot lock themselves out by pasting a wrong value — if the test fails, the old value remains active and the new value is rejected with a specific error.

#### API Key Authentication and CSRF

Requests authenticated via `X-Api-Key` rather than session cookie are exempt from the Origin/Referer check. The reasoning: API key authentication is explicitly programmatic, it cannot be triggered by a browser visiting a malicious page (the attacker doesn't have the key), and the `X-Api-Key` header itself is a non-simple CORS header which means cross-origin requests from a browser cannot send it without a successful preflight against the CORS allowlist. The CORS middleware already gates that path; layering CSRF on top adds nothing.

The exemption is detected by checking the resolved authentication mechanism on the request, not by checking for the header's presence — an attacker including a bogus `X-Api-Key` to try to slip past CSRF would fail the API key validation and fall back to the session cookie path, where CSRF still applies.

#### SvelteKit Form Actions

SvelteKit's form actions submit POST requests to the SvelteKit server, which then makes a backend HTTP call. Two layers of CSRF apply:

- **SvelteKit's built-in CSRF** validates the `Origin` header against the SvelteKit application's own allowlist. This is a same-origin check between the browser and the SvelteKit server. It is enabled by default and Comradarr does not disable it.
- **The Python backend's CSRF** validates the `Origin` header on the request the SvelteKit server makes to the Python backend. In typical deployments these are the same origin (or both same-origin to the operator), so the check is straightforward. The SvelteKit `hooks.server.ts` forwards the user's original `Origin` header on backend calls so the backend's check sees the genuine browser origin, not the SvelteKit server's loopback origin.

The two-layer pattern means a CSRF bypass at one layer doesn't immediately compromise the system. It also means a misconfigured SvelteKit-to-backend deployment (where the backend is reachable directly from the browser bypassing SvelteKit) still has CSRF protection on the backend side.

### Security Response Headers

A standard set of response headers is emitted by middleware on every response. These are not configurable — there is no operational reason to weaken them, and configurability would invite well-meaning operators to turn off protections they don't understand. The set:

**`X-Content-Type-Options: nosniff`** disables MIME sniffing in browsers. Without it, a response with `Content-Type: text/plain` containing `<script>` tags can be sniffed and executed as HTML by the browser. Comradarr's API responses are always JSON, but defense in depth: the header costs nothing and forecloses the attack class.

**`X-Frame-Options: DENY`** prevents Comradarr from being framed by any other page. Combined with the CSP `frame-ancestors` directive (below), this is belt-and-suspenders against clickjacking. There is no use case for embedding Comradarr in another page.

**`Referrer-Policy: strict-origin-when-cross-origin`** sends only the origin (not the path or query) of the referring page on cross-origin navigations, and nothing at all on downgrades from HTTPS to HTTP. This prevents internal URLs (which may contain item IDs, search filters, or pagination cursors that reveal library contents) from leaking to external sites linked from Comradarr.

**`Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()`** denies the entire set of browser feature APIs Comradarr does not use. These APIs cannot be invoked from Comradarr or from any frame Comradarr embeds (which is none, given `X-Frame-Options: DENY`). The header makes that explicit so that a future XSS vulnerability cannot use them either.

**`Strict-Transport-Security: max-age=31536000; includeSubDomains`** is emitted only when the request was received over HTTPS. The one-year max-age is the typical recommendation; `includeSubDomains` is included by default. The `preload` directive is *not* included by default — preload submission is a deliberate operator decision with long unwind time, not something Comradarr should opt into automatically.

**`Cross-Origin-Opener-Policy: same-origin`** isolates Comradarr's browsing context from cross-origin windows. This blocks a class of cross-window attacks (Spectre-adjacent timing leaks, window.opener manipulation) at modest cost.

**`Cross-Origin-Resource-Policy: same-origin`** prevents other origins from embedding Comradarr resources (images, scripts, the SSE stream) as cross-origin loads. Not strictly necessary given the other protections, but it closes a niche disclosure path.

The `Server` header is suppressed, removing the default `granian/x.y.z` advertisement. The `X-Powered-By` header is never emitted. Version disclosure to unauthenticated requests is information an attacker can use to target known CVEs against the specific Granian or Litestar version — there is no benefit to emitting it.

### Content Security Policy

#### The Goal

CSP defines what the browser is allowed to load and execute when rendering a page from Comradarr. A strict policy means that even if an attacker manages to inject content into the page (via a Svelte escaping bypass, a third-party component vulnerability, a misuse of `{@html}`), the browser refuses to execute it. CSP is the safety net under the "Svelte escapes by default" assumption — when escaping fails, CSP catches it.

#### Policy

The policy emitted on every SvelteKit-served HTML page is restrictive by design. The default source is restricted to the application's own origin, which means every type of subresource (images, fonts, scripts, styles, connections) falls back to same-origin-only unless explicitly relaxed. Scripts and styles are allowed only from the same origin and only with a per-request cryptographic nonce; inline scripts and inline styles without the matching nonce are refused. Images are allowed from the same origin plus data URIs, the latter being a narrow relaxation for embedded SVG icons. Fonts are same-origin only. Network connections (fetch, XHR, EventSource) are same-origin only, which covers both the API calls and the SSE stream in the default single-origin deployment. The frame-ancestors directive is set to nothing, meaning no other page can embed Comradarr in a frame under any circumstances. The base URI is pinned to the same origin so that injected base-tag attacks cannot rewrite relative URLs to point at attacker-controlled hosts. Form submissions are restricted to the same origin. The object source is set to nothing, prohibiting plugins and embedded objects outright. Finally, the policy instructs the browser to upgrade any incidental plain-HTTP references on the page to HTTPS, handling the case of a stray insecure link without breaking the page or downgrading the connection.

The notable absences are the unsafe-inline and unsafe-eval keywords — both forbidden everywhere. Inline scripts and styles use a per-request nonce that the SvelteKit server generates and includes both in the CSP header and on the inline script and style tags it emits. The nonce is a fresh 128-bit random value per response; it is not stored, not predictable, and not reusable. Third-party scripts that demand unsafe-inline are not usable in Comradarr; this is a deliberate constraint that shapes which dependencies the frontend takes on.

The connect-source restriction to same-origin includes the SSE endpoint (which is same-origin) and all API calls. If a future deployment puts the backend on a different origin from the frontend, the connect-source directive extends to include the backend origin explicitly — never a wildcard.

The data-URI allowance on images is a genuine relaxation and is limited to images specifically because it is needed for embedded SVG icons and small inline images that shadcn-svelte and similar libraries occasionally use. The alternative (every icon as a separate request) is operationally worse, and the data URI scheme is not a meaningful XSS vector when scripts are restricted to same-origin with nonces.

The frame-ancestors directive is the CSP-level equivalent of the X-Frame-Options DENY header. Both are emitted because old browsers honor only X-Frame-Options while modern browsers honor frame-ancestors over X-Frame-Options when both are present — sending both guarantees correct behavior across the browser matrix.

#### Reporting

A CSP violation report endpoint at `/api/csp-report` accepts browser-emitted reports of policy violations and logs them. This is essential during initial rollout and during dependency updates: a new version of shadcn-svelte that introduces an inline style breaks the page silently in production unless reports surface the violation. Reports are rate-limited per source IP to prevent log flooding and are recorded with bounded context (the violated directive, the blocked URI, the document URI — never user-content fields that might appear in error messages).

The `Content-Security-Policy-Report-Only` header variant is not used in production but is the recommended development mode for testing policy changes — the dev CLI sets `COMRADARR_CSP_REPORT_ONLY=1` so a developer iterating on the frontend sees reports without breaking the page.

#### What CSP Does Not Cover

CSP is an in-browser protection. It does nothing for non-browser API consumers, server-to-server callers, or attacks that don't involve the rendered page (SSRF, the auth flows, the connector layer). Those are covered by their respective sections; CSP is specifically for the active-content threat model on the frontend.

### OpenAPI Spec Exposure

#### The Information-Disclosure Profile

The OpenAPI spec describes every endpoint, every request schema, every response schema, every error code, and every authentication requirement of the Comradarr API. To a developer, it is documentation. To an attacker, it is a complete map of the attack surface — which endpoints exist, which take which parameters, which authentication mechanisms apply to which paths, which fields are validated how.

Public exposure of the spec is the path of least resistance and is the wrong default for a security-sensitive self-hosted application. The decision is between three options:

**Authenticated runtime endpoint.** The spec is served at `/api/schema` (and the Swagger UI / Redoc viewers at `/api/docs`) but requires a valid session or API key. Operators and developers can fetch it; unauthenticated probers cannot. This is the chosen default.

**Build-time generation only.** The spec is generated by a CI step or a dev CLI command, written to `shared/openapi.json`, and not served at runtime at all. Strict but inconvenient — the operator who wants to verify "does my running instance actually expose what I think it does" has to run a separate command, and the type-generation pipeline for the frontend has to fetch it from the build artifact rather than from the running backend.

**Public minimal endpoint.** The spec is served publicly but with sensitive details (auth requirements, internal-only endpoints, error response schemas) stripped. Operationally complex, prone to drift between the served spec and the real API, and hard to get right.

The default is the authenticated runtime endpoint, with build-time generation also available. The frontend type-generation pipeline (`openapi-typescript`) authenticates against the running backend during development and CI using a generation-only API key created for that purpose; in production builds, the spec is generated at CI time and committed to `shared/openapi.json` so production deployments do not need a network round-trip during build.

#### The Endpoint Specifics

`/api/schema` returns the JSON spec to authenticated callers and 401 (with no body) to unauthenticated ones. The unauthenticated 401 response does not include CORS headers — there is no legitimate cross-origin caller for the spec endpoint. Rate limiting applies per source IP at a low rate (10 requests per hour per IP); the spec doesn't change frequently and there is no legitimate need to fetch it more often.

`/api/docs` (Swagger UI) and `/api/redoc` are similarly authenticated. The Swagger UI page itself is served only to authenticated users; the static assets it loads (Swagger UI's own JavaScript and CSS) are served from `/api/docs/static/*` and require authentication at the same level. Hosting Swagger's static assets on a CDN to avoid the auth check is rejected — the third-party CDN dependency adds supply-chain risk for negligible operational benefit.

#### What the Spec Includes and Excludes

The spec describes every endpoint that exists in the running application — there is no "hidden" tier of internal endpoints excluded from the spec, because hidden endpoints are a security antipattern (security by obscurity, and the divergence between spec and reality is itself a bug class). Endpoints that should not exist in production are gated behind environment flags (the dev CLI's debug endpoints) rather than hidden from the spec.

Schema descriptions and field examples in the spec are reviewed before they ship for any unintentional disclosure. A field description that says "the encrypted form of the connector API key" is fine; a description that says "uses AES-256-GCM with the key from `COMRADARR_SECRET_KEY` environment variable" is gratuitous internal detail. The review is part of the schema author's responsibility, enforced by code review rather than a runtime check.

### Cookie Attributes (Relocated and Expanded from Section 15)

#### The Session Cookie

The session cookie name is `comradarr_session`. The attributes are fixed in production code:

- **`HttpOnly`** — the cookie is not accessible to JavaScript via `document.cookie`. An XSS that successfully executes script in the page cannot exfiltrate the session cookie directly. Combined with the strict CSP above, the XSS attack surface is structurally minimal, and the HttpOnly attribute means even a successful injection cannot escalate to credential theft via the cookie.
- **`Secure`** — the cookie is sent only over HTTPS. Browsers ignore this attribute on insecure origins (so it doesn't break local HTTP development on its own), but in production over HTTPS it ensures the cookie never appears on the wire in plaintext.
- **`SameSite=Lax`** — the cookie is sent on top-level navigations to Comradarr (a user clicking a link or bookmark to the dashboard works) but not on cross-origin POSTs (a hostile site cannot POST to Comradarr's API and have the cookie attached). `SameSite=Strict` is rejected because it breaks the bookmark and link cases, leaving the user perpetually appearing logged out when arriving from outside the application.
- **`Path=/`** — the cookie is attached to all paths under Comradarr's origin. There is no path-scoping benefit because the entire application is under a single origin and there are no untrusted same-origin paths.
- **No `Domain` attribute** — without a `Domain` attribute, the cookie is host-only (sent only to the exact host that set it). Setting `Domain=example.com` would broadcast the cookie to every subdomain, which is broader than needed and risky if any subdomain is less trusted.
- **Lifetime** — the cookie itself does not have an `Expires` or `Max-Age`; it is a session cookie at the browser layer (cleared when the browser session ends) but tied to a database-backed session row whose absolute and idle timeouts are enforced by the backend regardless of the browser's cookie persistence. This means closing the browser ends the visible cookie, but the session row remains in the database until its server-side timeout or explicit revocation.

#### The Setup-Claim Cookie

Section 15 introduces the setup-claim cookie. Its attributes mirror the session cookie with two differences:

- **`SameSite=Strict`** rather than `Lax`. The setup wizard is a same-tab flow; there is no legitimate cross-origin entry point during setup, and the stricter policy forecloses any cross-origin claim takeover attempt.
- **`Path=/setup`** rather than `/`. The cookie is meaningful only on the setup routes and is not attached elsewhere, reducing the surface where it could be inadvertently logged or exposed.

The cookie name is `comradarr_setup_claim`. Its TTL is 10 minutes (renewing on each successful wizard action) as specified in Section 15.

#### The Insecure Cookie Opt-Out

`COMRADARR_INSECURE_COOKIES=1` disables the `Secure` attribute on both cookies. This exists for development over HTTP and is logged with a prominent warning at every startup. Production deployments that ship with this flag set are misconfigured, and the warning is loud by design so operators notice. The opt-out does not affect any other cookie attribute — `HttpOnly` and `SameSite` remain enforced even in insecure mode.

---

## 17. API Design Philosophy

### Backend-for-Frontend (BFF) Endpoints

The API is designed around what each frontend page needs, not around generic RESTful resources. A dedicated set of "view" controllers (`/api/views/*`) compose data from multiple services into the exact shape each page requires.

The dashboard view endpoint returns completion statistics, rotation status, recent activity, connector health, and queue state — all in a single response from a single HTTP call. Without BFF endpoints, the frontend would need to make 5–6 separate API calls and compose the data client-side.

The content browser view endpoint accepts filter, sort, search, and cursor parameters, runs a single SQL query with keyset pagination, and returns the page of results with a next-cursor token. The frontend never touches raw data — it receives pre-computed, pre-paginated results.

BFF endpoints use `asyncio.TaskGroup` to execute independent database queries concurrently when the page needs data from multiple sources. Three queries that each take 5ms execute in 5ms total, not 15ms.

### Separate CRUD Endpoints

Alongside BFF endpoints, standard CRUD endpoints exist for connector management, settings, manual sync triggers, and manual search triggers. These follow conventional REST patterns and are used by SvelteKit form actions for mutations.

### Request Schema Strictness

The msgspec strictness settings discussed in Section 7 for *arr responses apply equally to API request schemas at the public boundary, with one difference in the `forbid_unknown_fields` policy. *Every* request schema sets `forbid_unknown_fields=True` — there is no "permissive on unknown fields" category for request bodies, because requests come from external callers and there is no upstream API evolution concern to balance against. An attacker submitting a request body with extra fields (`isAdmin: true`, `roleOverride: "admin"`) is structurally rejected at deserialization rather than risking a typo-based privilege escalation if a future field name collides. Numeric fields likewise use `strict=True` to reject string-coerced values, and string and collection fields carry `msgspec.Meta` size constraints sized for their purpose.

### OpenAPI Contract

Litestar generates an OpenAPI 3.1.0 specification from msgspec Struct definitions and controller annotations. This specification is the contract between backend and frontend. Validation constraints from `msgspec.Meta` annotations (string lengths, numeric ranges, patterns) flow into the OpenAPI schema. The frontend generates TypeScript types from this specification using `openapi-typescript`, and uses `openapi-fetch` for type-safe API calls.

Any change to a backend schema automatically updates the OpenAPI spec, and the TypeScript type regeneration catches type mismatches at build time.

---

## 18. Application Wiring & Lifecycle

### App Factory Pattern

The application is assembled by a `create_app()` factory function that accepts an optional `Settings` override (for testing) and returns a configured Litestar application. The factory registers all route controllers, lifespans, DI bindings, middleware, CORS configuration, OpenAPI configuration, and guards.

A module-level `app = create_app()` call provides the ASGI application instance that Granian imports for production serving.

### Lifespan Ordering

Two lifespans execute in order on application startup and unwind in reverse order on shutdown.

The **database lifespan** creates the SQLAlchemy async engine and session factory, optionally runs Alembic migrations, and stores these on application state. On shutdown, it disposes the engine, closing all database connections.

The **services lifespan** creates all service objects (event bus, crypto service, client factory, sync engine, rotation engine, budget source, planners, dispatcher, tracker), wires their dependencies, stores references on application state for DI resolution, and launches background tasks in a `TaskGroup`. On shutdown, it cancels all background tasks, waits for them to finish, and closes all HTTP client connections.

The ordering guarantee is critical: the database must be ready before services start (services need the session factory), and services must stop before the database closes (in-flight operations need to commit or rollback).

### Startup Sequence

When the application starts: the database engine is created and migrations run if enabled. The setup state is checked by reading the `setup_completed` config key — if setup is not complete, the bootstrap token is generated, printed to stdout, and written to the on-disk token file (see Section 15). The setup gate middleware is registered regardless, but its allowlist is only meaningful while setup is incomplete. The event bus, crypto service, and client factory are instantiated. The budget source is resolved (default or Prowlarr-based, depending on whether a Prowlarr connector exists). The sync engine, planners, dispatcher, tracker, and rotation engine are constructed with their dependencies. Background tasks launch — but the sync coordinator and rotation engine no-op if setup is incomplete, since no connectors can be configured before the admin account exists. Once setup is complete, the sync coordinator immediately checks all connectors and triggers full syncs for any that have never been synced. The rotation engine waits for the first sync to populate the schedule before beginning rotation.

### Shutdown Sequence

When the application receives SIGTERM: the lifespan's finally block cancels all background tasks. Each task's sleep call raises `CancelledError`, and the loop exits cleanly. The `TaskGroup` waits for all tasks to finish. The client factory closes all HTTP sessions. The database engine disposes and closes the connection pool. The process exits.

### Crash Recovery

If the process crashes hard (kill -9, OOM, hardware failure), no state is lost because everything meaningful is in PostgreSQL. On next startup: the sync coordinator detects stale sync timestamps and triggers appropriate syncs. The rotation engine reads `last_searched_at` timestamps and resumes rotation from exactly where it left off. Planned commands that were dispatched but never resolved are detected by the tracker and re-polled for status. In-flight database transactions that were never committed are rolled back by PostgreSQL automatically.

---

## 19. Configuration & Environment

### The Two-Tier Configuration Model

Comradarr splits configuration into two tiers. Environment variables hold only what must exist before the application can start — the master encryption key, the database connection when overriding the bundled default, and a small number of development-only and break-glass toggles. Everything else is runtime configuration held in the database, collected through the setup wizard or edited through the post-setup UI.

The split is deliberate. Environment variables are hard to edit safely on a running system, leak through process inspection tools, and demand that the operator know the right answer before the application has told them what it sees. Runtime configuration in the database can be edited with immediate effect, is subject to audit logging, can be tested end-to-end before commit, and lets the wizard propose values based on the actual request shape rather than demanding the operator describe their own network from memory. The environment-variable tier is therefore kept small on purpose; the wizard and post-setup UI do the heavy lifting.

### The Environment-Variable Surface

**Required.** Only `COMRADARR_SECRET_KEY` (or its `_FILE` equivalent). This is the master encryption key described in Section 15; the application refuses to start if it is missing, unparseable, or matches the weak-value denylist.

**Defaulted by the Docker image.** `DATABASE_URL` is defaulted by the Comradarr Docker image to point at a PostgreSQL instance the image bundles and runs alongside the application process. The 98% homelab case is therefore one environment variable total — the operator pulls the image, sets `COMRADARR_SECRET_KEY`, starts the container, and has a working application with a working database. Operators who want to use an external PostgreSQL (a shared database server, a managed cloud database, an existing homelab Postgres container) override `DATABASE_URL` explicitly; when that override is present, the bundled PostgreSQL does not start. The bundled-versus-external split is discussed further in Section 24.

**Development-only toggles.** `COMRADARR_INSECURE_COOKIES` set to 1 disables the Secure cookie attribute for HTTP development, and `COMRADARR_CSP_REPORT_ONLY` set to 1 switches CSP to report-only mode for iterating on frontend changes. Both log a prominent warning at every startup so they cannot be left enabled in production by accident.

**Observability toggles.** `COMRADARR_LOG_LEVEL` selects the minimum log level for the structured log stream (`debug`, `info`, `warning`, `error`; defaults to `info`). `COMRADARR_LOG_FORMAT` selects `console` (human-readable) or `json` (machine-parseable); the production image defaults to `json` and the dev CLI defaults to `console`, so operators rarely need to set either explicitly. Section 20 describes the logging model these toggles affect.

**Break-glass toggles.** `COMRADARR_RECOVERY_MODE` enables the password recovery flow (Section 15), and `COMRADARR_DISABLE_LOCAL_LOGIN` disables local-password authentication for deployments that exclusively use trusted-header or OIDC auth (Section 15). Both are set deliberately when needed and unset otherwise.

**OIDC provider configuration.** The per-provider OIDC settings (issuer URL, client ID, client secret, display name, redirect URI) are environment variables because they represent cross-cutting identity-provider configuration that the operator typically decides at deploy time and that does not change on a live system. The specific variable naming follows the pattern documented in Section 15's OIDC Provider subsection. A future iteration may move these into the wizard-collected tier; v1 keeps them as environment variables because OIDC onboarding is already complex enough without adding a wizard step.

Every other operational setting — public origin, allowed origins, allowed hosts, reverse-proxy trust allowlist, trusted-header authentication proxy allowlist, trusted-header authentication header names, trusted-header logout URL, session timeouts, sync intervals, rotation defaults, connector-level settings — is runtime configuration in the database, collected through the wizard or the post-setup UI.

### No Configuration Files

There are no YAML, TOML, or JSON configuration files. Environment variables and database-resident runtime configuration are the only configuration mechanisms. This is deliberate for Docker-based deployment where environment variables are the natural boot-time configuration interface and the database is the natural runtime configuration interface. The combination works cleanly with Docker Compose, Kubernetes, systemd, and every other orchestration mechanism homelab operators actually use.

### Sensible Defaults, Verified by the Wizard

The defaults Comradarr ships with are designed to work out of the box for a typical self-hosted setup. Sync intervals are conservative but effective (5-minute incremental, 1-hour deep, 12-hour full). Rotation defaults are safe for modest indexer configurations (100 commands per day, 2 concurrent). Auto-migration is enabled by default so fresh installations just work. For HTTP-boundary settings, the wizard proposes defaults derived from what it observes and the operator confirms them with a live test — the operator never leaves setup with a default that has not been proven to work end-to-end against their actual deployment.

---

## 20. Logging & Observability

### Two Streams, Two Purposes

Comradarr maintains two distinct streams of operational data, and the distinction matters because they answer different questions with different retention, access, and integrity requirements.

The **audit log** (Section 15) answers "who changed what and when." It is the authoritative record of security-sensitive state changes, lives in the database, is append-only at the role level, has its own retention policy, and is accessible through an admin-only UI.

The **structured log stream** (this section) answers "what did the application do over time." It is operational telemetry — routine sync cycles, rotation ticks, HTTP request handling, connector health probes, background task activity. It flows to stdout as JSON lines in production and is handled by whatever log aggregation the operator has configured. It has no database table, no retention policy within Comradarr, and no UI.

An operational action appears in exactly one of these streams, never both. A login appears in the audit log with the actor, provider, and source IP; the structured log mentions that the HTTP request to the login endpoint succeeded with a 200 response and its timing. A connector edit appears in the audit log with the full diff of fields that changed; the structured log records that the request was processed and took N milliseconds. A notification channel creation appears in the audit log with the channel name and kind (the encrypted config is redacted); the individual deliveries through that channel appear in the structured log at DEBUG on success and WARN on permanent failure, under the `notification.delivery.sent` and `notification.delivery.failed` event names (Section 14). The boundary is strict and prevents either stream from becoming a less-trustworthy duplicate of the other.

### Log Levels and Their Meanings

Log levels are strict and consistently applied across the codebase.

**DEBUG.** Detailed internal state intended for development and deep-dive troubleshooting — the shapes of msgspec Structs after deserialization, the composition of planner outputs, the intermediate state of sync diffs. Never enabled in production by default; noise-to-signal is too high. Enabled selectively by setting `COMRADARR_LOG_LEVEL` to `debug` and restarting, when an operator is actively debugging a specific issue.

**INFO.** Routine operational events an operator might want to see during normal operation. Sync cycle started and completed with counts. Rotation tick dispatched N commands for connector X. Connector health check succeeded. Background task heartbeat. HTTP request completed (method, path, status, timing).

**WARNING.** Unexpected but recoverable conditions. A connector returned a malformed response but the retry succeeded. A sync found a series in the mirror that no longer exists remotely and pruned it. An X-Forwarded-For chain from a trusted proxy was malformed and the resolver fell back to the socket peer. A rate limit counter hit its window cap but the request was still served.

**ERROR.** Actual failures. A connector is unreachable after retries. A sync failed and will be retried on the next tick. A dispatched search command timed out waiting for the arr command ID. A database query failed. An unhandled exception escaped a request handler (caught by the middleware before the client saw it, but logged for investigation).

Critical and Fatal levels are not used. A truly unrecoverable condition causes the process to exit; the exit itself is the operator's signal that something went wrong.

### Structured Logging

All logging uses structlog via Litestar's built-in plugin. Log messages are structured key-value pairs, not formatted strings. Every log event carries a fixed set of keys: the event name (a short, typed identifier describing what happened), the level, a timestamp, and any contextual fields bound earlier in the call chain.

Context is bound at service boundaries. The sync engine binds the connector name and sync type; every log message from a sync operation automatically includes these without the caller re-specifying them. The rotation engine binds the connector name and command type. The HTTP middleware binds a request ID (a unique identifier assigned to each incoming request) so every log message generated during a single request is traceable back to that request.

Event names follow a hierarchical convention — `sync.started`, `sync.completed`, `sync.failed`, `rotation.dispatched`, `rotation.tracked`, `connector.health.ok`, `connector.health.degraded`. This gives log consumers a grep-friendly taxonomy: an operator filtering on `event` starting with `sync.` sees everything sync-related, and so on.

In development, logs render as human-readable colored console output with key-value pairs inlined. In production, they render as JSON lines — one object per line, containing every bound field — for machine parsing by log aggregators.

### Request Logging Policy

Every HTTP request logs a single INFO-level event at completion with the method, path (with query string values stripped — only parameter names are logged, never values, to avoid accidental secret disclosure through query parameters in the rare case something sensitive is passed that way), response status code, response size in bytes, timing in milliseconds, and the resolved source IP from the reverse-proxy chain.

**Request bodies are not logged** by default. There is no "log all request bodies for debugging" toggle, because the class of sensitive fields that end up in request bodies — passwords, API keys, session tokens during rotation, new OIDC client secrets — is too broad to allowlist safely. Specific endpoints an operator wants to trace can be exercised locally with a verbose HTTP client outside of Comradarr's log path.

**Response bodies are not logged** under any circumstance. Response bodies may contain bulk data (content browser pages, dashboard aggregations) whose disclosure in logs is both a privacy concern and a log-volume concern. An operator diagnosing a response problem does so by exercising the endpoint directly, not by reading it out of logs.

**Request headers are logged** with a redaction allowlist applied at the structlog processor level. The sensitive names are redacted regardless of context: `Authorization`, `X-Api-Key`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`, and any header name matching a pattern for session-adjacent material. Non-sensitive headers (`Content-Type`, `Accept`, `User-Agent`, `Content-Length`) appear in full at DEBUG level and are summarized at INFO level.

### Secret and PII Handling in Logs

The `Secret[T]` wrapper type (Section 15, Credential and Secret Handling) is the primary defense against secrets leaking into logs. A Secret renders as a fixed redaction marker in any string context — repr, str, msgspec encoding, structlog output. This catches the ordinary leakage paths structurally: the type system refuses to pass a Secret where a plain string is expected, and any attempt to include a wrapped secret in a log event renders as the marker rather than the value.

Two additional defenses complement the type-level guarantee:

The structlog processor chain includes a redaction processor that inspects every log event before rendering. The processor recognizes sensitive header names (the allowlist above) and redacts their values regardless of where they appear. It also pattern-matches against common secret shapes — bearer-token-prefixed strings, anything starting with `cmrr_live_` or other Comradarr key prefixes, and high-entropy strings in fields labeled as secrets — and redacts matches even when they appear in free-text messages or stringified objects. This is defense-in-depth against the case where a developer logs an httpx response directly and forgets that its headers are attached.

The msgspec encode hook for `Secret[T]` (Section 15) ensures that any accidental inclusion in an API response, an event payload, or any other serialized structure renders as the redaction marker rather than exposing the plaintext. The type system should prevent this from happening; the encode hook is belt-and-suspenders.

For **personally identifiable information** that is not classified as secret — user emails, usernames, IP addresses, user-agent strings — the policy is more nuanced. These values appear in the audit log as part of the "who did what" record, where their presence is intentional and load-bearing. In the structured log stream, they appear only where necessary for the operational question being answered: request logs include the resolved source IP (for rate-limiting context and for correlation with the audit log) but not the authenticated user identity — user identity is an audit-log concern. Authentication event logs (at INFO level, not the audit log) include the provider and whether authentication succeeded, but not the username or email — those live in the audit log record of the same event. Connector logs include the connector name (operator-chosen, not user-identifying) and URL (with query strings stripped as described in Section 7) but not any header values.

The distinction is that the audit log is designed to contain identifying information — that is its purpose. The structured log stream is not, and values that are not necessary for operational diagnosis do not go in it.

### Event Payload Discipline

msgspec Structs used for event bus events (Section 13) are reviewed for sensitive-field inclusion at code-review time. The rule is simple: no event Struct carries a `Secret[T]` field, and no event Struct carries a field that holds a value derived from a secret (a hash of an API key, for instance, is still sensitive enough to avoid in a broadcast event). This is enforced by code review rather than at runtime — the `Secret[T]` wrapper would cause runtime redaction if one slipped through, but the rule at design time is that it should never be there in the first place.

Event payloads published on the event bus flow to the SSE stream (Section 13), where any connected frontend receives them. An event field that accidentally carries sensitive data is therefore not just a log concern; it is a cross-client disclosure concern. The audit log subsystem's context payloads are subject to the same review, since they are stored in the database and displayed in the audit UI.

### Traceback Hygiene

When an exception escapes a request handler or a background task, the middleware catches it and logs it. Tracebacks contain local variables at each frame, and those locals frequently include request objects, response objects, and other structures that carry sensitive fields. The naïve default — log the full traceback with locals — would regularly emit API keys, session tokens, and request bodies.

The connector error normalization layer (Section 7) already strips request and response objects from httpx exceptions before they propagate. A similar normalization happens at the request handler boundary for other exception types: when a handler or middleware logs an exception, the logging path replaces the full traceback with a structured representation — the exception type, the message, the relevant frame (file, function, line), and a fingerprint for grouping — and explicitly omits frame locals.

Operators who genuinely need frame locals for debugging enable them through the DEBUG-level switch, which is development-only as a matter of convention even though nothing technical prevents enabling it in production. In production, the normalized form is what gets logged.

### Background Task Logging

Each background task (sync coordinator, rotation engine, Prowlarr health monitor, retention vacuum, command tracker) emits a single INFO-level event at the end of each tick, summarizing what was done during the tick. The sync coordinator logs which connectors were synced, how many items changed, and how long each sync took. The rotation engine logs how many items were searched, which command types were used, and which connectors were active. The Prowlarr health monitor logs indexer status changes.

Errors in background tasks are logged at ERROR level with the traceback-hygiene rules above. The tick loop continues after an error rather than propagating it; the rationale is in Section 21. The error log is the only signal the operator gets that something went wrong, so the message includes enough structured context to diagnose without enabling DEBUG.

### Development vs Production Formats

Development runs render logs as human-readable colored console output with key-value pairs inlined after the message. The dev CLI sets this format automatically. The production Docker image defaults to JSON-line output, suitable for ingestion by any log aggregator that speaks JSON.

Format is selected by `COMRADARR_LOG_FORMAT` with values `console` and `json`. The production image sets this to `json` by default; the dev CLI sets it to `console`. Operators rarely need to touch it.

### Log Destination

Logs flow to stdout and stderr exclusively. Comradarr does not write log files to disk in any deployment mode. This is intentional — in container deployments, the container runtime's logging driver is the canonical mechanism for log persistence, rotation, and forwarding, and writing to files inside the container would duplicate effort and create a second log-handling path to configure and reason about.

The operator's Docker logging driver configuration (or the Kubernetes / Podman equivalent) determines where logs actually go. The default driver writes to JSON-format files that Docker rotates; production operators typically configure a forwarding driver (syslog, journald, fluentd, loki, gelf) to ship logs to a central aggregator. In non-container deployments — which Comradarr does not officially support but does not prevent — the operator's process supervisor captures stdout and stderr per its own conventions.

### Log Volume Controls

A handful of log call sites are shaped like hot loops and would produce enormous log volume without controls. The rotation engine's dispatch loop, the sync coordinator's per-tick evaluation, and the command tracker's polling loop all check every connector on every tick; naïvely logging each check at INFO produces many log lines per minute at steady state.

The pattern applied to these call sites is per-tick summarization: the tick builds up a structured record of what it did for each connector during the tick and emits one INFO event at tick completion covering the whole tick, rather than one event per connector or per check. This keeps the log volume proportional to wall-clock time rather than to the number of connectors, while keeping the operationally useful information (which connector had what result) in a structured form that aggregators can filter on.

Error logs are deduplicated within a short window at the structlog processor level. A connector that is unreachable for an hour produces one ERROR event when the failure begins, periodic "still failing" heartbeats at a slow cadence, and one recovery event when it comes back — rather than one error per failed attempt. The audit log, which does not deduplicate, still records distinct events where appropriate.

### Health Endpoint

A `/health` endpoint reports the application's overall health by checking database connectivity and, optionally, connector reachability. It returns a 200 for healthy or degraded states and a 503 if critical components are unavailable. This endpoint is excluded from authentication for use by container orchestrators and monitoring systems.

The endpoint's response body is deliberately minimal — a JSON object with a top-level status value and a list of checked components with their individual status. No internal state, no version information, no timing breakdowns; the information-disclosure discipline from Section 16 applies here, because the endpoint is reachable without authentication.

---

## 21. Error Handling Strategy

### The Shape of Errors

Comradarr's error handling is built around one shared model that every layer of the application cooperates with — domain code raises structured exceptions, a single translation layer converts them to HTTP responses, the frontend consumes those responses through a typed client, and users see messages that are consistent across every screen. The goal is that adding a new feature does not require inventing new error patterns; the patterns are already in place and the new feature just uses them.

Error responses use RFC 7807 Problem Details for HTTP APIs. This is the IETF standard for structured error responses, and it is the right choice here for several reasons. Every serious HTTP client understands the shape. The format pairs naturally with OpenAPI (Section 25's integration contract), so frontend types flow through automatically. The `type` URI field gives errors stable identifiers that survive message wording changes, which is what i18n needs. And the extensibility model (additional members beyond the standard five) lets Comradarr carry domain-specific context without abusing the standard fields.

Every error response carries five standard fields: a `type` URI identifying the error class (which the frontend uses as an i18n message key and which external tooling uses for classification), a `title` (a short English summary suitable for programmatic inspection and as a fallback when translation is unavailable), a `status` (the HTTP status code duplicated into the body for convenience), a `detail` (a human-readable longer description, translated per the caller's locale), and an `instance` (a URI identifying the specific occurrence — typically a correlation ID that matches a log entry). Beyond these, an `errors` array carries per-field validation issues when the error is a validation failure, and a `context` object carries domain-specific structured data (a connector name, an item count, a retry-after hint) that the frontend can use to render richer error UI.

### The Domain Exception Hierarchy

At the Python layer, every application-specific error descends from a `ComradarrError` base class that carries three fields: a stable error code (a dotted identifier like `connector.unavailable` or `validation.failed` — this is what becomes the `type` URI's terminal segment), a default message (English, used as `title`), and an optional context dictionary (becomes the `context` field in the response). Subclasses refine the base with specific error codes and fixed HTTP status mappings.

The hierarchy is shallow and organized by domain rather than by HTTP status. Authentication errors (`authentication.invalid_credentials`, `authentication.session_expired`, `authentication.api_key_revoked`) sit under one base. Connector errors (`connector.unavailable`, `connector.api_error`, `connector.url_rejected`) sit under another. Validation errors carry a structured list of field-level failures. Authorization errors (`authorization.forbidden`, `authorization.permission_required`) are distinct from authentication because the UX treatment is different — an unauthenticated user gets redirected to login, an unauthorized user gets a "you don't have permission" message.

The shallow depth is deliberate. Deep exception hierarchies encourage "catch the wrong base class and swallow errors that should have surfaced" bugs; a flat hierarchy keeps error handling explicit. When a handler needs to catch a category of errors, it catches the category's direct base, not a distant ancestor.

### The Translation Layer

A single Litestar exception handler catches every `ComradarrError` (and every unhandled exception, though those go through a different path described below) and translates it into a Problem Details response. The handler is the only code that writes error response bodies — no controller ever constructs an error response by hand, and no service ever reaches up into the HTTP layer to shape a response. Services raise; the handler translates.

The handler populates the Problem Details fields from the exception's metadata: the `type` URI is constructed from the error code (`https://comradarr.example/errors/connector.unavailable`, where the host portion is a stable identifier documented in the API reference), the `title` is the exception's default message, the `status` comes from the error class's fixed HTTP mapping, the `detail` is the exception's message run through the i18n layer with the request's locale, the `instance` is the request's correlation ID from Section 20's logging middleware, and the `context` is the exception's context dictionary.

Validation errors get special treatment: the `errors` array is populated from the msgspec validation failure, with one entry per field that failed, each carrying the field path and a per-field `type` URI (so the frontend can attach a specific error message to a specific form field). This is the one place where the Problem Details standard's extensibility is exercised to solve a UX problem that would otherwise require the frontend to guess at error-to-field mapping.

### Unhandled Exceptions

When an exception that is not a `ComradarrError` escapes a request handler — a bug, a genuine unexpected failure, a library raising something the codebase did not anticipate — the same Litestar exception handler catches it, logs it with the traceback-hygiene rules from Section 20, generates a correlation ID, and returns a Problem Details response with `type` set to `internal.unexpected`, `title` "An unexpected error occurred," and `instance` set to the correlation ID. The response does not include any of the exception's details — no message, no type name, no stack — because those are internal information that should not leak to API consumers. The correlation ID gives the operator a grep target to find the full error in the logs.

This covers the "what happens when the code has a bug" case gracefully: the API consumer sees a consistent, safe, parseable error response; the operator gets the full detail in the log stream; neither gets the wrong thing.

### Shared Module Organization

The error handling code lives in a dedicated module (`comradarr/errors/` in the backend directory structure, Appendix A) rather than being scattered across feature modules. The module contains the `ComradarrError` base class, the domain-specific subclass definitions, the Problem Details response construction, the i18n integration for `detail` fields, and the error-code-to-URI mapping. Feature code imports specific exception classes from this module and raises them; nothing else about error handling is the feature's concern.

The shared module is imported by every feature that raises domain errors — connectors, sync, rotation, auth, settings — but does not import from any of them. This one-way dependency means the error module is at the bottom of the dependency graph and can be tested in isolation, and feature modules can be tested against it without pulling in the rest of the application.

### Frontend Consumption

The frontend's typed `openapi-fetch` client surfaces Problem Details responses as typed error objects. SvelteKit form actions that receive a Problem Details response map it to the appropriate UX treatment: validation errors attach per-field messages to form inputs via the `errors` array's field paths, authentication errors trigger a redirect to login with a "your session expired" notice, authorization errors render a "you don't have permission" page with the required permission shown, connector errors render a specific banner explaining which connector failed and offering a retry, and unknown or unexpected errors render a generic error surface with the correlation ID shown so the operator can find the matching log entry.

The mapping from error code to UX treatment lives in a shared frontend module — the mirror of the backend's shared error module — that every page consumes. A new error code introduced by the backend gets a UX mapping added to this module once, and every page that encounters that error handles it consistently.

For errors that occur during a page's load function (server-side, before the page renders), SvelteKit's error boundary renders a dedicated error page. For errors that occur during a form submission or client-side fetch, the error is surfaced inline to the relevant form or component. The distinction is preserved because the UX treatments genuinely differ — a load-time error means "this page cannot render," a submission-time error means "this one action failed, the rest of the page is still valid."

### Error Message Quality

Error messages are written with the reader in mind. An error the operator will see — a misconfigured connector, a validation failure, an authentication problem — says what went wrong, says what to do about it if the answer is not obvious, and does not blame the user. "Connector 'sonarr-main' returned a 401 Unauthorized response; the API key stored in Comradarr is likely rotated or invalid. Re-enter the API key from Sonarr's settings page to resolve." is the standard Comradarr aims for.

Error messages are translated through the i18n layer. The translation catalog (Section 28) holds one entry per error code, with the English message as the source and translations landing through Weblate. The context dictionary's values are interpolated into the translated message — the catalog entry is a template like "Connector {connector_name} returned {status_code}" and the interpolated values fill in at render time. This keeps the translation surface small (one entry per error code rather than one per error occurrence) and lets translators see the full shape without having to guess.

Internal errors (the `internal.unexpected` case) have a deliberately generic message — "An unexpected error occurred; please report this with ID {correlation_id}." — because they are by definition cases the code did not anticipate, and attempting to be clever about the message would leak internals or produce misleading text.

### Background Task Resilience

Background tasks (sync, rotation, health monitoring, retention vacuum) catch every exception within their tick functions using the same shared error module. An exception in one tick is logged through Section 20's structured log stream at ERROR level with a structured representation (type, message, relevant frame, fingerprint) but without the full traceback's frame locals. The next tick executes normally; a temporary failure does not cascade into a permanent broken state.

The `TaskGroup` supervising these tasks propagates any exception that escapes the tick error handling — which in practice means a bug in the error handler itself, since the handler is supposed to catch everything. If that happens, Granian's worker recycling restarts the process and the application recovers from its PostgreSQL-resident state. This is the last-resort path, not the normal path.

The rationale for catching-and-continuing in background tasks rather than crashing is that most failures are genuinely transient — a connector is briefly unreachable, the database has a momentary connection blip, a DNS lookup fails once. Crashing the whole process on each of these would produce restart churn that is worse than the symptom. Persistent failures still surface because the structured log records every tick's outcome, and the rate-limited ERROR-level events in the log stream make "this connector has been failing for an hour" visible to any operator reading their logs or watching a dashboard.

### Transient vs Permanent Classification

The HTTP client layer (Section 7) classifies every outbound failure as either transient or permanent. Transient failures include 5xx responses, connection timeouts, connection refused errors, DNS resolution failures, and TLS handshake failures; these are retried with exponential backoff up to a bounded retry count. Permanent failures include 4xx responses (which indicate a bug in Comradarr or a misconfigured connector — retrying will not help), authentication failures (which indicate an expired or invalid credential), and validation failures (which indicate the response did not match the expected schema).

The classification happens once at the HTTP client boundary, surfaces as the appropriate `ComradarrError` subclass to the caller, and from that point on the exception carries the classification information. The translation layer uses it to populate a `context.retryable` field in the Problem Details response, which the frontend uses to decide whether to offer a "retry" button or a "re-configure" one.

---

## 22. Testing Strategy

### The Testing Philosophy

The testing strategy is shaped by one guiding principle: test behavior against realistic inputs, not against the tester's assumption of what realistic inputs look like. Hand-written mocks drift from reality as developers guess at API shapes; recorded fixtures from real systems do not. The tradeoff is fixture rot when upstream APIs change, which is handled by recording-refresh tooling and a periodic live-integration canary. This gives tests that catch bugs the developer did not imagine, not only bugs the developer anticipated when writing the mock.

The test suite is structured into four categories, each with a distinct scope, speed profile, and determinism guarantee. The cumulative promise is that a successful CI run means "this code works against realistic inputs, has typed interfaces, is formatted, is linted, has no known-vulnerable dependencies, and passes the static and runtime checks the supply chain section commits to" — not "this code probably works if the environment is lucky."

### Unit Tests

Unit tests verify pure functions and isolated classes with no I/O. The natural targets are the planner (combinatorial optimization over sets of eligible items), the differ (fingerprint comparison producing structured changesets), tier assignment logic, cursor encoding and decoding, budget computation, URL classification, HTTP boundary configuration validation, and the error code to Problem Details URI mapping. These components have no external dependencies, no database, no network, and no time-sensitive behavior, so they are tested with direct assertions.

Unit tests run fast (the full unit suite completes in under a second), run in parallel without coordination, and are deterministic by construction. They are the fastest feedback loop in the development workflow — a change to a pure function is verified in milliseconds.

Property-based testing via Hypothesis is used for the components that have interesting invariants. For the planner: for any set of eligible items, the planner's output covers all of them, no command contains items from different connectors, and the total number of commands is no greater than the number of items. For the differ: for any pair of fingerprints, the changeset correctly identifies all additions, removals, and modifications. For cursor pagination: for any sort order and any page size, the concatenation of pages equals the full result set with no duplicates and no gaps.

### Integration Tests Against a Real Database

Integration tests verify the interaction between components using a real PostgreSQL instance. Repository tests verify query correctness, including pagination, aggregation, and the role-based access constraints from Section 8. Sync engine tests write to mirror tables and verify the resulting schedule state. Rotation engine tests dispatch commands and verify tracking behavior. Audit log tests verify the append-only semantics at the database level — attempting an UPDATE or DELETE from the application role's connection fails with the expected permission error.

Integration tests use a dedicated test database that is created fresh for each test run and dropped afterward. Alembic migrations run once at the start of the test session to bring the database to the current schema; individual tests use transaction rollback (a test runs in a transaction that is never committed) for isolation between cases within the session. This is faster than dropping and recreating tables for each test, while still giving every test a clean slate.

The test database uses the same PostgreSQL version as the bundled production image, so SQL behavior differences between versions cannot produce "passes in CI, fails in production" bugs. CI provisions PostgreSQL as a service container in the workflow; local development uses the bundled PostgreSQL from the dev CLI (Section 5).

### Fixture-Based Connector Tests

Connector tests are the part of the testing story that most benefits from "as close to real as possible" and is the area most likely to have mocking drift if handled carelessly. The approach Comradarr takes is recorded fixtures: a developer runs a recording tool against a real Sonarr, Radarr, or Prowlarr instance, captures the full request and response for a representative set of interactions (series list, series detail, search command, command status poll, indexer list), and commits the recordings to the repository as fixture files. Tests replay the fixtures against the connector code without making real network calls.

The fixtures are structured as paired request/response records with the request matched by method, path, and relevant headers. The recording tool strips authentication material (the real API key is redacted to a placeholder that tests substitute back) and normalizes any fields that would leak the source environment (the tester's IP, timestamps, user-agents of the recording client). The recorded fixtures are therefore safe to commit and represent behavior that is realistic without being environment-dependent.

Fixture rot — the problem of recorded fixtures diverging from current upstream behavior — is handled two ways. First, the recording tool is committed to the repository and runnable against any compatible upstream instance, so refreshing a fixture set is a command, not a manual exercise. Second, a nightly CI job runs a small "canary" suite against the upstream's public demo instances where available, or against a maintainer-provided live instance, detecting when fixtures no longer match real behavior. When the canary fails, the issue tracker gets an automated issue describing what changed, and a maintainer refreshes the fixtures.

This pattern gives the realism of integration testing with the determinism and speed of unit testing. It catches the bugs that hand-written mocks miss (assumption errors, field-shape misunderstandings, edge cases in the real API that the developer did not anticipate) while not depending on network access or a live upstream to run the test suite. It is the approach used by major HTTP-client-heavy Python projects (the Python standard library's `urllib` test suite uses a similar pattern for real-world compatibility tests).

### API Tests

API tests use Litestar's `AsyncTestClient` with the app factory pattern. A test creates an app instance with overridden settings (test database, disabled auto-sync, connector fixtures instead of real HTTP), makes HTTP requests against it, and asserts on the responses. These tests verify the full request lifecycle: middleware (including the HTTP boundary resolution, CSRF checks, and auth), dependency injection, controller logic, service composition, repository queries, and the Problem Details error translation. A test that exercises "POST /api/connectors with invalid data returns a 422 with a specific validation error shape" is an API test.

API tests are the natural home for end-to-end error handling verification: every error code declared in the shared error module has at least one test that provokes it and asserts the resulting Problem Details response shape. This is what makes Section 21's error handling a testable contract rather than aspirational documentation.

### Frontend Component Testing

When the frontend work begins, component tests use Vitest with a browser-like environment for testing Svelte components in isolation. The accessibility discipline from Section 28 is partially enforced through component tests: every test rendering a component that includes interactive elements runs an `axe-core` pass and fails on WCAG 2.2 AA violations. This catches the structural a11y issues (missing labels, insufficient contrast, ARIA misuse) automatically. Manual a11y testing for nuanced cases (actual screen reader behavior, keyboard-only navigation flows) remains a maintainer responsibility but is not in scope for automated CI.

Visual regression testing and end-to-end browser tests (Playwright or similar) are deferred to post-v1. They are genuinely useful but their maintenance overhead is substantial, and the fixture-based and API-level tests above cover most of the regression-detection surface that matters for a project at this scale.

### The App Factory for Testing

The `create_app(settings)` factory (Section 18) accepts test settings that override database URLs, disable background task auto-start, adjust intervals, and swap the live HTTP client for the fixture-replaying one. Tests create their own app instances with these overrides, ensuring isolation between tests and between test and production configurations. This is what makes the API test category viable — the app under test is structurally identical to the production app except for the explicit overrides.

### Coverage and Quality Signals

Code coverage is tracked but not gated on a specific threshold. Chasing a coverage number produces shallow tests that exercise code paths without verifying behavior; the rule Comradarr applies instead is that every code change includes tests that verify the change's actual behavior, and coverage is observed as a diagnostic rather than enforced as a gate. A PR that drops overall coverage is not automatically rejected, but the diff is flagged for review, and a reviewer confirms the drop is intentional (removed dead code) rather than accidental (new untested code).

Mutation testing (via mutmut or cosmic-ray) is a candidate post-v1 addition. Running mutation testing on the pure-function cores (planner, differ, classification) would give a stronger quality signal than coverage alone, at the cost of substantial CI time. It is deferred until the value is clear.

### CI Integration

The testing categories integrate with CI at different cadences. Unit tests and API tests run on every pull request alongside the static checks from Section 23 — the full "fast" suite completes in under two minutes and gates every merge. Integration tests with the real database run on every pull request but in a separate workflow job that can fail without blocking the fast-path feedback. Fixture-based connector tests run on every pull request as part of the API test category, since they are effectively unit-speed tests of connector code. The live-instance canary runs nightly against main and opens issues for drift.

The cumulative CI pipeline on a typical PR completes in roughly five minutes from push to green. This is the target feedback loop the project commits to; slower-than-five-minutes CI is treated as a workflow bug to be fixed rather than accepted.

---

## 23. Supply Chain & Code Discipline

### Philosophy

Supply chain security in Comradarr is enforced through a small number of high-confidence invariants rather than a sprawling set of policies. The project is greenfield, targets bleeding-edge tooling across the stack, and is operated by a small team — which means the discipline has to be enforced by tools rather than checklists, and it has to produce useful signal on every pull request rather than during rare security audits. The approach is: commit the lockfile with hashes, pin every dependency to a known version at install time, run a tight set of static checks on every change, scan for known vulnerabilities in dependencies continuously, and forbid the Python primitives that enable silent supply-chain attacks at the language level. Everything else — heavier integration testing, fuzzing, formal audits — is additive and happens on a longer cadence.

### Dependency Locking and Hash Verification

The Python dependency tree is managed by `uv` and locked in `uv.lock`, which is committed to the repository. The lockfile records the exact version and content hash of every resolved dependency (direct and transitive), giving reproducible installs that cannot be retroactively altered by a compromised package mirror. CI and production installs use `uv sync --frozen` (or the equivalent `--locked` flag), which refuses to install if the lockfile's hashes do not match the artifacts the mirror actually serves. An attacker who compromises a package repository to serve a different artifact for an existing version-pinned release fails at install time, because the hash comparison rejects the substitution.

The lockfile is updated deliberately, by a developer running `uv lock` as part of a normal dependency-addition or upgrade PR. The resulting diff — which shows added, removed, or version-bumped entries and their new hashes — is part of the pull request review. Lockfile changes are not generated automatically in CI; they are always the product of a human action that another human reviews.

The same pattern applies to the frontend when it lands: Bun's `bun.lock` (or npm/pnpm equivalent, depending on final tooling choice) is committed, and frontend installs in CI and production use the lockfile-enforced frozen install mode.

### Dependency Vulnerability Scanning

A dependency vulnerability scan runs on every pull request and on a scheduled cadence against the main branch. For Python, this is `uv pip audit` (or the equivalent `uv tool run pip-audit` invocation) against the active environment derived from the lockfile, checking each installed package and version against the PyPI Advisory Database and the OSV database. Findings above a configurable severity threshold fail the CI job; findings below the threshold produce a warning but do not block the PR.

The scan is fast — typically under ten seconds — so it runs on every PR alongside the static checks rather than on a nightly schedule only. An upgrade that introduces a known-vulnerable transitive dependency shows up immediately on the PR that made the change, which is the moment when fixing it is cheapest.

Scheduled scans against the main branch catch the scenario where a vulnerability is disclosed after a dependency was locked in: no PR is currently in flight, but the codebase is nonetheless affected. The scheduled job opens an issue with the finding's details when it detects a new vulnerability, giving the maintainer a trackable item rather than a silent failure.

### Automated Dependency Updates

Updates to pinned dependencies are proposed by an automated tool (renovate or dependabot — the choice is deferred to implementation time based on whichever is easier to configure for the scope below) with two distinct behaviors depending on update type. Security updates — any lockfile entry whose current version matches a known vulnerability — are proposed automatically with the CI checks as the quality gate; a passing CI run on a security-update PR is a strong signal that the upgrade is safe to merge. Non-security updates — routine version bumps, new minor releases, new major releases — are proposed on a longer cadence and require explicit maintainer review. The split ensures that security-critical updates are not held up by general "update fatigue" while non-security updates are reviewed rather than auto-merged.

Both kinds of update PRs update the lockfile in the same format a human would, so there is one canonical way to propose a dependency change regardless of whether the author is a human or an automation.

### GitHub Actions Pinning

GitHub Actions references in workflow files are pinned to the current version tag (for example `actions/checkout@v6` rather than `actions/checkout@main`). This is tag pinning, not commit-SHA pinning — the tradeoff being accepted is that a tag is a mutable reference that a compromised maintainer account could repoint to a malicious commit, which is a known risk class in the Actions ecosystem. The mitigation is that first-party actions (maintained by GitHub itself under the `actions/` organization) are substantially lower-risk than arbitrary third-party actions, and the project limits third-party action usage to a small set of well-known, well-maintained publishers. When a third-party action is introduced, its publisher and maintenance status are considered as part of the introduction PR, not just its functionality.

Action versions are updated on the same automated cadence as Python dependencies, so a workflow referencing `actions/checkout@v6` that later becomes `@v7` gets a PR proposing the bump, reviewed by the maintainer, and merged or declined.

### Linting and Formatting Scope

The Python codebase is linted and formatted by `ruff` configured with the Python 3.14 target version and an explicit ruleset. The enabled rule categories include the standard ones (`E`, `W`, `F`, `I`, `UP`, `B`, `C4`, `SIM`, `RET`, `TID`, `TCH`) plus the security category `S` in full — `S` includes the Bandit-derived rules that flag dangerous primitives including raw SQL string construction (`S608`), use of `pickle` (`S301`, `S302`, `S403`), use of `eval` / `exec` (`S102`, `S307`), `subprocess` with `shell=True` (`S602`), weak cryptographic primitives (`S303`, `S324`), hardcoded passwords and tokens (`S105`, `S106`), and binding to all interfaces when it should be loopback (`S104`). The `S` category produces errors, not warnings — a PR that introduces any of these patterns fails CI.

Specific `S` rule suppressions are allowed at the line level with a `# noqa` comment that includes both the rule code and a brief justification explaining why the specific usage is safe. The justification is part of the code review: a reviewer seeing `# noqa: S301 - deserializing only trusted CI artifacts` has enough context to validate the exception. Silent suppressions without justification are themselves a lint violation in the project conventions.

Formatting is also handled by ruff (using its built-in formatter, not black) with configuration aligned to the lint rules. The formatter runs in check mode in CI and fails on any unformatted code; developers run it in write mode locally through the pre-commit hook.

Dead-code detection and import-cycle detection are enabled through the relevant ruff rules and through basedpyright's configuration; the combination catches unreachable functions, unused imports across modules, and circular imports at type-check time rather than at runtime.

Frontend linting and formatting are handled by **Biome** (`@biomejs/biome` v2.4+). Biome supersedes both Prettier and ESLint with a single Rust-native binary that lints and formats JavaScript, TypeScript, JSON/JSONC, CSS, and the `<script>` / `<style>` blocks of Svelte files. The recommended rule set is Biome's `recommended` plus the nursery rule `useSortedClasses` (set to `warn`) for Tailwind/UnoCSS class ordering. Configuration lives in a project-root `biome.json` keyed to the published 2.4 schema. The `--files-ignore-unknown=true --no-errors-on-unmatched` flags on `biome check` make the runner safe for mixed-language working trees. Svelte template markup itself (control-flow blocks, bindings, slots) is *not* parsed by Biome — that surface is covered by `svelte-check` and the Svelte compiler, both of which run alongside Biome in the pre-commit suite (Section 23.3). Like ruff, Biome runs in check mode in CI and in write mode locally through the pre-commit hook.

### Type Checking

Type checking is performed by basedpyright in its recommended mode, which is stricter than pyright's default "basic" mode and catches a superset of issues including implicit Any, untyped function definitions, and unsafe casts. The `Secret[T]` wrapper type (Section 15) relies on this strictness — the type system is what prevents accidental concatenation of secrets with plain strings and forces explicit `.expose()` calls at the narrow set of exfiltration boundaries.

basedpyright runs on every PR as part of the CI static check set. Like ruff, its findings are errors; a PR that fails type-check cannot be merged without either fixing the finding or adding a justified `pyright: ignore` comment.

### Pre-commit Hook Execution

The pre-commit hook suite is managed by `prek` (a Rust-native reimplementation of the `pre-commit` framework, used by CPython, FastAPI, Airflow, and others for its speed and zero-Python-runtime startup). Comradarr commits to the `prek.toml` configuration format (documented at <https://prek.j178.dev/configuration/>) as the canonical pre-commit configuration; prek also accepts the upstream `.pre-commit-config.yaml` format, but the project standardises on TOML for clarity and to keep the Python and frontend hook surfaces in one schema-typed file. Developers install `prek` as part of the standard development setup (via `uv tool install prek` or the standalone installer), and the git hooks are registered once per clone.

The hook suite enforces, at minimum: **ruff lint in check mode, ruff format in check mode, basedpyright in recommended mode**, `uv lock --check` to ensure `uv.lock` is consistent with `pyproject.toml`, **Biome `check` in write mode for the frontend (with `--files-ignore-unknown=true --no-errors-on-unmatched`), `svelte-check --threshold warning` for Svelte template/type issues, and `tsc --noEmit` for full-project TypeScript type checking**, and a handful of standard sanity hooks (no merge conflict markers, no trailing whitespace, newline at end of file, no large files, no accidentally-committed private keys, no direct commits to `main`). Every hook runs on every commit by default; developers can skip with `git commit --no-verify` for emergency cases but the CI pipeline runs the same hooks and will reject the push if they fail.

CI's initial scope — the "fast static checks on every PR" bar — is exactly the `prek run --all-files` invocation plus the dependency vulnerability scan. Heavier checks (integration tests, the full test suite with database, frontend build verification) are added incrementally as the project matures; the initial set is chosen to be fast enough that CI completes in under two minutes on a typical PR, keeping the feedback loop tight.

The canonical `prek.toml` for the Comradarr monorepo is:

```toml
# prek.toml — pre-commit hooks configuration
# Docs: https://prek.j178.dev/configuration/

# Builtin hooks — fast, offline, Rust-native
[[repos]]
repo = "builtin"
hooks = [
  { id = "trailing-whitespace" },
  { id = "end-of-file-fixer" },
  { id = "check-merge-conflict" },
  { id = "check-added-large-files" },
  { id = "detect-private-key" },
  { id = "check-json" },
  { id = "check-toml" },
  { id = "check-yaml" },
  { id = "no-commit-to-branch", args = ["--branch", "main"] },
]

# Backend (Python) — ruff, basedpyright, uv lockfile drift
[[repos]]
repo = "local"
hooks = [
  { id = "ruff-lint",   name = "ruff lint",      entry = "uv run ruff check --fix",       language = "system", types = ["python"], pass_filenames = true },
  { id = "ruff-format", name = "ruff format",    entry = "uv run ruff format",            language = "system", types = ["python"], pass_filenames = true },
  { id = "basedpyright", name = "basedpyright",  entry = "uv run basedpyright",           language = "system", types = ["python"], pass_filenames = false, always_run = true },
  { id = "uv-lock",     name = "uv lock --check", entry = "uv lock --check",              language = "system", files = "(^pyproject\\.toml$|^uv\\.lock$)", pass_filenames = false },
]

# Frontend (SvelteKit / Bun) — biome, svelte-check, tsc
[[repos]]
repo = "local"
hooks = [
  { id = "biome-check", name = "biome check",   entry = "bunx biome check --write --files-ignore-unknown=true --no-errors-on-unmatched", language = "system", types = ["text"], files = "\\.(js|ts|jsx|tsx|json|jsonc|css|svelte)$" },
  { id = "svelte-check", name = "svelte check", entry = "bunx svelte-check --threshold warning", language = "system", always_run = true, pass_filenames = false },
  { id = "type-check",  name = "tsc type check", entry = "bunx tsc --noEmit",            language = "system", always_run = true, pass_filenames = false },
]
```

The three `[[repos]]` blocks correspond to the three layers of static checks: cheap repository hygiene first, then the Python toolchain (ruff/basedpyright/uv), then the frontend toolchain (Biome/svelte-check/tsc). The `frontend` block is omitted in clones that do not yet contain a `frontend/` directory; prek's `local` repos are inert when their hooks have no matching files, so the same `prek.toml` is checked in unconditionally.

### Code-Level Bans

A small set of Python primitives are banned outright across trust boundaries in the Comradarr codebase. "Banned" means ruff flags them as errors (via the `S` category rules) and they can only appear with a justified `# noqa` suppression that a reviewer has to approve.

**`pickle`, `marshal`, and `shelve`** are banned because they deserialize arbitrary Python objects and execute arbitrary code during deserialization. There is no input source in Comradarr from which a pickled payload would be a legitimate format; msgspec handles every legitimate deserialization case with type-safe, non-code-executing semantics.

**`eval` and `exec`** are banned for the same class of reason. Dynamic code evaluation is almost never what's actually needed, and when it is (very rare), the use site deserves specific review to confirm the input cannot be attacker-controlled.

**`subprocess` with `shell=True`** is banned because it enables shell-injection attacks when any part of the command string comes from variable input. Comradarr's subprocess usage is limited and all invocations pass a list of arguments directly, not a shell string.

**String-formatted SQL construction** is banned via `S608`. Every query is parameterized through SQLAlchemy's ORM or Core, or constructed from a template string (Python 3.14's PEP 750) whose interpolations the driver binds rather than interpolating. A `# noqa: S608` comment on a query is a code-review red flag.

**`yaml.load` without a safe loader** is banned via `S506`. The safe loader is used for every YAML parse, which covers the pre-commit configuration and the OpenAPI spec if it ever ships as YAML.

**Insecure hash primitives** (`hashlib.md5`, `hashlib.sha1` for security-relevant use) are banned via `S303` and `S324`. Exceptions for legitimate non-security use (content-addressable caching keys, fingerprinting) require the `usedforsecurity=False` argument, which documents the intent inline.

Code-level bans complement the type system's enforcement of the `Secret[T]` wrapper. Together they produce a codebase where the dangerous primitives are forbidden at the language level, and the few exceptions are explicit, justified, and reviewed.

### The Development CLI's Role

The development CLI (`dev_cli/`, Section 5) is the single entry point through which developers interact with the supply chain machinery. A `dev_cli` command runs the full static check suite (equivalent to the CI's bar), another updates the lockfile and regenerates the OpenAPI-derived TypeScript types, another bootstraps a local development database and runs migrations. The intent is that a developer's local workflow mirrors CI's exactly — if `dev_cli check` passes locally, CI will also pass — with no configuration drift between "how CI runs things" and "how developers run things."

The CLI is itself a Python package managed with `uv` (Section 5) and is subject to the same supply chain discipline as the main backend: locked dependencies, vulnerability scanning, pre-commit hook enforcement, and the same ruff and basedpyright configuration.

### Versioning and Release Policy

Comradarr follows semantic versioning (semver 2.0.0) for both the Python backend and the frontend: the version number is three integers separated by dots — major, minor, patch — and their semantics are the usual ones. Major version increments signal backwards-incompatible changes to the operator-facing contract (the HTTP API, the configuration surface, the database schema in ways that require manual migration, the Docker image's deployment shape). Minor version increments add functionality in a backwards-compatible way. Patch increments are bug fixes that preserve existing behavior.

The first public release is v0.1.0. Comradarr starts its lifecycle in the 0.x range, which semver explicitly reserves for initial development where the public API is not yet considered stable. Users running a 0.x release accept that minor-version bumps may carry breaking changes; the release notes for any breaking change in the 0.x series describe the change prominently. The 1.0.0 release is cut when the project considers itself feature-complete for the initial scope and commits to the stable-API contract that semver's majors-are-breaking rule implies.

Git tags mirror the semver version literally: the tag for version 0.1.0 is `0.1.0`, with no prefix. Human-facing release titles on the GitHub Releases page and in release notes prefix the version with `v` for readability — "v0.1.0 — Initial Release" is the title style — but the machine-readable tag stays clean. This separation matters because tooling that parses tags (version detection in CI, container image tagging, package publishing) works more cleanly against pure semver strings than against prefixed strings.

Docker image tagging follows the standard pattern for semver-versioned applications. The image publishes under multiple tags simultaneously: the full semver (`0.1.0`) pins exactly one release and never moves, the minor-major prefix (`0.1`) rolls forward with patch releases within the minor series, the major prefix (`0`) rolls forward with minor releases within the major series, and `latest` always points at the most recent stable release. Operators who want reproducible deployments pin to the full semver; operators who want automatic patch updates pin to the minor-major tag; operators who want automatic minor-and-patch updates pin to the major tag. SHA-pinning (pulling the image by its manifest digest) is also supported for the strictest reproducibility posture and is the recommended form for CI-driven redeployment pipelines.

Release cadence is deliberately not committed to a schedule. Comradarr releases when changes are ready, not on a calendar. A "minimum time between releases" would produce artificial bundling of unrelated changes; a "maximum time between releases" would create pressure to ship before something is ready. The practical rhythm will emerge from the project's activity level rather than being imposed upfront.

Long-term support commitments are also not made. The project is a homelab tool maintained by a small team, and promising LTS for specific versions would be a commitment the maintainer cannot reliably keep. Operators who need long-term stability pin to a specific semver and upgrade on their own schedule, with the understanding that security patches for older versions are not guaranteed. In practice, critical security fixes will be backported to the immediately previous minor version where feasible, but this is a best-effort commitment, not a contractual one.

### License and Contribution Model

Comradarr is licensed under the GNU Affero General Public License version 3.0 (AGPL-3.0). This is a deliberate choice and a load-bearing one: the AGPL ensures that any service running a modified version of Comradarr must make its modifications available to the service's users, which is the appropriate protection for a self-hosted tool that might otherwise be taken proprietary by a hosting provider. Operators running Comradarr unmodified for their own use face no additional obligations beyond those of any AGPL-licensed software.

All contributions to the Comradarr codebase are accepted under the AGPL-3.0 license. Contributors who submit pull requests are acknowledging that their contributions will be licensed under AGPL-3.0 as part of the project. The project does not require a separate Contributor License Agreement (CLA) beyond this implicit acceptance, and does not require a Developer Certificate of Origin (DCO) sign-off. The inbound-equals-outbound licensing model — contributions are licensed to the project under the same license the project distributes — is the simplest arrangement that preserves the AGPL's protections and the clearest statement of expectations for contributors.

A contribution that cannot be licensed under AGPL-3.0 cannot be accepted into the project. The most common cases where this arises are code copied from other projects with incompatible licenses (MIT and Apache-2.0 are compatible, proprietary code is not, and AGPL-2.0-only or GPL-3.0-only dependencies require care because AGPL-3.0 is not technically their outbound license even though it is inbound-compatible). The project documents this constraint in its contribution guidelines so potential contributors know up front.

Third-party dependencies are vetted against AGPL-3.0 compatibility at addition time. The supply chain section's lockfile review is also a license review: a PR that adds a new dependency includes a note confirming the new dependency's license, and a reviewer checks the addition against the project's license compatibility matrix. Dependencies under permissive licenses (MIT, Apache-2.0, BSD) are always compatible. Dependencies under GPL-3.0 or LGPL-3.0 are compatible. Dependencies under AGPL-3.0 are of course compatible. Dependencies under other copyleft licenses require case-by-case review. Proprietary or unlicensed dependencies are rejected.

The translation catalog repository (Section 28's Weblate integration) is licensed under AGPL-3.0 with a narrow carve-out for translation strings: translators retain authorship attribution on their individual translations, but the translated strings are licensed under the same terms as the rest of the project. This is the standard arrangement for AGPL-licensed applications with Weblate-managed translations and ensures that the translated UI is as freely redistributable as the codebase.

---

## 24. Deployment Architecture

### Docker Container

Comradarr is distributed as a single Docker image containing the Python backend, the pre-built SvelteKit frontend assets, and a bundled PostgreSQL server. The backend (Granian) serves the API and the frontend's static files. The bundled PostgreSQL runs inside the same container as a supervised sibling process, started by the container's init system before the application process and shut down after it. The single-image approach means the 98% homelab case is one image, one container, one environment variable — there is no docker-compose file to write, no sibling service to coordinate, and no networking between containers to configure.

The Docker image is based on `python:3.14-slim-bookworm` with PostgreSQL installed alongside. It runs as a non-root user for the application process; the bundled PostgreSQL runs as the postgres system user with its data directory mounted from a persistent volume the operator maps at run time. The Granian entrypoint is configured with a single worker, single-threaded runtime, uvloop event loop, 6-hour worker lifetime for automatic memory leak mitigation, and failed worker respawn. The bundled PostgreSQL is configured with conservative defaults appropriate for a single-application workload on modest homelab hardware — small shared-buffers, modest connection limits, WAL archiving disabled by default.

### Database: Bundled by Default, External by Override

The bundled PostgreSQL is the default for 98% of deployments. When the container starts and no `DATABASE_URL` is set in the environment, the init sequence starts the bundled PostgreSQL, waits for it to become ready, runs any pending Alembic migrations against it, and then starts the application pointed at the local database over a Unix socket. The operator sees a single-container deployment with zero database configuration. Data persists via a single volume mount covering the PostgreSQL data directory, and the operator's backup strategy can be as simple as snapshotting that volume.

The external-database path is available for the minority of operators who prefer to manage their own PostgreSQL: a shared database server covering multiple self-hosted applications, a managed cloud database for operators running Comradarr outside their home network, or an existing homelab Postgres container they already maintain. When `DATABASE_URL` is set in the environment, the bundled PostgreSQL is not started — the container's init sequence detects the override and skips straight to running migrations against the external database before starting the application. This "bundled unless overridden" pattern means there is no separate image variant for the two cases and no configuration complexity for either path; the presence of `DATABASE_URL` is the entire distinction.

One consequence worth naming explicitly: the bundled PostgreSQL is a convenience for the common case, not a general-purpose database server. It is not exposed on the container's network by default (it listens only on its internal Unix socket), it is not tuned for high concurrency, and it does not provide any replication or failover. Operators who outgrow the bundled database, who want their data on dedicated hardware, or who need any form of redundancy should use the external-database path. The wizard does not offer a way to migrate from bundled to external mid-install — that operation is a straightforward pg_dump/pg_restore the operator performs themselves when they decide to make the switch.

### No Other External Dependencies

Beyond PostgreSQL (bundled or external), Comradarr requires nothing. No Redis, no message broker, no Elasticsearch, no separate background worker service. The application is a single process alongside its database.

### Container Networking

Comradarr must be able to reach the Sonarr, Radarr, and optionally Prowlarr instances on the operator's network. In a typical Docker setup, all the *arr applications share a Docker network with Comradarr and communication uses container names or internal DNS. The operator provides the URLs during connector setup through the post-setup UI, where each connector addition runs through the SSRF and hostile-response defenses described in Section 7 before being persisted.

---

## 25. Frontend Integration Contract

### Technology Stack (Deferred Implementation)

The frontend will be built with SvelteKit 2 using Svelte 5 Runes, Bun as the runtime and package manager, UnoCSS with presetWind4 and presetShadcn for styling, and shadcn-svelte for the UI component library. **Biome** (linter + formatter for JS/TS/CSS/JSON and Svelte `<script>`/`<style>` blocks; replaces Prettier and ESLint) handles all static formatting and linting; Svelte template markup is covered by `svelte-check` and the Svelte compiler. It will use svelte-adapter-bun for production deployment. The visual token set is installed from the tweakcn "Northern Lights" theme via `bunx shadcn@latest add https://tweakcn.com/r/themes/northern-lights.json`, which seeds the project's `globals.css` with the full OKLCH color palette, typography stack, radius scale, shadow values, and tracking variables that the rest of the frontend consumes.

### Aesthetic Direction: "Watching the Sky"

Comradarr commits to one visual direction, anchored on the Northern Lights token set: a calm, atmospheric interface that reframes the product's perpetual-rotation engine as patient observation rather than aggressive scanning. The product is not hunting for targets; it is waiting for better releases to surface, indefinitely, and the UI should feel lit rather than urgent. This direction deliberately diverges from the "radar scope" metaphor the product name might suggest — phosphor green, industrial tone, dense gauges — in favor of the aurora palette's atmospheric character: deep arctic-blue backgrounds, aurora-green primary, violet-blue accent.

The direction carries three concrete commitments, each load-bearing on how components are built and styled.

**Atmosphere over ornament.** Dashboard hero areas and major section backgrounds carry subtle diagonal aurora gradient washes — primary into accent into secondary at very low alpha, well below any contrast threshold for text that overlays them. These washes never appear behind data surfaces, never behind tables, never behind forms. Their purpose is to make the application feel lit; their absence on data-dense surfaces keeps those surfaces legible and performant.

**Primary-accent discipline.** Aurora-green (the theme's `primary` token) is the operational color — healthy state, active rotation, a successful action completing. Violet-blue (`accent`) is the informational color — hover states, focus rings, informational callouts, links. Destructive red (`destructive`) is reserved for destructive and error states. The chart colors (`chart-1` through `chart-5`) are for charts only; they do not migrate into UI decoration, because exhausting their distinctiveness on ornament leaves charts visually undifferentiated when they actually need to communicate quantitative structure.

**Mono numerals.** Every numeral that represents a count, a timing, a percentage, or a timestamp renders in `font-mono` (JetBrains Mono, from the theme). Labels and prose render in `font-sans` (Plus Jakarta Sans). This is not aesthetic preference — proportional numerals jitter horizontally when SSE-driven updates re-render them, and the dashboard is alive with live-updating counters. Tabular-figures on a mono stack eliminates the jitter at essentially zero cost.

Iconography follows the shadcn-svelte default, which is the Lucide icon set; no custom icons are commissioned or hand-drawn for v1. Lucide's geometric, evenly-weighted line style harmonizes with the Northern Lights typography stack without visual friction, and standardizing on it keeps the bundle small and the visual vocabulary uniform.

### App Shell Layout

The primary application shell is sidebar-based. A persistent left-hand navigation column lists the major sections (dashboard, content, connectors, settings, and other top-level destinations); the main content region occupies the remainder of the viewport. This mirrors the layout conventions of Sonarr, Radarr, Prowlarr, and the rest of the *arr ecosystem the operator is already navigating, reducing the cognitive shift between tabs.

The sidebar hosts the single persistent motion affordance described below (the rotation heartbeat indicator, sited near the product wordmark). It collapses to an icon-only rail below the `md` breakpoint and opens via hamburger below the `sm` breakpoint. The shell itself consumes the `sidebar`, `sidebar-foreground`, `sidebar-primary`, `sidebar-accent`, and `sidebar-border` tokens exclusively; it does not mix in the generic background tokens, so a future theme swap that redefines sidebar tokens independently still renders the shell coherently.

A command palette (Cmd+K / Ctrl+K) is deliberately deferred out of scope for v1. Keyboard-first navigation is treated as a progressive-enhancement concern rather than a first-class commitment — focus management, visible focus rings (using the `ring` token), and logical tab order are required of every component, but dedicated keyboard-shortcut surfaces beyond standard browser behavior are a v1.x concern.

### Theme Tokens and Token Discipline

All color, spacing, radius, shadow, tracking, and typography values in the frontend come from the Northern Lights token set. There are no hand-authored hex colors or ad-hoc font stacks in component code. Component styling consumes tokens — via UnoCSS's presetShadcn integration, which exposes the CSS custom properties as Tailwind-style utility classes — and nothing else. A future theme swap (whether by the user, by the project, or via a theme-switcher feature) touches one file rather than the entire codebase.

Per-surface density is the one dimension where tokens are scoped-overridden rather than consumed unchanged. The theme defines a global `--spacing` value; specific surfaces override it in their own DOM subtree via a `--spacing-local` custom property scoped to the surface container. The global remains available for components that should be density-consistent across the app (dialogs, toasts, form controls); the override applies to containers that need tighter or looser rhythm (the content browser wants dense rows; the dashboard wants calm cards). This keeps the token surface small while allowing the three density treatments the product needs without forking components.

### SSR Theme Handling

The application must not flash the wrong theme on first paint. The mechanism is designed to paint once in the correct theme on every initial render — SSR, SPA navigation, return visit, authenticated or not — and to switch without visible transition.

A user's theme preference (`light`, `dark`, or `system`) lives in `user_preferences.theme` (Appendix B). For authenticated users with an explicit `light` or `dark` preference, `hooks.server.ts` reads the preference from the database-resolved session context during SSR and writes the `data-theme` attribute on `<html>` directly into the initial HTML response. No client-side resolution is needed; the browser paints the correct theme from the first byte.

For users with the `system` preference, and for unauthenticated visitors (the login page, the setup wizard), a non-HttpOnly cookie named `comradarr_theme_pref` holds the last-resolved value (`light` or `dark`). On first visit, a four-line inline script runs synchronously in `<head>` before any stylesheet is parsed: it reads `prefers-color-scheme`, writes the cookie if absent, and sets `data-theme` on `<html>`. On subsequent visits, the cookie is sent with the request and `hooks.server.ts` uses it directly, skipping the client-side resolution step entirely.

Preference changes hit a small form-action endpoint that updates the database row (for authenticated users) and the cookie in one response. The change takes effect on the next navigation without a transition; a brief class-based fade could be added in v1.x if operators report the instant swap as jarring, but the v1 target is efficient and correct rather than ornamented.

The explicit three-value `light` / `dark` / `system` model is preserved in both the database and the settings UI, so the distinction between "I chose this theme" and "I chose to follow my OS" survives across sessions. This matters because an operator who wants the app to track their system setting actively wants that behavior; collapsing the three states to two would silently strand them in whichever theme was current when their preference was stored.

### Motion Contract

Motion in the UI is small, purposeful, and universally respects `prefers-reduced-motion`. Three patterns are specified; no others are introduced without revisiting this section.

**Sidebar heartbeat.** A single small indicator sited near the product wordmark in the sidebar pulses slowly while the rotation engine is actively dispatching commands — roughly one pulse every two seconds, at low opacity, ease-in-out. When the rotation engine is idle (paused, no connectors configured, pre-setup, or between ticks with a long sleep interval), the indicator is static. This is the only persistent motion in the product; its absence is as meaningful as its presence, and operators learn quickly to read it as a liveness signal.

**Tint-on-change.** When an SSE event causes a visible counter or status to change, the containing card receives a single 200ms background-tint pulse — primary color at 8% alpha, ease-out — and then returns to rest. The numeral or status itself does not animate; it swaps atomically in the same frame as the pulse begins, because count-up animations waste attention budget on values that were never uncertain. The card tint is the announcement; the atomic swap is the value. Multiple concurrent changes on the same card debounce to a single pulse to prevent flickering during rapid update bursts.

**Page-load choreography.** On the first paint of a fresh page, above-the-fold content reveals in a staggered cascade driven by a single keyframe with `animation-delay` values offset by 20–30ms per element, ease-out, 200ms duration. The cascade terminates at the fold; content rendered below the fold appears without animation to avoid triggering reveal motion during the user's scroll. SPA navigations within the same layout do not replay the cascade — only hard loads and route-group crossings do — because re-triggering reveal motion on every navigation would rapidly become noise.

`prefers-reduced-motion: reduce` collapses every animation to an instantaneous state swap. The heartbeat indicator becomes static. The tint-on-change becomes an atomic swap with no tint. The page-load cascade becomes an instant render. This is non-negotiable; every component that produces motion checks the media query (via a shared `useReducedMotion` composable) and skips the motion path when it returns `reduce`. No animation is introduced without this guard.

Motion is CSS-driven wherever possible. Svelte's built-in transition directives cover mount and unmount events without additional dependencies. A JavaScript animation library is deliberately not pulled in for v1 — the motion vocabulary this section commits to is small enough to implement in CSS and Svelte transitions alone, and adding a runtime animation library for three patterns is not justified.

### Density Scales by Surface

The three major surface families have different density needs and receive different `--spacing-local` treatments under the token-override mechanism described above.

**Dashboard** is the breathing-room surface. Standard spacing, generous card gaps, vertical rhythm calibrated for the long glanceable sessions where an operator is checking on the system rather than acting on it intensively. This is where the aurora gradient wash lives; it is the surface where atmosphere matters most.

**Content browser** is the density-tight surface. Row padding is tightened, horizontal rhythm compressed, filter chips sized down. An operator scrolling through 500,000 items needs to see as many as possible per screenful without the list becoming illegible. Mono numerals and single-line rows keep the grid predictable at the expense of ornament; the aurora wash is absent because it would interfere with the dense grid's legibility. Virtual scrolling (specified below under "Content Browser at Scale") means only visible rows exist in the DOM, so the tight row height is a visual concern rather than a rendering one.

**Settings and wizard surfaces** use the density-structured treatment. Forms carry standard spacing between input groups but tightened vertical rhythm within each group; paired labels and fields sit close together while unrelated groups have clear visual separation. The test-driven-configuration visual language — a consistent four-state affordance for *observed* / *proposed* / *testing* / *committed* or *rejected* — is a reusable primitive that appears wherever settings-with-live-tests are edited, in both the setup wizard's HTTP boundary verification phase (Section 15) and the post-setup settings UI.

Density is applied by scoping the `--spacing-local` custom property at the surface container; descendant components inherit the override without needing per-component knowledge. A component built for the dashboard works in the content browser without modification; the density is a property of where it renders, not a property of how it is built.

### Architecture: Server-Side Rendering with BFF Endpoints

The frontend uses SvelteKit's server-side rendering with `+page.server.ts` load functions that call the Python backend's BFF endpoints. This provides instant first-paint (no empty shell waiting for client-side fetches), progressive enhancement (forms work without JavaScript), and URL-driven state (all filter, sort, and pagination state lives in URL search params, making views bookmarkable and shareable).

Load functions make localhost HTTP calls to the Python backend using SvelteKit's provided `fetch` (which handles cookie forwarding and relative URLs during SSR). For a self-hosted application running on the same machine, these calls complete in microseconds.

### API Type Safety

The Python backend generates an OpenAPI 3.1.0 specification. The frontend generates TypeScript types from this specification using `openapi-typescript`. An `openapi-fetch` client provides fully typed API calls where the path, parameters, and response type are all inferred from the generated types. This creates end-to-end type safety across the Python/TypeScript boundary.

A development script automates the type generation: with the backend running, the script fetches the OpenAPI spec and regenerates the TypeScript types file. This runs during development iteration and in CI to catch contract mismatches.

### Authentication Flow

SvelteKit's `hooks.server.ts` validates the session cookie on every request by calling the Python backend's session validation endpoint. If the session is invalid or missing, non-public routes redirect to the login page. The session cookie is HttpOnly, so client-side JavaScript cannot access it — all auth validation happens server-side.

Route groups organize pages by auth requirement: `(app)/` routes require authentication, `(auth)/` routes are unauthenticated (login, setup), and any future public routes would have their own group.

### Data Flow

For page loads, the SvelteKit load function calls one BFF endpoint per page, receives the exact data shape the page needs, and passes it to the component. SvelteKit's streaming support allows critical data (summary stats) to block rendering while secondary data (activity feed, detailed stats) streams in after first paint.

For mutations, SvelteKit form actions submit to the backend via POST requests. The `use:enhance` directive provides optimistic UI updates and pending states. Form actions handle the UX concerns (redirects, flash messages, error display) while the Python backend handles the domain logic.

For real-time updates, a Svelte 5 class-based store wraps an `EventSource` connection to the Python backend's SSE endpoint. Incoming events trigger `invalidate()` on relevant SvelteKit data dependencies, causing automatic re-fetching of affected load function data.

### Content Browser at Scale

The content browser page handles 500,000+ items using: URL search params for all filter/sort/search state (changes trigger SvelteKit load function re-runs), cursor-based pagination via the backend (constant-time regardless of depth), virtual scrolling on the client (TanStack Virtual or similar — only visible rows exist in the DOM), `$state.raw()` for the item list (no deep reactivity needed on read-only paginated data), and debounced search input (300ms delay before pushing to URL params).

---

## 26. Roles and Permissions

### Scope for v1

Comradarr ships v1 with a single role: admin. Every user is an admin; admins have every permission; there is no permission check that does anything other than "is this an authenticated user." The 98% case is a single operator with a single account, so role machinery in v1 would be cost without benefit.

That said, the shape of the eventual multi-role system is committed now because post-v1 is where the cost of not having thought it through appears. Retrofitting authorization into a codebase that was written assuming "every authenticated request is fully authorized" means auditing every endpoint, and the audit almost always misses something. Committing to the shape now means every new endpoint is written with the permission check in place from day one, even if the only role the check knows about is admin.

### The Permission Model Shape

Permissions are named, typed, and grouped by domain. The groups correspond to the major feature surfaces: connectors (add, edit, delete, pause), content (view, trigger manual search, pause items), sync (view status, trigger manual sync), settings (view HTTP boundary config, edit HTTP boundary config, view OIDC, edit OIDC, view other security), audit log (view, export), API keys (create own, revoke own, view all, revoke any), users (view, invite, edit roles, delete).

Each endpoint declares the specific permission it requires. The permission-check middleware resolves the current user's role, looks up the role's permission set, and either allows the request or returns 403. The role-to-permissions mapping lives in the database, so a future operator can create custom roles with bespoke permission sets without a code change.

### The v1 Implementation

In v1, exactly one role exists (`admin`) and it holds every permission. The middleware still runs on every endpoint — checking that the authenticated user is an admin — but the check is trivially true for the only account that exists. The machinery is exercised on every request even though it currently has nothing to filter. This means when v1.x introduces a second role, the existing endpoints already have their permission declarations in place; only the role definitions change.

Role assignment in v1 is implicit: the first admin account created during setup is an admin, and any user subsequently provisioned by the trusted-header or OIDC providers is also an admin (with a setting to change this default post-v1). There is no UI for role management because there are no other roles to assign.

### Post-v1 Roles (Design Sketch)

The roles the system will eventually support:

**Admin** — every permission, as v1. The operator who installed Comradarr holds this role.

**Operator** — can view everything, trigger manual searches and syncs, pause items, view the audit log. Cannot edit HTTP boundary config, cannot manage other users, cannot view or edit authentication provider settings, cannot create or revoke API keys except their own. This is the role for a household member or trusted collaborator who should be able to nudge the system but not reconfigure it.

**Viewer** — read-only access to dashboards and content. Cannot trigger any operation that sends traffic to a connector. This is the role for showing the system to someone without letting them affect it.

Role assignments for users provisioned via trusted-header or OIDC can be driven from claims on those providers' tokens — an `X-Comradarr-Role` header for trusted-header auth, a `groups` claim for OIDC — with a configurable mapping from claim values to Comradarr role names. Claim-driven role assignment means an operator who already manages roles in their identity provider doesn't need to duplicate that state in Comradarr.

### API Key Scope

API keys in v1 carry an optional scope restriction — a subset of the owning user's permissions — specified at the moment the key is created. An integration that only needs to trigger searches can be given a key that holds only the "trigger manual search" permission, limiting the blast radius if the key leaks. The default behavior when no scope is specified is to inherit the full permission set of the creating user, so an operator who doesn't care about scoping can click through without friction; the narrower-scope path is surfaced in the creation UI as an expandable advanced section.

The scope is evaluated on every request rather than frozen at creation, so if the owning user's role changes (an admin is demoted to operator, for example), the key's effective permissions shrink accordingly — a scope cannot grant permissions the current role no longer holds. Revoking a permission from the owning user's role automatically removes it from every key they created, without needing to walk the key list and update each one.

v1 cannot grant a key *more* permission than its creator has. An admin-created key can be scoped down to operator-equivalent privileges; an operator-created key cannot be given admin permissions. The scope is a ceiling that is narrower-or-equal to the creating user's role, never higher.

In v1, the only role is admin, so "narrower than the creating user" means "narrower than full admin" — which is still meaningful even before other roles exist, because an integration with write-only scope on a specific feature is safer than a key with full admin privileges. When the operator and viewer roles land post-v1, the same scope machinery handles them without code changes.

### Schema Impact on v1

The `users` table's `role` column (Appendix B) holds a string role name. The `role_permissions` table maps role names to permission names; in v1 this table contains only admin's entries. The `api_key_scopes` table is populated in v1 — every API key with a narrower-than-owner scope has one or more rows here, one per permission the scope grants; keys without any scope rows are treated as inheriting the owner's full permission set. The permission-check middleware queries this table on every API-key-authenticated request as part of the same resolution pass that looks up the user's role.

These are additive schema decisions: v1 ships with the tables, the single admin role, and working API key scoping. The only runtime cost is a permission lookup on each authorized request, which is a small indexed query that the connection pool handles without contention.

---

## 27. Backup, Recovery, and Upgrades

### What Needs to Be Backed Up

Comradarr's persistent state is exclusively in PostgreSQL. There is no file-based state outside the database — no image cache, no generated artifact directory, no file-based session store. A complete backup is a complete snapshot of the PostgreSQL data.

For the bundled-PostgreSQL deployment (Section 24), this is a single volume: the one the operator mounts for the PostgreSQL data directory. Snapshotting that volume produces a complete, consistent backup as long as the snapshot is taken at a point where no write transaction is mid-commit. For filesystem-level snapshots (ZFS, Btrfs, LVM), this is naturally atomic. For volume-copy backups (restic, borg, rsync against a stopped container), stopping the container before the copy is the simplest correct answer; alternatives involve pg_dump.

For the external-PostgreSQL deployment, the operator's database already has a backup strategy; Comradarr's tables live in a schema the operator's backup routine covers, and the operator's existing tooling applies.

The `COMRADARR_SECRET_KEY` is not in the database — it is in the operator's environment configuration. It must be backed up separately. The secret key is the root of decryption for every encrypted field in the database; without it, every encrypted value becomes irrecoverable. The operator's environment-variable management (Docker secrets, `.env` file outside the container, password manager, however they manage it) is what keeps the key safe. Comradarr does not attempt to store, version, or back up the key on the operator's behalf.

### What Is Lost if the Secret Key Is Lost

If the operator loses their `COMRADARR_SECRET_KEY` and has no backup of it, the specific values that become irrecoverable are: every connector's API key (since Comradarr cannot decrypt them to send them to Sonarr or Radarr anymore), every OIDC provider's client secret, and the setup-claim proof (which is irrelevant after setup anyway). Everything else — the mirror tables, the schedule, the audit log, user accounts, session rows, HTTP boundary configuration, allowed-origins list, connector URLs, user preferences — is stored in plaintext and survives the key loss intact.

The practical recovery path in this scenario: the operator re-enters their connector API keys through the UI (the upstream *arr instances still have the keys, so the operator fetches them from there), re-enters any OIDC client secrets from their identity provider, and resumes operation. No sync state is lost, no schedule state is lost, the rotation engine picks up exactly where it left off. This is an hour or two of re-entering secrets, not a week of rebuilding the install.

The key loss scenario therefore gracefully degrades rather than catastrophically failing. The operator's homelab media library is their own; Comradarr tracks state about that library but does not own the library. Losing the ability to decrypt connector credentials is an inconvenience, not a disaster.

### Recovery from Data Loss

Full data loss — the PostgreSQL volume is gone, no database backup exists — is recovered the same way as a fresh install. The operator starts a new Comradarr container, the bootstrap flow runs, they go through the setup wizard, they re-add their connectors, and the sync engine rebuilds the mirror from scratch by fetching every series, movie, and episode from the *arr instances. This takes minutes to hours depending on library size and indexer response times, and it produces an identical steady-state to the pre-loss install because every piece of mirror data is reconstructible from the authoritative upstream source.

What is *not* automatically recovered this way: the audit log history (which was local to Comradarr and is genuinely gone), the rotation state (last-searched-at timestamps — the rotation engine will start from all items being treated as "never searched" and cycle through them fresh), and any user-side state like custom preferences or paused-item markings. The audit log loss is the meaningful one; the rotation state loss is cosmetic (the rotation re-establishes steady state in a few days).

For operators who cannot accept audit log loss, the database-backup path is the answer. Comradarr does not provide a backup command; the operator's existing database backup tooling (pg_dump for external Postgres, volume snapshots for bundled, offsite sync for either) is what they already know how to use, and reinventing that in Comradarr would add operational surface without adding capability.

### The Upgrade Path

Upgrading Comradarr is pulling a newer container image and restarting. The init sequence inside the container runs Alembic migrations against the database before the application process starts. The application does not start until the migrations have completed; a failed migration leaves the container exited with a non-zero status and a log message identifying what failed, so the operator's orchestration layer (Docker's restart policy, Kubernetes' readiness probe, systemd) sees the failure rather than a silent broken state.

Migrations are forward-only. Comradarr does not ship down-migrations because rollback is almost always worse than forward-fix for a schema change, and maintaining down-migrations doubles the migration review surface for negligible operational benefit. If an upgrade's migration breaks, the operator restores their database backup and investigates the migration before re-attempting the upgrade.

For breaking changes between major versions, the release notes call out the specific breaking change and, where applicable, provide a pre-upgrade data migration step the operator runs manually before pulling the new image. Comradarr aims to make these rare — most changes are additive — but acknowledges that they occur over a long enough timeline.

### Backup Reminders

Before any upgrade, the container startup log emits a "have you backed up?" reminder if a pending migration is detected. This is a log message, not a blocking prompt; an operator who has automated their upgrades and accepts the risk can continue without interaction. The reminder's purpose is to surface to operators who are manually pulling an image that a schema change is about to happen, giving them a chance to snapshot first.

Post-v1, an optional pre-upgrade automatic backup is a candidate feature: the container notices a pending migration, runs pg_dump against its own database, writes the dump to a configured backup directory, and only then proceeds with the migration. This is out of scope for v1 because it requires the operator to have configured a backup directory (which most will not have done for a fresh install) and because the volume-snapshot approach is better anyway for most deployments. If the feature ships, it would be opt-in rather than default.

### Downgrades

Downgrading is not supported. If a migration from v1.5 to v2.0 changes the schema, running v1.5 against a v2.0 database fails because v1.5 does not know how to interpret the new schema. The operator's recovery path for an unsuccessful upgrade is restoring the pre-upgrade database backup and running the previous image against it, not attempting to run the previous image against the post-migration database.

This is stated explicitly in the release notes for any migration-bearing release so operators know what the rollback posture is before they begin.

---

## 28. Internationalization and Accessibility

### Internationalization Strategy

Comradarr's user-facing strings pass through an internationalization layer from the first line of code that emits them, even though v1 ships with only English. The cost of wrapping strings at write-time is trivial; the cost of retrofitting i18n into a codebase that was written assuming English is enormous and produces a long tail of untranslated strings that ship to users who expected full translation.

On the backend, user-facing strings use Python's standard `gettext` infrastructure, with message catalogs in the GNU `.po` / `.mo` format. The backend strings that need i18n are narrow: API error messages, validation failures, log messages that surface to the UI (rare), and the built-in notification templates (Section 14), which live in the catalog under the `notification.{event_type}.{channel_kind}.{subject|body}` key namespace and flow through Weblate's standard placeholder-validating pipeline. Internal operational log messages do not go through i18n because they are for the operator (who reads English in logs) and for forensic review.

On the frontend, strings are wrapped by a Svelte-compatible i18n library (the current best fit is `svelte-i18n` or `@inlang/paraglide-js-adapter-sveltekit` — the specific choice is deferred to implementation time based on which has the cleanest Svelte 5 Runes integration). Catalogs are JSON files organized by locale and feature area. The frontend catalog is the majority of the translation surface, since the frontend is where most user-facing text lives.

### Weblate Integration

The translation workflow is managed through Weblate, self-hosted or via the public hosted instance for FLOSS projects. The catalogs (both backend `.po` and frontend JSON) live in a dedicated directory in the repository that Weblate polls. Translators work in Weblate's web UI; their submissions land as pull requests on the Comradarr repository, reviewed by maintainers, and merge into main. This is the same pattern GNOME, KDE, and most major FLOSS projects use.

The Weblate integration implies a few specific design constraints: string extraction is automated (a CI step scans the source for new or changed strings and updates the source catalogs, which Weblate then picks up for translation), message IDs are stable (a string that already has translations does not lose them if the English wording is lightly edited — Weblate's fuzzy-matching handles minor edits, but large rewrites need a new message ID), and context hints are provided for strings whose meaning depends on context (the same English word may need different translations in different contexts, and translator notes in the catalog help disambiguate).

### Locale Selection

Users select their locale through a user-preference setting in the post-setup UI. The selection is stored on the `users` table. The backend's `gettext` calls use the authenticated user's preferred locale when handling their request; the frontend's i18n library uses the locale attribute emitted by SvelteKit's SSR based on the same preference. For unauthenticated pages (login, setup), the locale is inferred from the browser's `Accept-Language` header with English as the fallback.

In v1, the UI offers only English. As translations become available, they appear in the locale selector automatically. Translations for a locale remain available as long as the catalog has entries; a poorly-translated locale (Weblate shows translation percentage per language) may be gated behind a "show incomplete translations" toggle to avoid presenting a half-translated UI as if it were done.

### Accessibility Baseline

The accessibility target is WCAG 2.2 Level AA. This is an industry-standard baseline that covers keyboard navigation, screen reader support, color contrast, focus management, and semantic HTML. Meeting AA is not onerous for a project that uses shadcn-svelte (whose underlying Bits UI primitives inherit accessibility behavior from Radix UI's well-audited patterns) and that avoids custom interactive widgets where a standard component exists.

The project-level commitments that shape component choice and code review:

**Keyboard navigation.** Every interactive element is reachable and operable with keyboard alone. Focus order follows reading order. Focus is visible with a clear focus-ring style (not the browser default, which is often suppressed by design frameworks — the project ensures the framework's focus style is preserved or replaced rather than removed). Keyboard traps (where focus cannot escape a region) are treated as bugs.

**Screen reader compatibility.** Semantic HTML is the baseline — `<button>` for buttons, `<a>` for links, `<h1>`-`<h6>` for headings, `<label>` associated with form controls. ARIA attributes are added where semantic HTML alone is insufficient (live regions for real-time updates from SSE, landmarks for the main navigation, `aria-describedby` on form fields with inline help text). ARIA is used sparingly and only where needed; over-application of ARIA often produces worse screen reader behavior than plain semantic HTML.

**Color contrast.** Text meets WCAG 2.2 AA contrast ratios (4.5:1 for normal text, 3:1 for large text) against its background across all themes (light, dark, and any future variants). The UnoCSS theme tokens are chosen with this in mind and verified by an automated contrast check as part of the frontend test suite.

**Reduced-motion preference.** Animations and transitions respect the `prefers-reduced-motion` media query. Operators who have motion sensitivity or who simply prefer instant state changes get them.

**Form labels and error messages.** Every form field has an associated label, either visible or screen-reader-only. Validation errors are announced to screen readers via ARIA live regions and are associated with the relevant field via `aria-describedby`. Error messages are descriptive enough to act on without additional context.

**Responsive layout.** The UI works on screen widths from roughly 360 pixels upward. Mobile operators (managing their homelab from a phone) are a real use case, and the layout accommodates them without a separate mobile application.

### Testing for Accessibility

Automated accessibility testing runs as part of the frontend test suite using axe-core or a similar WCAG linter integrated into the component test harness. This catches the majority of structural issues (missing labels, insufficient contrast, ARIA misuse) automatically. Manual testing with keyboard-only navigation and with at least one screen reader (NVDA on Windows, VoiceOver on macOS) is performed on major UI changes; the specific cadence is a maintainer commitment rather than a blocker in CI, because the tooling gap between automated and manual accessibility testing is real and a manual pass cannot be gated by CI realistically.

Accessibility issues reported by users are treated as bugs, not enhancement requests. A WCAG AA violation that ships is a regression.

---

## 29. Telemetry and Metrics

### The FLOSS Posture

Comradarr does not phone home. No usage analytics, no crash reporting to a third-party service, no feature-flag telemetry, no "anonymous usage statistics" toggle. The only data that leaves the operator's network is the outbound traffic the operator explicitly configures — requests to their own Sonarr, Radarr, Prowlarr instances, and OIDC identity provider if they've set one up. Nothing else.

This is a deliberate posture. Self-hosted homelab tools vary widely on this axis, and the FLOSS-aligned end of the spectrum (where Comradarr sits) treats "the application makes network calls the operator did not explicitly configure" as a bug. Operators who want operational insight into their own instance get it through self-hosted observability stacks that they own end-to-end.

### Prometheus Metrics

Comradarr exposes a Prometheus-compatible metrics endpoint at `/metrics` that any self-hosted monitoring stack can scrape. The endpoint is opt-in — disabled by default, enabled through a post-setup UI toggle that also configures which IPs are allowed to scrape it. The IP allowlist is applied at the endpoint level and is independent of the reverse-proxy trust configuration; the common deployment is that the operator's Prometheus instance is on the same Docker network or local subnet as Comradarr, and the allowlist covers that range.

The metrics exposed are the standard operational kind: request counts and latencies broken out by endpoint and status code, sync cycle duration per connector, rotation engine dispatch counts per tick, command tracking latencies, budget consumption per connector, active session count, database connection pool saturation, and the expected Python process metrics (memory, GC, CPU). The naming follows Prometheus conventions (snake_case, unit suffixes, histogram buckets for latencies).

No metric label carries user-identifying or operator-identifying data. Connector identifiers appear as labels because they are operationally useful and are operator-chosen names, not personal data. Source IPs, user agents, and user IDs are never emitted as metric labels; those live in the audit log and the structured log stream, not in metrics.

### OpenTelemetry Tracing

For operators who want distributed tracing, Comradarr emits OpenTelemetry traces to an OTLP endpoint the operator configures. Tracing is opt-in, disabled by default, and the endpoint is configured through the post-setup UI with the same treatment as the metrics endpoint. Traces cover the request lifecycle (HTTP request → controller → service → repository → database), background task ticks, and outbound HTTP calls to *arr instances.

The choice of OTLP rather than a vendor-specific protocol (Jaeger's native, Zipkin's native, vendor-specific agents) is the FLOSS-aligned call — OTLP is an open standard, every major self-hosted tracing backend (Tempo, Jaeger, Zipkin, SigNoz) consumes it, and none of them lock the operator into a vendor. Operators send traces to their own Tempo or Jaeger instance; Comradarr does not care which.

Span attributes follow the same discipline as metric labels: no user-identifying data. Connector names and operation types appear; IPs, user IDs, and request bodies do not.

### Health Endpoint

The health endpoint at `/health` (specified in Section 20) is the minimal always-on observability surface. It requires no authentication, is suitable for container orchestration readiness probes, and returns a small JSON object with the application's overall status and the status of its key components. It is not Prometheus-compatible and not intended as a general metrics endpoint; it is a liveness signal.

### No Analytics Plane

There is no event-tracking system, no funnel analytics, no A/B testing infrastructure, no feature usage counters that roll up to a remote service. If Comradarr ever adds a "did feature X get used" question that the maintainers want to answer, it is answered by asking users through a poll or release notes survey, not by instrumenting the application to report back.

This is a commitment that shapes which dependencies the project takes on. Any third-party package whose transitive dependencies include an analytics client (even if disabled by default) is preferred against. The dependency review in the supply chain section (Section 23) includes this consideration.

---

## 30. Import and Export

### The Configuration Snapshot

Comradarr supports exporting a portable snapshot of its configuration and importing that snapshot into another instance (or the same instance after a reinstall). The snapshot is a single file — a passphrase-encrypted archive containing a JSON document with a schema version — that captures the non-derivable state of the install: the parts that the operator set up and that cannot be reconstructed from the *arr instances or from scratch.

What the snapshot includes: all connector configurations (name, type, URL, per-connector settings, and the plaintext API keys — decrypted from the source instance's storage and re-encrypted under the passphrase for transport), HTTP boundary configuration (public origin, allowed origins, allowed hosts, trusted proxies), trusted-header authentication settings (proxy allowlist, header names, logout URL, provisioning policy), OIDC provider configurations with client secrets included (same treatment as connector API keys), user accounts with their provisioning provider recorded but password hashes excluded (users re-authenticate after import — a password hash from the source instance is not portable because the new instance may have different Argon2id parameters, and transporting password material is the wrong instinct anyway), API key metadata with the plaintext keys included (so integrations continue working after import without the operator needing to rotate keys across every consumer), role assignments when roles are introduced post-v1, and user preferences.

What the snapshot does not include: the mirror tables (reconstructible by sync), the schedule (rotation resumes from fresh state after import, which is cosmetic), planned commands (in-flight commands are connector-specific and cannot be meaningfully moved), sync state (reconstructed on first sync after import), session rows (stale; users re-authenticate), rate limit state (stale; starts fresh), or the audit log.

The audit log exclusion is deliberate. Audit log entries are tied to the install that produced them — the actor IPs and timestamps reference a specific deployment context that does not translate to a new install. Importing audit entries into a fresh install would either require fabricating linkage (e.g., remapping user IDs) or accepting that the entries are orphaned references. Both are worse than cleanly starting a new audit log on the new install. An operator who needs the old audit log for forensic or compliance reasons retains the snapshot file itself; the audit log from the pre-snapshot install is separately exportable as JSON lines if the operator wants it, through an audit-specific export endpoint that produces a plaintext log rather than an encrypted snapshot.

### Passphrase-Based Encryption

The snapshot file is encrypted under a user-supplied passphrase at export time. The same passphrase is required at import time to decrypt it. Comradarr does not store the passphrase anywhere — on the source instance or the target — and cannot recover a snapshot whose passphrase has been forgotten. The operator takes responsibility for the passphrase the same way they take responsibility for `COMRADARR_SECRET_KEY`: write it down, put it in a password manager, keep it somewhere safe, and understand that losing it means losing the ability to use the snapshot.

The encryption scheme uses a key derived from the passphrase via Argon2id with strong parameters (higher than the interactive-authentication parameters used for password hashing, because snapshot decryption is a rare operation and can tolerate a longer derivation step). The derived key is used with AES-256-GCM, the same primitive used for at-rest field encryption (Section 15), over the serialized JSON document. A random salt is generated per export and stored alongside the ciphertext in the snapshot file; the Argon2id parameters are also embedded in the file so future parameter changes do not break old snapshots.

The snapshot file format is straightforward: a small header containing the format version, the Argon2id parameters, the salt, and the GCM nonce; followed by the authenticated ciphertext. The file extension is `.comradarr-snapshot` so operators know what they're looking at when they find one.

The export wizard enforces a minimum passphrase length and rejects passphrases on the common-password denylist (the same denylist used for local password validation). The operator is given a strength indicator but is not prevented from choosing a strong short passphrase if they want one — the minimum-length rule is a floor, not the only check.

### The Export Flow

An operator with the appropriate permission (admin in v1; a specific "configuration export" permission post-v1) triggers the export from the post-setup UI. The wizard asks for a passphrase, confirms it (second field to catch typos), and generates the snapshot in memory: the backend decrypts every encrypted field on the source instance using the source's `COMRADARR_SECRET_KEY`, assembles the plaintext JSON document, derives the encryption key from the passphrase, encrypts the document, and returns the resulting file with a filename that includes the install's friendly name (if set) and an ISO timestamp.

The export is audit-logged. The context payload captures which permission was used, what the snapshot included at a high level (connector count, user count, OIDC provider count, and so on — not the actual contents), and the download size. The passphrase is never logged; the audit trail records that an export happened, not what protected it. A subsequent forensic review can see that the export happened, who did it, and when.

The plaintext document exists in memory only for the duration of the encryption step and is cleared immediately afterward. It is never written to disk, never included in logs, and never passed through any path that could leak it.

### The Import Flow

Import is a dedicated wizard in the post-setup UI, gated behind an explicit confirmation that import is a destructive operation against the current install. The operator uploads the snapshot file and enters the passphrase; the backend derives the key using the parameters embedded in the snapshot header, decrypts the file, validates the inner JSON's schema version against the supported range, parses its contents, and presents a summary page showing what the snapshot contains and what would change about the current install if the import proceeds.

The operator confirms and the backend applies the snapshot in a single database transaction, re-encrypting each imported secret field under the target instance's `COMRADARR_SECRET_KEY` as it lands. Conflicting rows in the current install (e.g., a connector with the same URL as one in the snapshot) are handled by a configurable policy: replace (the snapshot's version wins), merge (snapshot fields that are set replace current fields; unset fields preserve current state), or skip (current install's rows are preserved and snapshot entries with conflicts are discarded). The default is replace, matching the expected case of "I am restoring from a backup."

After the database transaction commits, the import is complete. Unlike the lost-`COMRADARR_SECRET_KEY` recovery path (Section 27), no re-entry of secrets is required — every secret the snapshot captured has been decrypted with the passphrase and re-encrypted under the target key during the import transaction. The operator can resume normal operation immediately.

The import is audit-logged with the same shape as export. If decryption fails (wrong passphrase, corrupted file, version mismatch), the failure is audit-logged with the specific error and the import does not proceed.

### Schema Versioning

The snapshot's inner JSON schema carries a version integer that advances when the snapshot's structure changes. Comradarr supports importing snapshots one major version behind the current release — so a v2.x install can import a v1.x snapshot — with a migration layer that translates old fields into new ones. Snapshots older than one major version are rejected with a specific error suggesting the operator upgrade incrementally by importing into an intermediate version first.

The encryption format's own version (the outer header) is separate from the inner JSON's schema version. The encryption format is expected to change less frequently than the configuration schema; a format version bump would accompany a cryptographic primitive change (for example, if AES-256-GCM were ever replaced) and is handled by keeping decryption code for the old format indefinitely, since snapshot files in the wild cannot be retroactively re-encrypted.

This policy gives operators a clean upgrade path (export from old, upgrade, import into new) and bounds the migration-compatibility surface the codebase has to maintain.

### Partial Import

Post-v1, the import wizard offers a partial-import mode where the operator selects which sections of the snapshot to apply. An operator restoring from a backup wants everything; an operator migrating just their connector configuration to a different instance wants only the connector section. The partial mode applies the same "apply in a single transaction" guarantee to whatever subset was selected, and the audit log records which sections were imported.

Partial import is a v1.x feature candidate rather than a v1 feature; v1 ships with full-snapshot import only.

---

## Appendix A: Full Backend Directory Structure

```
backend/                             uv init comradarr --build-backend uv_build
├── pyproject.toml
├── README.md
├── alembic.ini
├── migrations/
│   └── versions/
└── src/comradarr/                   Python package (src layout)
    ├── __init__.py
    ├── app.py
    ├── config.py
    │
    ├── core/
    │   ├── db.py
    │   ├── lifespan.py
    │   ├── providers.py
    │   ├── events.py
    │   ├── crypto.py
    │   ├── logging.py
    │   ├── exceptions.py
    │   ├── types.py
    │   ├── cursor.py
    │   └── auth/
    │       ├── session.py
    │       ├── guard.py
    │       ├── password.py
    │       └── api_key.py
    │
    ├── models/
    │   ├── base.py
    │   ├── auth.py
    │   ├── connector.py
    │   ├── mirror.py
    │   ├── schedule.py
    │   ├── commands.py
    │   └── sync.py
    │
    ├── connectors/
    │   ├── http.py
    │   ├── factory.py
    │   ├── errors.py
    │   ├── shared/
    │   │   ├── commands.py
    │   │   └── models.py
    │   ├── sonarr/
    │   │   ├── client.py
    │   │   └── models.py
    │   ├── radarr/
    │   │   ├── client.py
    │   │   └── models.py
    │   └── prowlarr/
    │       ├── client.py
    │       ├── models.py
    │       ├── mapper.py
    │       └── health.py
    │
    ├── services/
    │   ├── sync/
    │   │   ├── engine.py
    │   │   ├── coordinator.py
    │   │   ├── differ.py
    │   │   ├── applier.py
    │   │   ├── models.py
    │   │   └── mappers/
    │   │       ├── sonarr.py
    │   │       └── radarr.py
    │   ├── rotation/
    │   │   ├── engine.py
    │   │   ├── dispatcher.py
    │   │   ├── tracker.py
    │   │   └── planners/
    │   │       ├── protocol.py
    │   │       ├── sonarr.py
    │   │       └── radarr.py
    │   ├── budget/
    │   │   ├── protocol.py
    │   │   ├── default.py
    │   │   ├── prowlarr.py
    │   │   └── resolver.py
    │   └── prowlarr/
    │       └── health.py
    │
    ├── repositories/
    │   ├── base.py
    │   ├── connector.py
    │   ├── content.py
    │   └── auth.py
    │
    └── api/
        ├── controllers/
        │   ├── __init__.py
        │   ├── auth.py
        │   ├── connectors.py
        │   ├── events.py
        │   ├── health.py
        │   ├── sync.py
        │   ├── search.py
        │   └── views/
        │       ├── dashboard.py
        │       ├── content.py
        │       ├── rotation.py
        │       └── settings.py
        ├── schemas/
        │   ├── auth.py
        │   ├── connectors.py
        │   ├── content.py
        │   ├── views.py
        │   └── common.py
        └── middleware/
            └── auth.py
```

---

## Appendix B: Database Schema Overview

All tables described below are accessed through the role model defined in Section 8: the migration role holds DDL privileges and runs at startup via Alembic, the application role holds DML privileges on every table except the audit log (where it has only insert and select), and the audit-admin role holds delete on the audit log and is used exclusively by the retention vacuum task. The application process uses a single long-lived connection pool with the application role; the other roles' connections are transient.

### Auth Tables

**users** — User accounts. Stores email, username, Argon2id password hash (with embedded parameters so rehash-on-login can detect outdated hashes), role assignment, and timestamps. Users provisioned by the trusted-header or OIDC providers store an explicit non-hashable sentinel in the password hash column rather than a real hash, which makes local password authentication structurally impossible against these rows even if local login is enabled. The provisioning provider (`local`, `trusted_header`, `oidc`) is recorded on creation for audit purposes.

**sessions** — Active login sessions. Stores the SHA-256 hash of the session token (never the plaintext, so database reads cannot be replayed as cookies), user_id, `auth_provider` (`local`, `trusted_header`, or `oidc` — which mechanism authenticated this session), optional `oidc_provider_name` (which configured OIDC provider, when applicable), created_at, expires_at (absolute timeout), last_seen_at (driving idle timeout), IP, and user-agent. Indexed on the token hash for constant-time lookup during session validation. Revocation deletes the row rather than marking it expired, so there is no window in which a replayed cookie could match.

**api_keys** — Comradarr's own API keys for programmatic access. Stores the SHA-256 hash of the random portion, the human-readable prefix (e.g., `cmrr_live_`), the visible last-four characters for UI display, user_id, human-readable name, optional expiry, created_at, and last_used_at (best-effort, fire-and-forget updates). The full plaintext key is returned to the user exactly once at creation and is never retrievable thereafter.

**auth_rate_limits** — Persistent rate limit state keyed by `(scope, key)` where scope is `login_ip`, `login_username`, `password_change_user`, `api_key_ip`, or `bootstrap_ip`, and key is the IP address or username. Stores the current counter, window start timestamp, and for per-username entries the current backoff delay and most recent failure timestamp. Persistent across restarts so cycling the container does not reset limits for a persistent attacker. An in-memory cache sits in front of this table for hot-path lookups.

**oidc_providers** — Per-provider OIDC configuration when the OIDC provider is enabled. Stores the provider short name (used in URLs and displayed in the UI), issuer URL, client ID, client secret as four encrypted columns (`client_secret_nonce`, `client_secret_ciphertext`, `client_secret_tag`, `client_secret_version`) with the provider name as AAD, display name, scope list, and cached discovery document fields (authorization endpoint, token endpoint, JWKS URI, end_session_endpoint, last refresh timestamp). The JWKS itself is kept in memory only and re-fetched on startup and on validation failure.

### Connector Tables

**connectors** — Connection configuration for each Sonarr, Radarr, or Prowlarr instance. Stores name, type, URL, and per-connector settings (daily command limit, concurrent limit). The API key is stored as four columns (`api_key_nonce`, `api_key_ciphertext`, `api_key_tag`, `api_key_version`) following the AES-256-GCM layout described in Section 15; the connector's primary key UUID is used as AAD, binding each ciphertext to the row it belongs in. Per-connector network safety settings include `insecure_skip_tls_verify` (boolean, default false — when true, certificate verification is bypassed for this connector and the UI displays a warning badge) and `tls_ca_bundle_path` (nullable string — when set, points at a custom CA bundle file used for TLS verification of this connector instead of the system defaults). The `type` field discriminates between connector types.

### Mirror Tables

**mirror_series** — Sonarr series metadata. Keyed by `(connector_id, arr_id)`. Stores title, tvdb_id, status (continuing/ended/upcoming/deleted), monitored flag, quality profile ID, path, and aggregate statistics (season count, episode count, file count, size on disk).

**mirror_episodes** — Sonarr episode metadata. Keyed by `(connector_id, arr_id)`. Stores series_arr_id, season_number, episode_number, title, has_file, monitored, air_date_utc, episode_file_id, size_on_disk, quality_id. Indexed on `(connector_id, series_arr_id, season_number)` for season-level queries.

**mirror_movies** — Radarr movie metadata. Keyed by `(connector_id, arr_id)`. Stores title, tmdb_id, status (tba/announced/inCinemas/released/deleted), monitored flag, has_file, quality_profile_id, path, size_on_disk, year.

### Operational Tables

**search_schedule** — One row per searchable item. Primary key on `(connector_id, content_type, content_arr_id)`. Stores series_arr_id and season_number (denormalized for planner query performance), tier (0–3), last_searched_at (nullable), search_count, and paused flag. Critical index on `(connector_id, tier, last_searched_at NULLS FIRST) WHERE NOT paused`.

**planned_commands** — Dispatched search commands. Stores connector_id, command_type (episode/season/series/movie), command_payload (JSONB), status (pending/dispatched/completed/failed/timeout), arr_command_id, dispatch and resolution timestamps. Partial index on `(connector_id, status, created_at) WHERE status = 'pending'`.

**priority_searches** — User-initiated search requests that bypass rotation. Unique constraint on `(connector_id, content_type, content_arr_id)` to prevent duplicates. Consumed and deleted by the dispatch loop.

### Sync State Tables

**sync_state** — One row per connector. Stores last full sync, last incremental sync, and last deep sync timestamps, the stored fingerprint (JSONB), sync status (idle/running/failed), last error message, and performance metrics (items synced, duration).

### Configuration Tables

**app_config** — A simple key-value store for application-wide configuration that does not belong in environment variables. Each row has a string key, a value, and updated_at timestamps. Used for setup-state flags (notably `setup_completed`), the setup-claim timestamp, the encryption key version that is currently current for new encryptions, the HTTP-boundary configuration collected through the setup wizard (`public_origin`, `allowed_origins`, `allowed_hosts`, `trusted_proxy_ips`), the trusted-header authentication settings when that provider is enabled (`trusted_header_auth_proxy_ips`, `trusted_header_auth_username_header`, `trusted_header_auth_email_header`, `trusted_header_auth_logout_url`, `trusted_header_auth_provision_policy`), observability configuration (Prometheus scrape allowlist, OTLP endpoint, both disabled in the default state), and any other runtime-mutable settings that need to survive process restarts but cannot be set at deploy time. Secret values that need to live here (notably the setup-claim proof) are stored as four-column encrypted fields (nonce, ciphertext, tag, key_version) in a dedicated companion table using the same AES-256-GCM layout as connector API keys, rather than inline in the app_config value column. A fixed constant identifying the claim context is used as AAD for the setup-claim proof.

**role_permissions** — Maps role names (`admin` in v1) to the set of permissions that role holds. Each row has a role name, a permission name, and a granted_at timestamp. In v1 the table contains only admin's entries, which cover every defined permission; the permission-check middleware reads from this table on each authenticated request. Post-v1 additions (operator, viewer, custom roles) are inserts into this table, not schema changes.

**api_key_scopes** — Maps API key IDs to permission subsets, constraining what an API key can do relative to the owning user's permissions. Populated in v1 for every key created with a narrower-than-owner scope; keys with no scope rows here inherit the full permission set of the creating user's role. The permission-check middleware joins against this table on every API-key-authenticated request. A scope cannot grant permissions the owning user's current role does not hold, so a role demotion automatically shrinks every key the user created.

**user_preferences** — Per-user settings that are not authentication- or permission-related. Each row has a user_id, a preference key (locale, theme, timezone, notification toggles), and a value. Locale is the load-bearing one in v1 — the authenticated user's preferred language for the frontend UI and for backend error messages. Theme stores the three-value `light` / `dark` / `system` preference that drives SSR theme handling described in Section 25. Other preferences are placeholders that accumulate as features need them.

### Notification Tables

**notification_channels** — Configured external destinations for notification delivery. Stores channel UUID, owning user_id, human-readable name, kind (`apprise` or `webhook`; SMTP email is represented as an apprise channel with a `mailtos://` URL), enabled flag, created_at / updated_at, last_tested_at, last_test_status (an enumerated value — `ok`, `failed`, `never`), and per-channel network safety settings mirroring the connector pattern (`insecure_skip_tls_verify` boolean defaulting to false, `tls_ca_bundle_path` nullable string). The secret portion of the configuration (the apprise URL for apprise channels, or the URL / method / headers / body-template bundle for webhook channels) is stored as four encrypted columns (`config_nonce`, `config_ciphertext`, `config_tag`, `config_version`) using the AES-256-GCM layout described in Section 15, with the channel's UUID as AAD. Indexed on `(user_id)` for the per-user channel list and on `(enabled, kind)` for dispatcher queries that enumerate active channels during event resolution.

**notification_routes** — Routing rules that bind `(user_id, event_type, channel_id)` triples to an enabled flag. A single event fires one notification per matching enabled row; the absence of a matching row is the off-switch. Each row stores user_id, event_type (a typed enumeration covering the security, operational-health, and user-initiated categories defined in Section 14), channel_id (foreign key to notification_channels with `ON DELETE CASCADE`), enabled flag, a nullable `predicate` column reserved for post-v1 filtering (populated with null on every v1 row), and created_at / updated_at. Composite index on `(user_id, event_type)` for the dispatcher's per-event resolution pass.

**notification_templates** — Per-user overrides for the message rendered for a given `(event_type, channel_kind)` pair. Each row stores user_id, event_type, channel_kind (`apprise` or `webhook`), subject_template (nullable — relevant for apprise destinations that support a title/subject and for webhook body headers), body_template, and created_at / updated_at. A row exists only when the user has explicitly overridden the default; its absence means "use the gettext-translated built-in default for the recipient's locale, falling back to English." Composite unique index on `(user_id, event_type, channel_kind)` for the lookup at send time.

### Audit Tables

**audit_log** — Append-only record of every security-sensitive state change in the application. Each row stores a timestamp, an action code (a typed enumeration covering bootstrap token generation, setup-claim grants and rejections, admin account creation, setup completion, login success and failure across all three authentication providers, password change, session revocation, API key create/revoke/first-use, connector add/edit/delete, HTTP boundary configuration changes, OIDC provider changes, and manual operational actions), the actor (user_id if authenticated, otherwise the resolved source IP from the reverse-proxy chain), a structured context payload (JSONB) describing the action's parameters with all secret fields redacted via the `Secret` wrapper type, and the request IP and user-agent. Two reserved columns — `previous_hash` and `content_hash`, both nullable and null-populated in v1 — hold hash-chain values when tamper-evidence against direct-database compromise is implemented in a future iteration; the columns exist now so retrofitting does not require a schema migration that touches every historical row. Indexed on `(timestamp DESC)` for chronological browsing and on `(action, timestamp DESC)` for filtered queries. The application role (Section 8) holds insert and select privileges but no update or delete on this table; the audit-admin role holds delete and is used only by the retention vacuum task. Retention defaults to indefinite; a configurable cap in days or entry count is available for operators who want one.

---

## Appendix C: Glossary

**Connector** — A configured connection to a Sonarr, Radarr, or Prowlarr instance. Includes URL, API key, and operational settings.

**Mirror** — The local PostgreSQL copy of content data from connected *arr applications. Refreshed by the sync engine.

**Rotation** — The continuous process of cycling through all library items, searching for each one in turn. Items that were searched longest ago are searched next.

**Tier** — A priority classification (0–3) that controls how fast an item rotates through search. Lower tiers rotate faster. Tier 0 is MISSING (no file), tier 3 is COMPLETED (has file, series ended or movie is old).

**Planner** — The component that groups individual items into optimally batched search commands. The planner's job is to maximize items covered per indexer query.

**Budget** — The number of search commands that can be safely sent in a given time window. Controlled by the budget system, which reads indexer limits from Prowlarr or uses conservative defaults.

**Fingerprint** — A compact representation of a library's state, used by the sync engine to detect changes without fetching episode-level data. Compared between syncs to identify which series/movies need detailed re-fetching.

**BFF (Backend-for-Frontend)** — API endpoints designed around what each frontend page needs rather than around generic resources. Each BFF endpoint returns a composed response matching the page's data requirements.

**Keyset Pagination** — A pagination technique that uses the last row's sort column value and ID as a cursor for the next page. Unlike offset pagination, keyset pagination is O(1) regardless of page depth.

**SSE (Server-Sent Events)** — A unidirectional server-to-client streaming protocol used for real-time UI updates. Simpler than WebSockets for Comradarr's notification-style communication pattern.

**Apprise** — A Python notification library (BSD-2-Clause licensed, AGPL-3.0 compatible) that abstracts dozens of notification destinations behind uniform URL strings: Discord (`discord://`), Slack (`slack://`), email via SMTP (`mailto://` and `mailtos://`), Gotify (`gotifys://`), ntfy (`ntfys://`), Telegram (`tgram://`), Matrix (`matrixs://`), and many others. Comradarr's notification system uses apprise as its primary long-tail channel backend, covering the full destination surface with one dependency. SMTP email is delivered through apprise's mail plugin rather than via a separate channel kind, with a guided UI assembling the `mailtos://` URL from host, port, credentials, and TLS-mode fields; implicit TLS on port 465 and STARTTLS on port 587 are both supported.

**Notification Channel** — A configured external destination for notification delivery. Channels have a kind (`apprise` or `webhook`), an encrypted configuration payload stored using the four-column AES-256-GCM layout reused from connector API keys, per-channel network safety settings mirroring the connector pattern (`insecure_skip_tls_verify`, `tls_ca_bundle_path`), and a test-before-commit lifecycle that prevents channels from being persisted in a broken state.

**Notification Route** — A routing rule that binds an `(event type, user, channel)` triple with an enabled flag. Multiple routes for the same `(user, event type)` pair fan out the same notification to multiple channels. The absence of a matching route is the off-switch for that event-and-user combination; there is no separate mute state to manage. Routes are per-user in v1, forward-compatible with the operator and viewer roles introduced post-v1.

**Notification Template** — A message rendered for a specific `(event type, channel kind)` combination. Templates use a constrained substitution language — `{{variable}}` interpolation plus an `{{#if variable}}…{{/if}}` conditional — that is linguistically flat for Weblate translators and has no server-side template injection surface for a compromised admin account. Built-in defaults ship as gettext message keys subject to Weblate translation; user overrides are stored verbatim and not translated. Lookup order at send time is user override → translated built-in for the recipient's locale → English built-in.

**Coalescing Window** — A 60-second rolling window during which operational-health notifications of the same category accumulate into a single grouped message rather than firing individually. Designed for the common failure mode where a cascade of related events (twenty indexers flipping in the same Prowlarr poll, multiple sync failures during a network blip) would otherwise train the operator to ignore the notification stream. Security events and user-initiated events do not coalesce; each one fires distinctly.

**Bootstrap Token** — A short-lived, in-memory, one-time-use token printed to logs at first startup. Proves that the holder has access to the running process's logs, and authorizes claiming the setup wizard. Not a credential in the traditional sense — it is an attestation of log access. The bootstrap claim is the single POST in the entire application that is exempt from CSRF Origin checking (because the allowed-origins list does not yet exist to check against); the token itself, combined with the strict-same-site claim cookie and per-IP rate limiting, is what authorizes the claim. From the wizard's HTTP boundary verification phase onward, CSRF is active for every request.

**Setup-Claim Cookie** — A path-scoped HttpOnly cookie issued after a valid bootstrap token is presented. Proves that a specific browser owns the in-progress setup wizard, preventing concurrent setup attempts from different browsers.

**Audit Log** — Append-only record of every security-sensitive action in Comradarr, beginning with the very first state change during bootstrap. Provides a complete forensic trail of how an install was set up, by whom, and what subsequent changes were made.

**`Secret[T]`** — A generic wrapper type used throughout the codebase for any secret value (API keys, session tokens, bootstrap tokens, master key material). Overrides string representation, repr, and msgspec serialization to emit a redaction marker; the only way to access the underlying plaintext is to call an explicit `expose()` method, which is deliberately chosen for grep-distinctiveness during code review. Combined with basedpyright in recommended mode, this makes accidental secret leakage into logs, tracebacks, error responses, or event payloads a type-check failure rather than a runtime defect.

**AAD (Additional Authenticated Data)** — Input to AES-GCM that is not encrypted but is cryptographically bound to the ciphertext via the authentication tag. Decryption fails if the AAD presented does not match the AAD used at encryption. Comradarr uses AAD to bind each encrypted field to its containing row (e.g., a connector's API key ciphertext is bound to the connector UUID), defending against an attacker with database write access swapping ciphertext between rows.

**Key Versioning** — Every encrypted field stores a version number alongside its nonce, ciphertext, and authentication tag. Encryption always uses the current version; decryption looks up the historical key by version in the key registry. This transforms key rotation from a one-shot atomic migration into a routine, resumable background operation: introduce a new version, mark it current, re-encrypt rows one at a time on a background worker.

**AuthProvider** — A structural abstraction defining how an incoming request is mapped to an authenticated user. Comradarr ships three implementations: `LocalPasswordProvider` (username and Argon2id-hashed password), `TrustedHeaderProvider` (identity header from a trusted reverse proxy), and `OIDCProvider` (direct OpenID Connect integration). Providers can coexist and are checked in a fixed registration order; the session row records which provider authenticated each session.

**Trusted-Header Auth** — An authentication pattern where a reverse proxy (authelia, authentik, tinyauth, traefik ForwardAuth) handles authentication upstream and forwards the authenticated request to Comradarr with an identity header. Comradarr trusts the header only when the TCP socket peer is in a configured allowlist; headers like `X-Forwarded-For` are never consulted for this check because they are attacker-controllable when the peer is not already trusted.

**OIDC (OpenID Connect)** — An identity layer over OAuth 2.0 used for federated authentication. Comradarr acts as a relying party against one or more configured OIDC providers (authentik, authelia, Keycloak, and others), using the authorization code flow with mandatory PKCE. ID tokens are validated against JWKS fetched from the provider's discovery document, with issuer, audience, expiry, and nonce checks on every authentication.

**PKCE (Proof Key for Code Exchange)** — An OAuth 2.0 extension that binds an authorization code to the specific client instance that initiated the flow, defending against authorization code interception attacks. Mandatory on every OIDC authentication in Comradarr regardless of client classification.

**Absolute vs. Idle Timeout** — Two timeouts that govern session lifetime. The absolute timeout is the maximum lifetime from creation (default 30 days); the idle timeout is the maximum inactivity window between requests (default 7 days). A session expires when either is hit, whichever comes first.

**SSRF (Server-Side Request Forgery)** — A class of attack where an attacker tricks an application into sending HTTP requests to destinations the attacker chooses, typically internal services or cloud metadata endpoints, with the application's credentials attached. Comradarr defends against SSRF in connector URL handling through scheme restrictions, IP classification, and re-resolution on every request.

**DNS Rebinding** — An attack where a hostname resolves to a benign IP at validation time and a malicious IP at request time, bypassing one-shot URL validation. Comradarr defends against this by re-resolving and re-classifying connector hostnames on every outbound request rather than trusting the result of the initial validation.

**URL Classification Policy** — The set of rules that decides whether a resolved IP address is acceptable as a connector destination. Comradarr ships three policies: `default` (homelab-friendly — loopback, RFC1918, IPv6 ULA, and CGN ranges allowed; link-local and metadata blocked), `strict` (only global unicast public addresses allowed), and `permissive` (almost everything allowed, with a startup warning). Configurable via `COMRADARR_CONNECTOR_URL_POLICY`.

**HTTP Boundary Verification (Wizard Phase 2)** — The mandatory setup wizard phase that walks the operator through a sequence of test-driven configuration steps covering the HTTP boundary: proxy trust, public origin, allowed origins and hosts, and a rollup confirmation. Each step proposes values derived from the wizard's observations of the operator's actual request, explains the value in plain language, accepts operator confirmation or correction, and runs a live end-to-end test against the operator's own browser before advancing. The phase exists so that networking configuration does not require the operator to know the right answer in advance — the wizard shows what it sees, explains what it means, and verifies that each proposed setting actually works.

**Test-Driven Configuration** — The pattern applied to every HTTP-boundary setting Comradarr collects, both in the setup wizard and in the post-setup UI. Rather than accepting a value on faith and discovering misconfiguration later when users hit 403 errors, every setting commit triggers a live test that exercises the setting end-to-end through the operator's own browser. Success persists the value; failure returns a specific error and leaves the previous value active. The pattern means operators cannot lock themselves out with a bad paste.

**Bundled PostgreSQL** — The PostgreSQL server packaged inside the Comradarr Docker image and run as a supervised sibling process alongside the application. It is the default database for the 98% homelab case, listening only on a Unix socket inside the container, persisting its data directory through a single operator-mounted volume. Operators who set `DATABASE_URL` to point at an external PostgreSQL instance override this default; the bundled server does not start when the override is present. The split exists so that simple deployments require zero database configuration while operators with existing Postgres infrastructure can plug Comradarr into it without fighting the image.

**Two-Tier Configuration Model** — The split between environment variables (hard pre-launch configuration that must exist before the application can start) and runtime configuration held in the database (collected through the wizard or post-setup UI). Environment variables are kept deliberately minimal — master encryption key, optional database override, development and break-glass toggles — because they leak through process inspection, demand the operator know the right answer in advance, and are hard to edit safely on a running system. Everything else lives in the database, where it can be tested before commit, audit-logged on change, and edited through the UI with immediate effect.

**Database Role Separation** — The three-role PostgreSQL access model described in Section 8. The migration role holds DDL privileges and runs only at startup via Alembic. The application role holds DML privileges on every table except the audit log, where it has only insert and select; this is the role the long-running application process uses for every request. The audit-admin role holds delete on the audit log table and is used exclusively by the retention vacuum task. The role separation is enforced at the Postgres GRANT level rather than by application checks, so a SQL injection or logic bug in the request path cannot modify or delete audit entries — the application's connection simply does not have those privileges on that specific table.

**Audit Log** — Append-only record of every security-sensitive state change in Comradarr, beginning with the first row written during bootstrap and continuing for the life of the install. Scope covers authentication and session events, API key lifecycle, configuration changes, and user-initiated operational actions. Routine operational telemetry (sync ticks, rotation ticks, health probes) is deliberately excluded and lives in the structured log stream instead. Integrity is enforced primarily by database-level role separation; the schema reserves `previous_hash` and `content_hash` columns for future hash-chain tamper-evidence without committing to the implementation in v1.

**Hash-Chain Reservation** — Two nullable columns (`previous_hash` and `content_hash`) on the audit log table that are populated with null in v1 but reserved for a future integrity upgrade in which each entry's hash depends on the previous entry's hash, making historical tampering structurally detectable. The columns are included at v1 so that retrofitting does not require altering a potentially-large audit table during application operation.

**prek** — A Rust-native reimplementation of the pre-commit framework, used as Comradarr's pre-commit hook runner. Configuration lives in `prek.toml` (documented at <https://prek.j178.dev/configuration/>); prek also accepts the upstream `.pre-commit-config.yaml` format, but Comradarr standardises on TOML. prek is used by CPython, FastAPI, Airflow, and other large Python projects for its speed and its zero-Python-runtime startup.

**Lockfile-Enforced Install** — The CI and production install pattern in which `uv sync --frozen` (or the equivalent `--locked` flag) refuses to install any dependency whose content hash does not match the committed `uv.lock`. This defeats compromised-mirror substitution attacks at install time rather than detecting them after the fact. The same pattern applies to the frontend lockfile when it lands.

**Ruff S Category** — The security-focused ruff lint rule category, derived from Bandit. Enabled in full in Comradarr's configuration with errors (not warnings), covering dangerous primitives including `pickle`, `eval`/`exec`, `subprocess` with `shell=True`, string-formatted SQL construction, weak hash primitives used for security, hardcoded secrets, and binding to non-loopback interfaces when loopback was intended. Specific rule suppressions require a justified `# noqa` comment that a reviewer validates.

**basedpyright Recommended Mode** — The type-checking strictness level Comradarr runs in CI and in the pre-commit hook. Stricter than pyright's default "basic" mode; catches implicit Any, untyped function definitions, unsafe casts, and a broader set of type-level issues. The `Secret[T]` wrapper type's leak-prevention guarantees depend on this strictness level.

**Biome** — The Rust-native linter and formatter that supersedes Prettier and ESLint for Comradarr's frontend. Biome v2.4+ formats and lints JavaScript, TypeScript, JSON, CSS, and the `<script>` / `<style>` blocks of Svelte files; Svelte template markup is covered by `svelte-check` rather than Biome. Configuration lives in `biome.json`. Biome runs in write mode locally through the pre-commit hook and in check mode in CI.

**Permission-Check Middleware** — The authorization layer that runs on every authenticated endpoint and resolves the current user's role, looks up the role's permission set, and either allows the request or returns 403. In v1 the only role is admin (with every permission), so the check is trivially true for the single account; the middleware runs anyway so post-v1 role additions are a feature change rather than a codebase-wide audit.

**Configuration Snapshot** — The portable, passphrase-encrypted archive of a Comradarr install's non-derivable state: connectors with API keys, HTTP boundary configuration, authentication provider settings, user accounts without password hashes, and user preferences. Encrypted with AES-256-GCM using a key derived from an operator-supplied passphrase via Argon2id. Importable into a fresh install by providing the same passphrase to recover from data loss or migrate to new hardware. Excludes the mirror tables (reconstructible from *arr syncs), the schedule (rotation re-establishes from fresh state), and the audit log (entries are tied to the specific install that produced them).

**Weblate** — The self-hosted translation management platform Comradarr integrates with for internationalization. Translators work through Weblate's web UI; their submissions land as pull requests on the Comradarr repository. Catalogs are gettext `.po` files for backend strings and JSON for frontend strings, both stored in a dedicated directory the Weblate instance polls. Weblate's native placeholder validation understands the `{{variable}}` syntax used by notification templates and warns translators who drop or malform a placeholder, which is what lets translated notification strings remain deliverable in every locale.

**Northern Lights Theme** — The tweakcn shadcn theme that is Comradarr's committed token source for the frontend, installed via `bunx shadcn@latest add https://tweakcn.com/r/themes/northern-lights.json`. The palette is aurora-green primary against deep arctic-blue background with a violet-blue accent; typography pairs Plus Jakarta Sans (display and body) with JetBrains Mono (numerals) and Source Serif 4 (reserved, currently unused). All color, spacing, shadow, radius, and typography values in the frontend derive from this token set; component code consumes tokens and nothing else, so a future theme swap touches one file rather than the entire codebase.

**"Watching the Sky" Aesthetic** — Comradarr's committed visual direction, anchoring the Northern Lights palette to the product metaphor of patient, atmospheric observation rather than aggressive scanning. Three concrete commitments carry the direction: atmosphere via subtle aurora gradient washes in hero areas (never behind data surfaces); primary-accent color discipline (aurora-green for operational state, violet-blue for informational state, chart tokens reserved for charts); and mono numerals on every count and timing value so SSE-driven updates swap atomically without proportional-figure jitter.

**Tint-on-Change** — The single motion pattern used to announce SSE-driven value updates in the UI. When an event causes a visible counter or status to change, the containing card receives a 200ms background-tint pulse (primary color at 8% alpha, ease-out) while the numeral itself swaps atomically in the same frame. Count-up animations are deliberately avoided because they spend attention budget on values that were never uncertain. Universally collapses to an instantaneous swap with no tint under `prefers-reduced-motion: reduce`.

**Rotation Heartbeat** — The single persistent motion affordance in the UI, a small indicator sited near the product wordmark in the sidebar that pulses slowly (roughly once every two seconds, low opacity, ease-in-out) while the rotation engine is actively dispatching commands. Static when the rotation engine is idle (paused, pre-setup, no connectors). Operators learn to read its absence as "the engine has stopped" at a glance. Collapses to a static state under `prefers-reduced-motion: reduce`.

**FLOSS Telemetry Posture** — Comradarr's observability commitment: no phone-home, no third-party analytics, no crash reporting to a vendor service. Operators who want metrics and traces get them through self-hosted Prometheus and OpenTelemetry endpoints that scrape or push to infrastructure the operator fully controls. The default state is "no telemetry surface active at all"; operators opt in to `/metrics` and OTLP export through the post-setup UI.

**RFC 7807 Problem Details** — The IETF standard for structured HTTP error responses, used as Comradarr's universal error response format. Every error response carries five standard fields (type URI, title, status, detail, instance) plus domain-specific extensions (a per-field errors array for validation failures, a context object for domain-specific structured data). The type URI is the stable error identifier that pairs with i18n message keys and survives wording changes.

**Fixture-Based Testing** — Comradarr's approach to testing connector code against realistic upstream behavior without requiring live *arr instances. A recording tool captures real request/response pairs from Sonarr, Radarr, or Prowlarr instances; the captures are committed as fixture files with authentication material redacted; tests replay the fixtures deterministically. A nightly canary job detects when upstream API changes cause fixtures to drift and prompts a refresh.

**Semantic Versioning (semver)** — The versioning scheme Comradarr follows for both backend and frontend. Three integers separated by dots with the standard meanings: major increments for backwards-incompatible changes, minor for backwards-compatible additions, patch for bug fixes. Git tags use the literal semver string without prefix; human-facing release titles use a `v` prefix for readability. Docker image tags include the full semver, the minor-major prefix, the major prefix, and `latest` for different reproducibility postures.

**AGPL-3.0** — The GNU Affero General Public License version 3.0, Comradarr's license. Contributions are accepted only under AGPL-3.0 (inbound-equals-outbound). The AGPL ensures that modified versions of Comradarr run as a service must make their modifications available to the service's users, which is the appropriate protection for a self-hosted tool. Third-party dependencies are vetted for AGPL-3.0 compatibility at addition time.
