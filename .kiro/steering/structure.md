# Project Structure

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

## Architecture Principles

### Single Responsibility
Each file/module has one purpose. Connector clients handle HTTP—not data transformation. Discovery finds gaps—not dispatch searches.

### Connector Isolation
Each *arr app type has isolated code in its own directory. Shared infrastructure lives in `common/`. Adding a new *arr app means creating new files, not modifying existing ones.

### Content Mirror + Search State Separation
Database separates what exists in *arr apps (content mirror tables) from what actions Comradarr has taken (search state tables). The content mirror can be rebuilt without losing operational history.

### Server-Only Enforcement
`$lib/server/` imports are enforced at build time—attempting to import server code in client bundles fails during build.

### Route Groups
`(app)` and `(auth)` organize pages without affecting URL structure. All `(app)` routes protected by auth guard in `+layout.server.ts`.

## Database Schema (Key Tables)

- `connectors`: id, type, name, url, api_key_encrypted, enabled, health_status, last_sync
- `series`: connector_id, arr_id, tvdb_id, title, status, monitored, quality_profile_id
- `seasons`: series_id, season_number, monitored, total_episodes, downloaded_episodes
- `episodes`: season_id, arr_id, season/episode_number, has_file, quality (jsonb), quality_cutoff_not_met
- `movies`: connector_id, arr_id, tmdb_id, imdb_id, title, year, has_file, quality (jsonb)
- `search_registry`: connector_id, content_type, content_id, search_type, state, attempt_count, priority
- `request_queue`: search_registry_id, connector_id, batch_id, priority, scheduled_at

## Search State Machine

`pending` → `queued` → `searching` → `cooldown` (on failure) → `queued` (retry) or `exhausted` (max attempts)
