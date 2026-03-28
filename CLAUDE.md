# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Comradarr is a media library completion service that integrates with \*arr applications (Sonarr, Radarr, Whisparr) to systematically identify and request missing or upgradeable content. Built with **SvelteKit 2 + Svelte 5**, **Bun** runtime, **PostgreSQL** via **Drizzle ORM**, and styled with **UnoCSS + shadcn-svelte**.

## Commands

### Development
```bash
bun install                          # Install dependencies
uv run --project dev_cli cr-dev dev  # Start dev server with ephemeral database
uv run --project dev_cli cr-dev dev --persist  # Keep database after exit
bun run dev                          # Start dev server (requires DATABASE_URL + SECRET_KEY)
bun run build                        # Production build
bun run start                        # Run production build
```

### Testing
```bash
bun run test                         # All tests (unit + integration via cr-dev)
bun run test:unit                    # Unit tests only (vitest)
vitest run src/path/to/file.test.ts  # Single test file
vitest run -t "test name"            # Single test by name
bun run test:watch                   # Watch mode
bun run test:integration             # Integration tests (needs PostgreSQL)
bun run test:db:setup                # Create test database
bun run test:db:reset                # Reset test database
```

### Code Quality
```bash
bun run typecheck                    # svelte-check + tsc --noEmit
bun run check:biome                  # Biome lint + format check
bun run lint                         # Biome lint only
bun run lint:fix                     # Biome lint with auto-fix
bun run format                       # Biome format with auto-write
bun run format:check                 # Biome format check only
```

### Database
```bash
bunx drizzle-kit generate            # Generate migration from schema changes
bunx drizzle-kit migrate             # Run migrations
bunx drizzle-kit push                # Push schema directly (dev/test)
bunx drizzle-kit studio              # Open Drizzle Studio GUI
```

## Architecture

### Stack
- **Runtime**: Bun (with `svelte-adapter-bun` for production)
- **Framework**: SvelteKit 2 with Svelte 5 (runes: `$state`, `$derived`, `$props`, `$effect`)
- **Database**: PostgreSQL via `drizzle-orm/bun-sql` (runtime uses `bun:sql`, drizzle-kit uses `postgres` package)
- **Styling**: UnoCSS with `preset-wind3` + `preset-shadcn` (Tailwind-compatible classes)
- **UI Components**: shadcn-svelte (bits-ui primitives)
- **Validation**: Valibot (`$lib/schemas/`)
- **Icons**: `@lucide/svelte` (direct icon imports, not barrel)
- **Scheduling**: Croner for cron-based background jobs
- **Auth**: Argon2id password hashing, session-based + API key + local network bypass

### Route Structure
```
src/routes/
  (app)/          # Authenticated routes (session auth enforced in hooks.server.ts)
    dashboard/    # Main dashboard with completion stats, activity feed
    connectors/   # *arr application connections (add/edit/detail with [id])
    content/      # Browse synced content with search state
    queue/        # Search request queue management
    schedules/    # Sweep schedule configuration
    analytics/    # Search/discovery metrics and charts
    settings/     # User, security, notification, backup settings
    logs/         # Application log viewer
  (auth)/         # Unauthenticated routes (login, setup)
  api/            # REST API endpoints (API key auth via x-api-key header)
  health/         # Health check endpoint
```

### Server Architecture (`src/lib/server/`)
- **`db/`** - Drizzle ORM setup, schema (`db/schema/index.ts`), and query modules (`db/queries/`)
- **`connectors/`** - *arr API clients with a polymorphic factory: `createConnectorClient()` returns `SonarrClient`, `RadarrClient`, or `WhisparrClient` based on connector type. All extend `BaseArrClient` with shared retry, error handling, and response parsing
- **`services/`** - Business logic organized by domain:
  - `sync/` - Incremental sync and full reconciliation from *arr apps
  - `discovery/` - Gap detection (missing content) and upgrade detection (quality cutoff not met)
  - `queue/` - Priority queue with state machine (pending -> queued -> searching -> cooldown/exhausted), backoff, episode batching
  - `throttle/` - Rate limiting enforcer per connector with configurable profiles
  - `notifications/` - Multi-channel notifications (Discord, Telegram, Slack, email, webhooks, etc.)
  - `reconnect/` - Auto-reconnection for offline connectors
  - `analytics/` - Event collection and hourly/daily aggregation
  - `backup/` - Database backup with retention
  - `prowlarr/` - Indexer health monitoring
- **`scheduler.ts`** - Central Croner-based scheduler that initializes all background jobs on startup
- **`context.ts`** - `AsyncLocalStorage`-based request context for correlation ID propagation
- **`crypto.ts`** - AES-256-GCM encryption for API keys/credentials (format: `iv:authTag:ciphertext` hex-encoded)
- **`auth/`** - Password hashing, session management, API key validation, local network bypass

### Client-Side Patterns (`src/lib/`)
- **`stores/`** - Svelte 5 class-based stores in `.svelte.ts` files (e.g., `ThemeStore`, `ToastStore`) using `$state` and getters
- **`components/ui/`** - shadcn-svelte base components (auto-generated, excluded from TS checks)
- **`components/`** - Feature-specific components organized by route/domain
- **`schemas/`** - Valibot validation schemas shared between client and server
- **`utils.ts`** - `cn()` helper (clsx + tailwind-merge) for class merging

### Authentication Flow
Authentication is handled in `hooks.server.ts` with a priority chain:
1. **API key** (`x-api-key` header) - only for `/api/*` routes, with per-key rate limiting
2. **Session** (cookie-based) - 7-day sessions stored in PostgreSQL
3. **Local bypass** - optional mode for local network access without login

Routes under `(app)/` require authentication; unauthenticated users are redirected to `/login`.

### Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `SECRET_KEY` - 64-char hex string for AES-256-GCM encryption (`openssl rand -hex 32`)
- `ADDRESS_HEADER` - Optional: header name for client IP behind reverse proxy

### Key Conventions
- **TypeScript**: Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- **Formatting**: Biome with tabs, single quotes, 100-char line width, trailing commas off
- **Logger**: Use `createLogger('module-name')` from `$lib/server/logger` for structured logging with correlation IDs
- **Database queries**: Organized in `$lib/server/db/queries/` by domain, imported by route `+page.server.ts` files
- **Pre-commit**: Biome check + ruff (Python). Pre-push: typecheck + full test suite

### dev_cli (`dev_cli/`)
A Python CLI tool (`cr-dev`) for development workflows. Requires Python 3.14+ and uv. Manages PostgreSQL lifecycle, runs tests with auto-provisioned databases, and provides a TUI menu. Has its own [CLAUDE.md](dev_cli/CLAUDE.md).

### Test Structure
```
tests/
  unit/           # Unit tests (vitest, no database needed)
  integration/    # Integration tests (needs PostgreSQL, uses bun:test)
  properties/     # Property-based tests (fast-check)
src/**/*.test.ts  # Co-located unit tests
```

Integration tests use `bun:test` (not vitest) and require `DATABASE_URL` + `SECRET_KEY` environment variables.
