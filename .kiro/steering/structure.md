# Project Structure

## Directory Layout

```
src/
├── lib/
│   ├── components/           # Reusable UI components
│   │   ├── ui/               # shadcn-svelte primitives (auto-generated)
│   │   ├── analytics/        # Analytics charts and displays
│   │   ├── connectors/       # Connector management UI
│   │   ├── content/          # Content tables and filters
│   │   ├── dashboard/        # Dashboard panels
│   │   ├── prowlarr/         # Prowlarr integration UI
│   │   ├── queue/            # Queue management UI
│   │   ├── schedules/        # Schedule configuration UI
│   │   └── shared/           # Cross-cutting UI utilities
│   ├── schemas/              # Validation schemas (form validation)
│   ├── server/               # Server-only code
│   │   ├── auth/             # Authentication (session, password, lockout)
│   │   ├── connectors/       # *arr API clients
│   │   │   ├── common/       # Shared client infrastructure
│   │   │   ├── sonarr/       # Sonarr client
│   │   │   ├── radarr/       # Radarr client
│   │   │   └── whisparr/     # Whisparr client
│   │   ├── db/
│   │   │   ├── schema/       # Drizzle schema (single index.ts)
│   │   │   └── queries/      # Query functions by domain
│   │   └── services/         # Business logic
│   │       ├── analytics/    # Metrics collection
│   │       ├── discovery/    # Gap and upgrade detection
│   │       ├── maintenance/  # Database cleanup
│   │       ├── notifications/# Notification dispatch
│   │       ├── prowlarr/     # Prowlarr health monitoring
│   │       ├── queue/        # Request queue management
│   │       ├── sync/         # Library synchronization
│   │       └── throttle/     # Rate limiting
│   ├── stores/               # Shared state (.svelte.ts files)
│   ├── types/                # Type declarations
│   └── utils/                # Pure utility functions
├── routes/
│   ├── (app)/                # Authenticated routes (auth guard in +layout.server.ts)
│   │   ├── analytics/
│   │   ├── connectors/
│   │   ├── content/
│   │   ├── dashboard/
│   │   ├── queue/
│   │   ├── schedules/
│   │   └── settings/
│   ├── (auth)/               # Login/logout routes
│   └── api/                  # REST API endpoints
├── hooks.server.ts           # Auth validation, security headers
└── app.d.ts                  # App.Locals type declarations
```

## Key Conventions

### Server Code Isolation
- `$lib/server/` enforces server-only imports at build time
- Never import server code in client bundles

### Route Groups
- `(app)` - Protected routes requiring authentication
- `(auth)` - Public authentication routes
- Groups don't affect URL structure

### Connector Architecture
Each *arr connector is isolated:
- `client.ts` - HTTP client extending BaseArrClient
- `types.ts` - TypeScript interfaces for API responses
- `parsers.ts` - Transform API responses to domain models
- `index.ts` - Public exports

### Service Layer
Services contain business logic:
- One service per domain (sync, discovery, queue, etc.)
- Services orchestrate connectors and database queries
- Each service has `types.ts` for its interfaces

### Database Layer
- Schema in `src/lib/server/db/schema/index.ts`
- Queries organized by domain in `queries/` directory
- Use `$inferSelect` and `$inferInsert` for type inference

### Component Organization
- Domain-specific components in named folders
- Each folder has `index.ts` for exports
- `types.ts` for component-specific types
