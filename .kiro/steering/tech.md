# Tech Stack & Build System

## Runtime & Package Manager

- **Bun** - JavaScript runtime and package manager
- Use `bun` commands for all package operations

## Frontend

- **Svelte 5** with Runes reactivity (`$state`, `$derived`, `$effect`, `$props`)
- **SvelteKit 2.x** with `svelte-adapter-bun` for Bun-native deployments
- **shadcn-svelte** for UI components
- **UnoCSS** with `presetWind`, `presetAnimations`, `presetShadcn`
- **Lucide Svelte** for icons - import from `@lucide/svelte/icons/icon-name`
- **Chart.js** with date-fns adapter for analytics charts

## Backend

- **TypeScript** with strict configuration
- **PostgreSQL** via Bun's native SQL driver (`bun:sql`)
- **Drizzle ORM** for type-safe queries and migrations
- **Croner** for cron-based scheduling
- **Argon2id** (`@node-rs/argon2`) for password hashing
- **AES-256-GCM** for API key encryption at rest

## Key Libraries

- `bits-ui` - Headless UI primitives
- `formsnap` - Form handling with Svelte 5
- `@tanstack/svelte-virtual` - Virtualized lists
- `nodemailer` - Email notifications

## Common Commands

```bash
# Development
bun run dev          # Start dev server
bun run build        # Production build
bun run preview      # Preview production build

# Type Checking
bun run check        # Svelte check
bun run typecheck    # Full TypeScript check

# Testing
bun run test         # Run all tests
bun run test:unit    # Unit tests only (vitest)
bun run test:watch   # Watch mode

# Database
bun run db:generate  # Generate migrations
bun run db:migrate   # Run migrations
bun run db:push      # Push schema changes
bun run db:studio    # Open Drizzle Studio
```

## TypeScript Configuration

Strict mode enabled with:
- `noUncheckedIndexedAccess`
- `exactOptionalPropertyTypes`
- `noImplicitOverride`
- `verbatimModuleSyntax`

## Path Aliases

- `$components` → `src/lib/components`
- `$server` → `src/lib/server`
- `$lib` → `src/lib` (SvelteKit default)
