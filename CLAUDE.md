# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product Overview

Comradarr is a media library completion service that integrates with *arr applications (Sonarr, Radarr, Whisparr) to systematically identify and request missing or upgradeable content.

### Problem Solved

*arr applications only monitor RSS feeds for new releases—they don't actively search for older missing content. Comradarr fills this gap by running scheduled sweeps to find content gaps and upgrade candidates.

### Key Differentiator

Unlike similar tools that pollute *arr apps with tags to track state, Comradarr maintains all state in its own PostgreSQL database. This provides:
- Accurate episode-level tracking
- Clean separation of concerns
- Proper scalability for large libraries
- Content mirror can be rebuilt from *arr APIs without losing operational history

### Core Concepts

- **Connectors**: Configured connections to *arr application instances (URL, encrypted API key, type, settings)
- **Sweep Cycles**: Scheduled operations scanning for content gaps or upgrade opportunities (cron-based with timezone awareness)
- **Content Gaps**: Missing items where `monitored=true` AND `hasFile=false`
- **Upgrade Candidates**: Items where `monitored=true` AND `qualityCutoffNotMet=true`
- **Throttle Profiles**: Rate-limiting (requests/minute, batch size, cooldowns, daily budget)
- **Request Queue**: Prioritized list with priority based on content age, missing duration, failure penalty, search type
- **Content Mirror**: Local database copy of *arr library state for efficient gap detection
- **Search State**: Tracks Comradarr's actions separately from content state (pending → queued → searching → cooldown/exhausted)

---

## Tech Stack

### Runtime
- **Bun** - JavaScript runtime and package manager

### Frontend
- **Svelte 5** with Runes (`$state`, `$derived`, `$effect`, `$props`)
- **SvelteKit 2.x** with `svelte-adapter-bun`
- **shadcn-svelte** for UI components via `unocss-preset-shadcn`
- **UnoCSS** with `presetWind`, `presetAnimations`, `presetShadcn`
- **Lucide Svelte** for icons (direct imports for tree-shaking)

