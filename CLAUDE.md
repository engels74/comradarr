# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Codebase Search

**Always use the `mcp__auggie-mcp__codebase-retrieval` tool as the primary method for:**
- Exploring the codebase and understanding architecture
- Finding existing patterns before implementing new features
- Locating relevant code when the exact file location is unknown
- Gathering context before making edits
- Planning tasks in plan mode

This semantic search tool provides better results than grep/find for understanding code relationships. Use grep only for finding exact string matches or all occurrences of a known identifier.

## Project Overview

Comradarr is a media library completion service that integrates with *arr applications (Sonarr, Radarr, Whisparr) to systematically identify and request missing or upgradeable content. Unlike similar tools that use tags for state tracking, Comradarr maintains all state in its own PostgreSQL database for accurate episode-level tracking.

## Tech Stack

- **Runtime**: Bun (JavaScript runtime and package manager)
- **Frontend**: Svelte 5 with Runes reactivity, SvelteKit 2.x, shadcn-svelte, UnoCSS
- **Backend**: TypeScript (strict), PostgreSQL via `bun:sql`, Drizzle ORM
- **Scheduling**: Croner for cron-based jobs
- **Security**: Argon2id for passwords, AES-256-GCM for API key encryption

## Common Commands

```bash
# Development
bun run dev              # Start dev server
bun run build            # Production build
bun run preview          # Preview production build

# Type Checking
bun run check            # Svelte check
bun run typecheck        # Full TypeScript check (svelte-check + tsc)

# Testing
bun run test             # Run all tests (unit + integration with auto DB setup)
bun run test:unit        # Unit tests only (vitest, no DB required)
bun run test:integration # Integration tests only (requires PostgreSQL)
bun run test:watch       # Watch mode for unit tests
vitest run src/path/to/file.test.ts  # Run single test file

# Database
bun run db:generate      # Generate Drizzle migrations
bun run db:migrate       # Run pending migrations
bun run db:push          # Push schema changes (dev only)
bun run db:studio        # Open Drizzle Studio GUI

# Test Database Management
bun run test:db:setup    # Create test database
bun run test:db:teardown # Remove test database
bun run test:db:reset    # Reset test database
```

## Architecture

### Directory Structure

```
src/
├── lib/
│   ├── components/           # UI components by domain
│   │   └── ui/               # shadcn-svelte primitives
│   ├── schemas/              # Valibot validation schemas
│   ├── server/               # Server-only code (enforced at build)
│   │   ├── auth/             # Session, password, lockout
│   │   ├── connectors/       # *arr API clients
│   │   │   ├── common/       # BaseArrClient, shared types, errors
│   │   │   ├── sonarr/       # client.ts, types.ts, parsers.ts
│   │   │   ├── radarr/
│   │   │   └── whisparr/
│   │   ├── db/
│   │   │   ├── schema/       # Drizzle schema (single index.ts)
│   │   │   └── queries/      # Query functions by domain
│   │   └── services/         # Business logic
│   │       ├── sync/         # Library synchronization
│   │       ├── discovery/    # Gap and upgrade detection
│   │       ├── queue/        # Request queue management
│   │       └── throttle/     # Rate limiting
│   ├── stores/               # Shared state (.svelte.ts with $state)
│   └── utils/                # Pure utility functions
├── routes/
│   ├── (app)/                # Protected routes (auth guard in +layout.server.ts)
│   ├── (auth)/               # Login/logout routes
│   └── api/                  # REST API endpoints
└── hooks.server.ts           # Auth validation, security headers
```

### Key Patterns

**Server Code Isolation**: `$lib/server/` enforces server-only imports at build time.

**Route Groups**: `(app)` requires authentication, `(auth)` is public. Groups don't affect URLs.

**Connector Architecture**: Each *arr connector has isolated `client.ts`, `types.ts`, `parsers.ts` extending `BaseArrClient`.

**Content Mirror Pattern**: Local database mirrors *arr library state. Search state is tracked separately so the mirror can be rebuilt without losing operational history.

### Path Aliases

- `$components` → `src/lib/components`
- `$server` → `src/lib/server`
- `$lib` → `src/lib`

## Svelte 5 Conventions

- Use `$props()` with destructuring, never `export let`
- Use `$state()` for mutable reactive values
- Use `$derived()` for computed values (prefer over `$effect()`)
- Use `$effect()` only for side effects (DOM, logging, external sync)
- Use `{#snippet}` and `{@render}` instead of `<slot>`
- Use callback props instead of `createEventDispatcher`
- Import icons from `@lucide/svelte/icons/icon-name` for tree-shaking

## Database

**Schema**: Single file at `src/lib/server/db/schema/index.ts`

**Type Inference**: Use `$inferSelect` and `$inferInsert` from Drizzle for types

**Migrations**: Generated with timestamps prefix via `bun run db:generate`

**Key Tables**:
- `connectors`: *arr application connections with encrypted API keys
- `series`, `seasons`, `episodes`: Sonarr/Whisparr content mirror
- `movies`: Radarr content mirror
- `searchRegistry`, `requestQueue`: Search state tracking
- `users`, `sessions`: Authentication

## Testing

- **Unit tests**: Vitest, files in `src/**/*.test.ts` or `tests/unit/`
- **Integration tests**: Bun test, files in `tests/integration/` (require PostgreSQL)
- **Property tests**: fast-check for property-based testing

The test script auto-installs PostgreSQL on macOS (Homebrew) and Ubuntu/Debian if needed.
