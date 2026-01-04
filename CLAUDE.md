# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Comradarr is a media library completion service integrating with *arr applications (Sonarr, Radarr, Whisparr) to identify and request missing or upgradeable content.

## Tech Stack

- **Runtime:** Bun
- **Framework:** SvelteKit 2 with Svelte 5
- **Database:** PostgreSQL 15+ with Drizzle ORM
- **Styling:** UnoCSS with Tailwind preset, shadcn-svelte components
- **Testing:** Vitest (unit), Bun test (integration)

## Commands

```bash
# Development
bun run dev                    # Start dev server with hot reload
bun run check                  # Type check Svelte components
bun run typecheck              # Full TypeScript check (includes tsc --noEmit)

# Testing
bun run test:unit              # Run unit tests only (no database required)
bun run test:watch             # Watch mode for unit tests
bun run test                   # Full test suite (auto-handles DB setup)
bun run test:db:setup          # Manually setup test database

# Database
bun run db:generate            # Generate new migrations
bun run db:migrate             # Run pending migrations
bun run db:push                # Push schema changes directly
bun run db:studio              # Visual database editor

# Build
bun run build                  # Production build to ./build
bun run preview                # Preview built application
```

## Architecture

### Directory Structure

- `src/lib/server/` - All server-side code (never imported client-side)
  - `connectors/` - *arr API clients using factory pattern (`createConnectorClient()`)
  - `services/` - Business logic: sync, discovery, queue, throttle, analytics, etc.
  - `db/schema/` - Drizzle ORM schema definitions
  - `db/queries/` - Database query functions (one file per entity)
  - `scheduler.ts` - Background job scheduler (croner with 11 jobs)
  - `context.ts` - AsyncLocalStorage for request correlation IDs
- `src/lib/components/` - Svelte components
  - `ui/` - shadcn-svelte base components
- `src/lib/schemas/` - Zod validation schemas
- `src/routes/` - SvelteKit file-based routing
  - `(app)/` - Protected routes requiring authentication
  - `(auth)/` - Login/auth routes
  - `api/` - REST API endpoints (v1)

### Key Patterns

**Request Context:** Uses AsyncLocalStorage (`src/lib/server/context.ts`) for correlation ID propagation through async chains. All services and logging use this context.

**Connector Factory:** `createConnectorClient()` instantiates the correct client (Sonarr/Radarr/Whisparr) based on connector type. Base client handles retry logic and error handling.

**Database Queries:** Each entity has a dedicated query file in `db/queries/` exporting typed functions. Schema uses snake_case columns, TypeScript uses camelCase.

**Service Organization:** Services are in `services/` with index files exporting public functions and types. Key services:
- `sync/` - Content synchronization from *arr apps
- `discovery/` - Gap detection (missing) and upgrade detection (quality improvements)
- `queue/` - Priority-based search request management
- `throttle/` - Rate limiting per connector

**Background Jobs:** Croner scheduler runs 11 jobs including health checks, syncs, analytics aggregation, and maintenance. Jobs use `protect: true` to prevent overlap.

**Encryption:** AES-256-GCM for sensitive data (connector API keys, notification credentials). See `crypto.ts`.

## TypeScript Configuration

Uses strict TypeScript with additional flags:
- `noUncheckedIndexedAccess: true` - Array/object access returns possibly undefined
- `exactOptionalPropertyTypes: true` - Distinguishes `undefined` from optional
- `noImplicitOverride: true` - Requires `override` keyword

## Environment

Required: `DATABASE_URL` - PostgreSQL connection string
Optional: `SECRET_KEY` - 32-byte hex for encryption (auto-generated if missing)