### Backend
- **TypeScript** (strict mode: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`)
- **PostgreSQL** via Bun's native SQL driver (`bun:sql`)
- **Drizzle ORM** for type-safe queries and migrations (timestamp prefix migrations)
- **Croner** for cron scheduling with `protect: true` for overrun protection
- **Valibot** for validation (smaller than Zod for client-side)
- **Argon2id** for password hashing (`@node-rs/argon2`)
- **AES-256-GCM** for API key encryption at rest

### Deployment
- Docker multi-stage builds with `svelte-adapter-bun`
- Supports external or embedded PostgreSQL
- Health checks with `pg_isready` for database dependency ordering
- Docker secrets for database passwords

---

## Commands

```bash
# Development
bun install                    # Install dependencies
bun run dev                    # Start dev server
bun run build                  # Production build
bun run preview                # Preview production build

# Database
bunx drizzle-kit generate      # Generate migrations from schema
bunx drizzle-kit migrate       # Apply pending migrations
bunx drizzle-kit push          # Push schema directly (dev only)
bunx drizzle-kit studio        # Open database GUI

# Testing
bun run test                   # Run all tests
bun run test:unit              # Unit tests only
bun run test -- path/to/file   # Single test file

# Type checking
bun run check                  # Run svelte-check (tsc doesn't check .svelte files)
```

---

## Project Structure

```
src/
├── lib/
│   ├── components/           # Reusable UI components
│   │   ├── ui/               # shadcn-svelte primitives (Button, Card, Dialog, Form)
│   │   ├── layout/           # Sidebar.svelte, Header.svelte, PageContainer.svelte
│   │   ├── connectors/       # ConnectorCard, ConnectorForm, ConnectorHealth
│   │   ├── content/          # SeriesCard, MovieCard, EpisodeList, ContentFilters
│   │   ├── queue/            # QueueTable, QueueItem, QueueControls
│   │   └── shared/           # StatusBadge, ProgressRing, RelativeTime
│   ├── server/               # Server-only code (enforced at build time)
│   │   ├── db/
│   │   │   ├── index.ts      # Database client with Bun native SQL driver
│   │   │   ├── schema/       # connectors, series, seasons, episodes, movies,
│   │   │   │                 # search_registry, request_queue, search_history,
│   │   │   │                 # sync_state, users, sessions, throttle_profiles,
│   │   │   │                 # notification_channels, analytics_events
│   │   │   ├── queries/      # Query functions (one file per domain)
│   │   │   └── migrations/   # Auto-generated migrations (timestamp prefix)
│   │   ├── connectors/       # *arr API clients
│   │   │   ├── common/       # BaseArrClient, types, errors, retry logic
│   │   │   ├── sonarr/       # client, types, mapper, commands
│   │   │   ├── radarr/       # client, types, mapper, commands
│   │   │   ├── whisparr/     # client, types, mapper, commands
│   │   │   └── index.ts      # Factory and unified exports
│   │   ├── services/
│   │   │   ├── sync/         # incrementalSync, fullReconciliation
│   │   │   ├── discovery/    # gap-detector, upgrade-detector
│   │   │   ├── queue/        # prioritizer, batcher, dispatcher
│   │   │   ├── notifications/# channels (discord, telegram, slack, email, webhook)
│   │   │   └── analytics/    # collectors (acquisition, indexer, queue)
│   │   ├── crypto.ts         # AES-256-GCM encryption for API keys
│   │   └── scheduler.ts      # Croner job initialization
│   ├── stores/               # Shared state (.svelte.ts files with $state)
│   └── utils/                # Pure utilities (quality serialization)
├── routes/
│   ├── (app)/                # Authenticated routes
│   │   ├── +layout.server.ts # Auth guard
│   │   ├── dashboard/        # Overview, stats, activity feed
│   │   ├── connectors/       # CRUD, health, sync history
│   │   ├── content/          # Browser, series/movie detail
│   │   ├── queue/            # Queue management, completions
│   │   ├── schedules/        # Sweep schedule management
│   │   ├── analytics/        # Charts, exports
│   │   └── settings/         # General, throttle, notifications, security
│   ├── (auth)/               # Login/logout
│   ├── api/                  # REST endpoints, external API with key auth
│   ├── webhooks/             # External webhook handlers
│   └── health/               # Health check endpoint
├── hooks.server.ts           # Auth, security headers, correlation IDs
└── app.d.ts                  # Type declarations for App.Locals
tests/
├── e2e/                      # Playwright E2E tests
└── properties/               # fast-check property tests
```

### Architecture Principles

**Single Responsibility**: Each file/module has one purpose. Connector clients handle HTTP—not data transformation. Discovery finds gaps—not dispatch searches.

**Connector Isolation**: Each *arr app type has isolated code in its own directory. Shared infrastructure lives in `common/`. Adding a new *arr app means creating new files, not modifying existing ones.

**Content Mirror + Search State Separation**: Database separates what exists in *arr apps (content mirror tables) from what actions Comradarr has taken (search state tables). The content mirror can be rebuilt without losing operational history.

**Server-Only Enforcement**: `$lib/server/` imports are enforced at build time—attempting to import server code in client bundles fails during build.

**Route Groups**: `(app)` and `(auth)` organize pages without affecting URL structure. All `(app)` routes protected by auth guard in `+layout.server.ts`.

### Database Schema (Key Tables)

- `connectors`: id, type, name, url, api_key_encrypted, enabled, health_status, last_sync
- `series`: connector_id, arr_id, tvdb_id, title, status, monitored, quality_profile_id
- `seasons`: series_id, season_number, monitored, total_episodes, downloaded_episodes
- `episodes`: season_id, arr_id, season/episode_number, has_file, quality (jsonb), quality_cutoff_not_met
- `movies`: connector_id, arr_id, tmdb_id, imdb_id, title, year, has_file, quality (jsonb)
- `search_registry`: connector_id, content_type, content_id, search_type, state, attempt_count, priority
- `request_queue`: search_registry_id, connector_id, batch_id, priority, scheduled_at

### Search State Machine

`pending` → `queued` → `searching` → `cooldown` (on failure) → `queued` (retry) or `exhausted` (max attempts)

---

## Key Patterns

### Svelte 5 Runes
- Use `$props()` with destructuring, NOT `export let`
- Use `$state()` for mutable values, `$derived()` for computed
- `$effect()` ONLY for side effects (DOM, logging, external sync)
- Use `{#snippet}` and `{@render}` instead of slots
- Use `$bindable()` for explicit two-way binding

### Shared State
Use class-based patterns in `.svelte.ts` files:
```typescript
class AppState {
  user = $state<User | null>(null);
  isAuthenticated = $derived(this.user !== null);
}
export const appState = new AppState();
```

### Database
- Infer types from schema: `typeof users.$inferSelect`, `typeof users.$inferInsert`
- Use prepared statements for frequent queries
- NEVER use string concatenation for SQL—use Drizzle's query builder or `sql` template
- Pool size 10-25 connections with idle timeout and max lifetime

### *arr API Integration
- Use `X-Api-Key` header authentication
- API v3 base path: `/api/v3/`
- Use `AbortSignal.timeout(30000)` for request timeouts
- Handle HTTP 429 with extended cooldown
- Retry with exponential backoff (configurable base delay, max delay, multiplier)
- Paginate with pageSize=1000, continue until `page * pageSize >= totalRecords`
- Batch episode searches: max 10 episodes per EpisodeSearch command
- Batch movie searches: max 10 movies per MoviesSearch command

### Error Handling
Typed error classes: `NetworkError`, `AuthenticationError`, `RateLimitError`, `ServerError`
- NetworkError: connection_refused, dns_failure, timeout (retryable)
- AuthenticationError: HTTP 401 (not retryable)
- RateLimitError: HTTP 429 with optional Retry-After (retryable)
- ServerError: HTTP 5xx (retryable)

### Security
- API keys encrypted at rest with AES-256-GCM using app SECRET_KEY
- Passwords hashed with Argon2id
- Sessions stored in PostgreSQL with configurable expiry (default 7 days)
- Security headers in hooks.server.ts: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Strict-Transport-Security
- Use `request.text()` (not `.json()`) for webhook signature verification

### Testing
- **Unit tests**: Vitest for business logic
- **Component tests**: Vitest with `@vitest/browser-playwright`
- **Property tests**: fast-check with minimum 100 iterations
- **E2E**: Playwright with `bun run build && bun run preview`

Key property tests: quality model round trip, gap/upgrade discovery correctness, priority calculation determinism, queue processing order, exponential backoff, pagination completeness, batch size limits
