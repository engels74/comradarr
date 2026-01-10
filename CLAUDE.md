# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Comradarr is a media library completion service that integrates with *arr applications (Sonarr, Radarr, Whisparr) to systematically identify and request missing or upgradeable content. Built with Bun, SvelteKit 2, Svelte 5, Drizzle ORM, and PostgreSQL.

## Commands

### Development
```bash
bun install                          # Install dependencies
bun run dev                          # Start dev server with Vite
bun run build                        # Production build
bun run start                        # Run production build
```

### Type Checking & Linting
```bash
bun run typecheck                    # svelte-check + tsc --noEmit
bun run check                        # svelte-check only
bun run lint                         # Biome lint
bun run format                       # Biome format
bun run check:biome                  # Biome check (lint + format)
```

### Testing
```bash
bun run test                         # Full test suite (unit + integration via Python CLI)
bun run test:unit                    # Vitest unit tests only
bun run test:watch                   # Vitest watch mode
bun run test:integration             # Integration tests with real database
```

### Database (via Python CLI or directly)
```bash
bun run db:generate                  # Generate migrations from schema changes
bun run db:migrate                   # Apply pending migrations
bun run db:push                      # Push schema directly (dev only)
bun run db:studio                    # Open Drizzle Studio GUI

# Python CLI for test database management
bun run test:db:setup                # Create test database container
bun run test:db:teardown             # Remove test database
bun run test:db:reset                # Reset test database
bun run test:db:status               # Show database status
```

### Python Dev Tools (run from project root)
```bash
uv run --project dev-cli cr-dev menu            # Interactive TUI menu
uv run --project dev-cli cr-dev dev             # Dev server with temp database
uv run --project dev-cli cr-dev dev --persist   # Dev server with named database
uv run --project dev-cli basedpyright src tests # Type check Python code
uv run --project dev-cli ruff check src tests   # Lint Python code
```

## Architecture

### Stack
- **Runtime**: Bun with native PostgreSQL driver (`bun:sql`)
- **Framework**: SvelteKit 2.x with svelte-adapter-bun
- **UI**: Svelte 5 (Runes), shadcn-svelte, UnoCSS (presetWind3 + presetShadcn)
- **Database**: PostgreSQL with Drizzle ORM
- **Type Checking**: svelte-check + TypeScript strict mode
- **Linting/Formatting**: Biome (tabs, single quotes, 100 line width)

### Directory Structure
```
src/
├── lib/
│   ├── components/         # Svelte components (shadcn-svelte UI in ui/)
│   ├── server/             # Server-only code (enforced by SvelteKit)
│   │   ├── auth/           # Authentication (Argon2id, sessions, lockout)
│   │   ├── connectors/     # *arr API clients (sonarr/, radarr/, whisparr/)
│   │   ├── db/             # Drizzle schema and queries
│   │   │   ├── schema/     # Table definitions with inferred types
│   │   │   └── queries/    # Database query functions
│   │   └── services/       # Business logic services
│   │       ├── analytics/  # Stats aggregation
│   │       ├── discovery/  # Gap/upgrade detection
│   │       ├── notifications/ # Multi-channel notifications
│   │       ├── prowlarr/   # Indexer health monitoring
│   │       ├── queue/      # Search queue management
│   │       ├── sync/       # Content synchronization
│   │       └── throttle/   # Rate limiting
│   └── stores/             # Svelte state (use $state in .svelte.ts)
└── routes/
    ├── (app)/              # Authenticated routes
    ├── (auth)/             # Login/logout
    └── api/                # API endpoints
```

### Key Patterns

**Svelte 5 Runes**: Use `$state()`, `$derived()`, `$props()`, `{#snippet}`, `{@render}`. Avoid legacy `export let`, `$:`, and `<slot>`.

**Database**: Schema in `src/lib/server/db/schema/index.ts`. Use `$inferSelect`/`$inferInsert` for types. Runtime uses `bun:sql`, drizzle-kit uses `postgres` package.

**Connectors**: Factory pattern in `src/lib/server/connectors/factory.ts`. Each connector type (sonarr, radarr, whisparr) has its own client, types, and parsers.

**Authentication**: Argon2id hashing, session-based with cookies, account lockout after failed attempts. Implemented in `src/lib/server/auth/`.

**Throttle System**: Per-connector rate limiting with daily budgets, batch processing, and automatic backoff. State persisted in `throttle_state` table.

### Path Aliases
- `$lib` - src/lib
- `$components` - src/lib/components
- `$server` - src/lib/server

## Code Style

**TypeScript**: Strict mode enabled. Use `satisfies` for configs, infer types from Drizzle schema.

**Svelte Components**: Use Svelte 5 syntax exclusively:
```svelte
<script lang="ts">
  import type { PageProps } from './$types';
  let { data }: PageProps = $props();
  const doubled = $derived(data.count * 2);
</script>
```

**Biome Config**: Tabs, single quotes, no trailing commas, 100 char line width.

**Icons**: Import directly from `@lucide/svelte/icons/icon-name` for tree-shaking.

## Database Schema

Key tables: `connectors`, `series`, `seasons`, `episodes`, `movies`, `search_registry`, `request_queue`, `throttle_state`, `users`, `sessions`, `api_keys`, `notification_channels`, `sweep_schedules`, `analytics_events`.

API keys use prefix-based lookup with Argon2id hashed storage. Connector API keys use AES-256-GCM encryption.

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string (required)
- `SECRET_KEY` - 32-byte hex key for API key encryption (required in production; auto-generated by dev CLI only)
