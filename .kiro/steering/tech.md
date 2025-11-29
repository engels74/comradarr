# Tech Stack

## Runtime
- **Bun** - JavaScript runtime and package manager

## Frontend
- **Svelte 5** with Runes (`$state`, `$derived`, `$effect`, `$props`)
- **SvelteKit 2.x** with `svelte-adapter-bun`
- **shadcn-svelte** for UI components via `unocss-preset-shadcn`
- **UnoCSS** with `presetWind`, `presetAnimations`, `presetShadcn`
- **Lucide Svelte** for icons (direct imports for tree-shaking)

## Backend
- **TypeScript** (strict mode: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`)
- **PostgreSQL** via Bun's native SQL driver (`bun:sql`)
- **Drizzle ORM** for type-safe queries and migrations (timestamp prefix migrations)
- **Croner** for cron scheduling with `protect: true` for overrun protection
- **Valibot** for validation (smaller than Zod for client-side)
- **Argon2id** for password hashing (`@node-rs/argon2`)
- **AES-256-GCM** for API key encryption at rest

## Deployment
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

# Testing (automated with database lifecycle)
bun run test                   # Run all tests (unit + integration)
bun run test:unit              # Unit tests only (no database required)
bun run test:integration       # Integration tests only (requires PostgreSQL)
bun run test:watch             # Watch mode for unit tests

# Test database management (WSL/native PostgreSQL)
./scripts/test-db.sh install   # Install PostgreSQL on WSL (Ubuntu/Debian)
./scripts/test-db.sh start     # Start PostgreSQL service
./scripts/test-db.sh setup     # Create test database and run migrations
./scripts/test-db.sh status    # Check PostgreSQL and test database status
./scripts/test-db.sh reset     # Reset test database (teardown + setup)
./scripts/test-db.sh teardown  # Drop test database

# Type checking
bun run check                  # Run svelte-check (for .svelte files)
bun run typecheck              # Full type check (svelte-check + tsc --noEmit)
```

### Quality Check Workflow

Before committing or creating a PR, run the complete quality check:

```bash
bun run test                   # All tests (unit + integration)
bun run typecheck              # Full type checking
```

Or as a single command:
```bash
bun run test && bun run typecheck
```

**Note:** Integration tests require PostgreSQL. If PostgreSQL is not running, integration tests are automatically skipped with a warning. To enable integration tests:
1. Install PostgreSQL: `./scripts/test-db.sh install`
2. Start PostgreSQL: `./scripts/test-db.sh start`
3. The test runner will automatically set up the test database on first run

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
- **Unit tests**: Vitest for pure business logic (no database required)
- **Integration tests**: Bun test for database operations (requires PostgreSQL)
- **Property tests**: fast-check with minimum 100 iterations
- **E2E**: Playwright with `bun run build && bun run preview`

Key property tests: quality model round trip, gap/upgrade discovery correctness, priority calculation determinism, queue processing order, exponential backoff, pagination completeness, batch size limits

**Test Infrastructure**:
- `bun run test` automatically handles database lifecycle for integration tests
- PostgreSQL is optional—integration tests skip gracefully if unavailable
- Test database is isolated (`comradarr_test`) from development database
- Database migrations run automatically on test setup
