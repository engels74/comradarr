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

# Testing
bun run test                   # Run all tests
bun run test:unit              # Unit tests only
bun run test -- path/to/file   # Single test file

# Type checking
bun run check                  # Run svelte-check (tsc doesn't check .svelte files)
```

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
