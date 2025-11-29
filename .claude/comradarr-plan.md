# Comradarr — AI Development Prompt

## Overview

Comradarr is a modern media library completion service that integrates with *arr applications (Sonarr, Radarr, Whisparr) to systematically identify and request missing or upgradeable content. It solves the fundamental limitation that *arr applications only monitor RSS feeds for new releases and do not actively search for older missing content in existing libraries.

Unlike similar tools that pollute *arr applications with tags to track state, Comradarr maintains all state in its own database. This provides accurate episode-level tracking, clean separation of concerns, and proper scalability for large libraries.

---

## Tech Stack

### Runtime and Package Management
- **Bun** as the JavaScript runtime and package manager

### Frontend
- **Svelte 5** with the Runes reactivity system (`$state`, `$derived`, `$effect`, `$props`)
- **SvelteKit 2.x** as the full-stack framework with `svelte-adapter-bun` for Bun-native deployments
- **shadcn-svelte** for UI components integrated via `unocss-preset-shadcn`
- **UnoCSS** for styling with `presetWind`, `presetAnimations`, and `presetShadcn` presets; use attributify mode and define shortcuts for repeated utility combinations
- **Lucide Svelte** for icons with direct imports from `@lucide/svelte/icons/icon-name` for tree-shaking

### Backend
- **TypeScript** with strict configuration extending SvelteKit's generated config; enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, and `verbatimModuleSyntax`
- **PostgreSQL** as the primary database using Bun's native SQL driver (`bun:sql`)
- **Drizzle ORM** for type-safe queries and schema migrations with `drizzle-orm/bun-sql`; use `$inferSelect` and `$inferInsert` for type inference
- **Croner** for cron-based scheduling with `protect: true` for overrun protection
- **Valibot** for validation schemas (smaller bundle than Zod for client-side validation)
- Native fetch API with AbortSignal.timeout for *arr application communication

### Notifications
- Native integrations for Discord, Telegram, Slack, Pushover, Gotify, ntfy
- Webhook support with raw body access (`request.text()`) for signature verification
- Email via SMTP

### Deployment
- Docker multi-stage builds with BuildKit cache mounts for Bun package cache
- Use `svelte-adapter-bun` (not adapter-node) for Bun-native builds
- Supports both external PostgreSQL and embedded PostgreSQL for single-container deployment
- Health checks with `pg_isready` for database dependency ordering
- Docker secrets for database passwords (avoid environment variable exposure)

---

## Core Concepts

### Connectors
A connector is a configured connection to an *arr application instance. Each connector stores the URL, API key, and instance-specific settings. Users may have multiple connectors of the same type (for example, separate Sonarr instances for television and anime).

### Sweep Cycles
A sweep cycle is a scheduled operation that scans a connector's library for content gaps or upgrade opportunities. Sweeps run on configurable intervals and process content in small batches to respect indexer rate limits.

### Content Gaps
Content gaps are missing items within a library — episodes not yet downloaded, movies added but not acquired.

### Upgrade Candidates
Upgrade candidates are existing items that could be replaced with higher quality versions based on the quality profile configured in the *arr application.

### Throttle Profiles
Throttle profiles define rate-limiting behavior to prevent indexer bans. They control batch sizes, delays between requests, cooldown periods after errors, and daily request budgets.

### Request Queue
The request queue is a prioritized list of search requests waiting to be sent to *arr applications. Items enter the queue from sweep cycles and are processed according to throttle profile rules.

---

## Application Architecture

### Project Structure

Follow SvelteKit's recommended structure with clear separation of concerns. Each directory has a single purpose, and files within directories follow the single-responsibility principle.

```
src/
├── lib/
│   ├── components/           # Reusable UI components
│   │   ├── ui/               # shadcn-svelte primitives
│   │   ├── layout/           # Page structure components
│   │   ├── connectors/       # Connector-specific UI
│   │   ├── content/          # Content display components
│   │   ├── queue/            # Queue management UI
│   │   └── shared/           # Cross-cutting UI utilities
│   ├── server/               # Server-only code (enforced at build time)
│   │   ├── db/
│   │   │   ├── index.ts      # Database client initialization
│   │   │   ├── schema/       # Drizzle schema files (one per domain)
│   │   │   ├── queries/      # Query functions (one per domain)
│   │   │   └── migrations/   # Auto-generated migration files
│   │   ├── connectors/       # *arr API clients (see Modular Architecture)
│   │   │   ├── common/       # Shared client infrastructure
│   │   │   ├── sonarr/       # Sonarr-specific client
│   │   │   ├── radarr/       # Radarr-specific client
│   │   │   ├── whisparr/     # Whisparr-specific client
│   │   │   └── index.ts      # Factory and unified exports
│   │   ├── services/         # Business logic (see Modular Architecture)
│   │   │   ├── sync/         # Library synchronization
│   │   │   ├── discovery/    # Gap and upgrade detection
│   │   │   ├── queue/        # Request queue management
│   │   │   ├── notifications/# Notification dispatch
│   │   │   └── analytics/    # Metrics collection
│   │   └── scheduler.ts      # Croner job initialization
│   ├── stores/               # Shared state (.svelte.ts files with $state)
│   └── utils/                # Shared pure utility functions
├── routes/
│   ├── (app)/                # Authenticated application routes
│   │   ├── +layout.server.ts # Auth guard for all child routes
│   │   ├── dashboard/
│   │   ├── connectors/
│   │   ├── content/
│   │   ├── queue/
│   │   ├── schedules/
│   │   ├── analytics/
│   │   └── settings/
│   ├── (auth)/               # Login/logout routes
│   ├── api/                  # REST API endpoints
│   └── webhooks/             # External webhook handlers
├── hooks.server.ts           # Authentication and security headers
└── app.d.ts                  # Type declarations for App.Locals
```

The `$lib/server/` directory enforces server-only imports at build time—attempting to import server code in client bundles fails during build. Route groups `(app)` and `(auth)` organize pages without affecting URL structure.

### Module Structure

**Connector Module**
Handles all communication with *arr applications. Provides a unified typed client interface using `X-Api-Key` header authentication with configurable timeout via `AbortSignal.timeout()`. Manages connection health checking, API versioning detection, and error handling with automatic retry logic. Place in `$lib/server/connectors/`.

**Sync Module**
Responsible for synchronizing library data from connected *arr applications into the local content mirror. Supports both incremental sync (items modified since last sync) and full reconciliation sweeps. Handles pagination for large libraries (1000 items per page) and manages sync state per connector.

**Discovery Module**
Analyzes the content mirror to identify content gaps and upgrade candidates. Works with the search state table to determine which items need attention. Implements smart batching logic for efficient searching.

**Scheduler Module**
Initialize Croner jobs in `hooks.server.ts` (runs once on startup). Manages all timed operations including sweep cycles, queue processing, health checks, sync operations, and database maintenance. Use `protect: true` to prevent overlapping executions and `catch` for error handling. Supports cron expressions with timezone awareness.

**Queue Module**
Manages the prioritized request queue. Handles batch grouping (combining multiple episodes of the same series into a single search), priority assignment, deduplication, and rate-limit-aware dispatching.

**Notification Module**
Sends notifications for configurable events. Supports multiple simultaneous notification channels. Provides templating for message customization and batching to avoid notification spam. Use `request.text()` for webhook signature verification.

**Analytics Module**
Tracks historical data about discoveries, successful acquisitions, indexer performance, and queue throughput. Provides insights into library completion progress over time.

**Maintenance Module**
Handles database maintenance tasks including pruning of stale search state records, vacuum operations, and cleanup of orphaned data.

---

## Modular Architecture Principles

The codebase follows **single-responsibility design** with high cohesion and loose coupling. Each module, service, and component has one well-defined purpose, making the system easy to maintain, test, and extend with new *arr applications or features.

### Core Design Principles

**Single Responsibility**
Every file, class, and function should do one thing well. A connector client handles API communication—not data transformation. A discovery service finds gaps—not dispatch searches. When responsibilities are clearly separated, changes to one concern don't ripple through unrelated code.

**Dependency Inversion**
High-level modules (orchestration, scheduling) depend on abstractions (interfaces, types), not concrete implementations. This allows swapping implementations (adding a new *arr application) without modifying consuming code.

**Open/Closed Principle**
The architecture is open for extension but closed for modification. Adding Lidarr support should mean creating new files, not editing existing Sonarr or Radarr code.

### Connector Architecture (Per-Application Isolation)

Each *arr application is fully isolated in its own directory structure. Shared code is extracted to a common layer, while application-specific logic remains encapsulated.

```
src/lib/server/connectors/
├── common/
│   ├── base-client.ts        # Abstract HTTP client with auth, retry, timeout
│   ├── types.ts              # Shared types (QualityProfile, Command, etc.)
│   ├── errors.ts             # Typed error classes for API failures
│   └── utils.ts              # Shared utilities (pagination, rate limiting)
├── sonarr/
│   ├── index.ts              # Public API exports
│   ├── client.ts             # Sonarr-specific HTTP client extending base
│   ├── types.ts              # Series, Episode, Season types
│   ├── mapper.ts             # Transform API responses to domain models
│   └── commands.ts           # Sonarr command builders (EpisodeSearch, etc.)
├── radarr/
│   ├── index.ts              # Public API exports
│   ├── client.ts             # Radarr-specific HTTP client extending base
│   ├── types.ts              # Movie, Collection types
│   ├── mapper.ts             # Transform API responses to domain models
│   └── commands.ts           # Radarr command builders (MoviesSearch, etc.)
├── whisparr/
│   ├── index.ts              # Public API exports
│   ├── client.ts             # Whisparr-specific HTTP client extending base
│   ├── types.ts              # Site, Scene types
│   ├── mapper.ts             # Transform API responses to domain models
│   └── commands.ts           # Whisparr command builders
└── index.ts                  # Unified factory and type exports
```

**File Responsibilities:**

| File | Single Responsibility |
|------|----------------------|
| `base-client.ts` | HTTP mechanics: auth headers, timeouts, retries, error handling |
| `client.ts` | Endpoint definitions and request/response typing for one *arr app |
| `types.ts` | TypeScript interfaces matching the *arr API schemas |
| `mapper.ts` | Transform raw API responses into normalized domain models |
| `commands.ts` | Build command payloads for search, refresh, and other actions |
| `index.ts` | Public API surface—what other modules can import |

### Service Layer Architecture

Services contain business logic and orchestrate connectors. Each service has a single domain focus.

```
src/lib/server/services/
├── sync/
│   ├── index.ts              # Public exports
│   ├── sync-service.ts       # Orchestrates sync operations
│   ├── incremental.ts        # Incremental sync logic
│   └── reconciliation.ts     # Full library reconciliation
├── discovery/
│   ├── index.ts              # Public exports
│   ├── discovery-service.ts  # Orchestrates gap/upgrade detection
│   ├── gap-detector.ts       # Identifies missing content
│   └── upgrade-detector.ts   # Identifies upgrade candidates
├── queue/
│   ├── index.ts              # Public exports
│   ├── queue-service.ts      # Orchestrates queue operations
│   ├── prioritizer.ts        # Priority assignment logic
│   ├── batcher.ts            # Groups episodes into efficient searches
│   └── dispatcher.ts         # Rate-limited request dispatch
├── notifications/
│   ├── index.ts              # Public exports
│   ├── notification-service.ts # Orchestrates notifications
│   └── channels/
│       ├── discord.ts        # Discord-specific formatting and sending
│       ├── telegram.ts       # Telegram-specific formatting and sending
│       ├── slack.ts          # Slack-specific formatting and sending
│       ├── email.ts          # SMTP email sending
│       └── webhook.ts        # Generic webhook with signature support
└── analytics/
    ├── index.ts              # Public exports
    ├── analytics-service.ts  # Query and aggregate analytics data
    └── collectors/
        ├── acquisition.ts    # Track successful downloads
        ├── indexer.ts        # Track indexer performance
        └── queue.ts          # Track queue throughput
```

### Database Layer Architecture

Database access follows repository pattern with schema, queries, and migrations cleanly separated.

```
src/lib/server/db/
├── index.ts                  # Database client initialization and export
├── schema/
│   ├── index.ts              # Aggregate schema exports
│   ├── connectors.ts         # Connector configuration tables
│   ├── content.ts            # Content mirror tables (series, movies, episodes)
│   ├── search-state.ts       # Search tracking tables
│   ├── queue.ts              # Request queue tables
│   ├── notifications.ts      # Notification configuration and history
│   ├── analytics.ts          # Analytics event tables
│   └── auth.ts               # User and session tables
├── queries/
│   ├── connectors.ts         # Connector CRUD operations
│   ├── content.ts            # Content queries and updates
│   ├── search-state.ts       # Search state queries
│   ├── queue.ts              # Queue queries
│   └── analytics.ts          # Analytics aggregation queries
└── migrations/               # Drizzle migration files (auto-generated)
```

### Frontend Component Organization

UI components follow the same single-responsibility approach.

```
src/lib/components/
├── ui/                       # shadcn-svelte primitives (Button, Card, etc.)
├── layout/
│   ├── Sidebar.svelte        # Navigation sidebar
│   ├── Header.svelte         # Page header with breadcrumbs
│   └── PageContainer.svelte  # Consistent page wrapper
├── connectors/
│   ├── ConnectorCard.svelte  # Display single connector status
│   ├── ConnectorForm.svelte  # Add/edit connector form
│   └── ConnectorHealth.svelte # Health indicator component
├── content/
│   ├── SeriesCard.svelte     # Series display (Sonarr/Whisparr)
│   ├── MovieCard.svelte      # Movie display (Radarr)
│   ├── EpisodeList.svelte    # Episode listing
│   └── ContentFilters.svelte # Filter controls
├── queue/
│   ├── QueueTable.svelte     # Queue item listing
│   ├── QueueItem.svelte      # Single queue item row
│   └── QueueControls.svelte  # Pause, clear, priority controls
└── shared/
    ├── StatusBadge.svelte    # Reusable status indicator
    ├── ProgressRing.svelte   # Circular progress display
    └── RelativeTime.svelte   # Human-readable timestamps
```

### Benefits of This Architecture

**Maintainability**: When a bug appears in Radarr search commands, look in exactly one file: `connectors/radarr/commands.ts`. Changes don't cascade.

**Testability**: Each module can be unit tested in isolation. Mock the `BaseArrClient` to test Sonarr-specific logic without network calls.

**Extensibility**: Adding features (new *arr app, new notification channel, new analytics metric) means creating new files, not modifying working code.

**Onboarding**: New contributors can understand one module without comprehending the entire system. Clear boundaries reduce cognitive load.

**Parallel Development**: Multiple developers can work on different modules simultaneously without merge conflicts.

---

## Authentication & Security

### Session-Based Authentication

Single-user authentication with secure session cookies. Password hashed using Argon2id (via `@node-rs/argon2`). Sessions stored in PostgreSQL with configurable expiry (default 7 days).

### Route Protection

- `(auth)` route group handles login/logout flows
- `(app)` route group protected via `+layout.server.ts` auth guard
- `hooks.server.ts` validates session cookie and populates `event.locals.user`
- Unauthenticated requests to `/app/*` redirect to `/login`

### Security Headers

Applied in `hooks.server.ts`:
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`  
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security` (production only)

### API Key Protection

Connector API keys encrypted at rest using AES-256-GCM with app-level `SECRET_KEY`. Decrypted only when making *arr API calls.


---

## State Management Patterns

### Component State with Runes

Use Svelte 5 Runes for all reactivity:

- **`$state()`** for mutable reactive values with deep proxy reactivity
- **`$state.raw()`** for large datasets or immutable patterns where only reassignment triggers updates
- **`$derived()`** for computed values (90% of cases where you might think you need `$effect()`)
- **`$derived.by()`** for complex computed logic requiring multiple statements
- **`$effect()`** exclusively for side effects: DOM manipulation, logging, external system synchronization
- **`$props()`** with explicit destructuring for component properties; use `$bindable()` for two-way binding

### Shared State

Replace Svelte 4 stores with class-based patterns in `.svelte.ts` files. Export `$state` objects or class instances that work identically inside and outside components. Use getters with `$derived` for computed properties.

### Component-Scoped State

Use `setContext`/`getContext` to pass reactive objects through component subtrees without prop drilling. Avoid global state for server-side code (would be shared between requests).

---

## Data Loading Patterns

### Server vs Universal Load Functions

- **`+page.server.ts`**: Server-only load functions for database queries, secrets, cookies. Use for all Drizzle queries.
- **`+page.ts`**: Universal load functions that run on both server (SSR) and client (navigation). Use for public API calls and returning non-serializable data.

### Form Actions with Progressive Enhancement

Export `actions` from `+page.server.ts` for form handling. Use `use:enhance` from `$app/forms` for JavaScript-enhanced submissions that still work without JS. Use `fail()` for validation errors and `redirect()` for success redirects.

### Streaming Non-Essential Data

Return promises (not awaited) from server load functions to stream secondary data after initial page render. Use `{#await}` blocks in templates with loading states.

### Data Invalidation

Use `depends('custom:key')` in load functions and `invalidate('custom:key')` to trigger selective data reloading for non-fetch data sources.

---

## Component Patterns

### Props and Snippets

Use `$props()` with destructuring, `class: className` for reserved words, and rest props spreading. Replace `<slot>` with `{#snippet}` declarations and `{@render}` for typed content projection with parameters.

### Form Handling

Combine `sveltekit-superforms` for validation logic with Valibot schemas and shadcn-svelte Form components for accessible UI with proper ARIA attributes.

### Type Safety

Import `PageProps` from `./$types` (SvelteKit 2.16+) to type both `data` and `form` props. Use `satisfies` operator for configuration objects to validate structure while preserving literal types.

---

## *arr Application API Integration

### API Overview

All *arr applications share a common API architecture with v3 as the base version. The API uses REST conventions with JSON payloads and supports authentication via API key passed in the `X-Api-Key` header or as a query parameter `apikey`.

### API Version Support

**Sonarr**
- API version: v3 (applies to both Sonarr v3 and v4 applications)
- Base path: `/api/v3/`
- Some functionality is v4-only; detect via system status endpoint

**Radarr**
- API versions: v3, v4, v5
- Base path: `/api/v3/`
- Perform version auto-detection via system status endpoint

**Whisparr**
- API version: v3 (applies to Whisparr v2)
- Base path: `/api/v3/`
- Structure mirrors Sonarr API closely

### API Client Implementation

Wrap API calls in a typed client with consistent error handling and timeout configuration using `AbortSignal.timeout(30000)`. Return typed responses using generics. Handle rate limiting responses (HTTP 429) with backoff.

### Common Endpoints Across All Connectors

The following endpoints are available on all supported *arr applications:

**System & Health**
- `GET /api/v3/system/status` — Application version, database type, runtime info
- `GET /api/v3/health` — Health check results and warnings
- `GET /ping` — Simple availability check

**Commands (Triggering Actions)**
- `GET /api/v3/command` — List all commands (completed and in-progress)
- `POST /api/v3/command` — Execute a command (search, refresh, etc.)
- `GET /api/v3/command/{id}` — Get specific command status
- `DELETE /api/v3/command/{id}` — Cancel a command

Command resource includes: `id`, `name`, `commandName`, `status` (queued, started, completed, failed), `queued`, `started`, `ended`, `duration`, `trigger`, `message`.

**Quality Profiles**
- `GET /api/v3/qualityprofile` — List all quality profiles
- `GET /api/v3/qualityprofile/{id}` — Get specific profile

Quality profile includes: `id`, `name`, `upgradeAllowed`, `cutoff` (quality ID at which upgrades stop), `items` (quality items with allowed status), `minFormatScore`, `cutoffFormatScore`.

**Queue (Downloads in Progress)**
- `GET /api/v3/queue` — Paginated list of queue items
- `GET /api/v3/queue/status` — Queue summary (totalCount, errors, warnings)
- `GET /api/v3/queue/details` — Detailed queue for specific content
- `DELETE /api/v3/queue/{id}` — Remove item from queue
- `POST /api/v3/queue/grab/{id}` — Force grab a pending item

Queue supports pagination via `page`, `pageSize`, `sortKey`, `sortDirection` parameters.

**History**
- `GET /api/v3/history` — Paginated history of events
- `GET /api/v3/history/since` — History since specific date

History parameters include: `page`, `pageSize`, `sortKey`, `sortDirection`, `eventType`, `downloadId`.

**Tags**
- `GET /api/v3/tag` — List all tags
- `GET /api/v3/tag/detail` — Tags with usage counts

**Root Folders**
- `GET /api/v3/rootfolder` — List configured root folders with free space

**Indexers**
- `GET /api/v3/indexer` — List configured indexers

---

### Sonarr-Specific API

Sonarr manages TV series with hierarchical data: Series → Seasons → Episodes.

**Series Endpoints**
- `GET /api/v3/series` — List all series (supports `?tvdbId=` filter, `?includeSeasonImages=` option)
- `GET /api/v3/series/{id}` — Get specific series
- `POST /api/v3/series` — Add new series
- `PUT /api/v3/series/{id}` — Update series (supports `?moveFiles=` for path changes)
- `DELETE /api/v3/series/{id}` — Delete series (supports `?deleteFiles=`, `?addImportListExclusion=`)
- `GET /api/v3/series/lookup` — Search for series by term

**Series Resource Structure**
```
SeriesResource:
  id: integer
  title: string
  sortTitle: string
  status: SeriesStatusType (continuing, ended, upcoming, deleted)
  ended: boolean (read-only)
  overview: string
  network: string
  airTime: string
  images: MediaCover[]
  originalLanguage: Language
  seasons: SeasonResource[]
  year: integer
  path: string
  qualityProfileId: integer
  seasonFolder: boolean
  monitored: boolean
  monitorNewItems: NewItemMonitorTypes
  useSceneNumbering: boolean
  runtime: integer
  tvdbId: integer
  tvRageId: integer
  tvMazeId: integer
  tmdbId: integer
  imdbId: string
  firstAired: date-time
  lastAired: date-time
  seriesType: SeriesTypes (standard, daily, anime)
  cleanTitle: string
  titleSlug: string
  rootFolderPath: string
  certification: string
  genres: string[]
  tags: integer[]
  added: date-time
  ratings: Ratings
  statistics: SeriesStatisticsResource
```

**Season Resource Structure**
```
SeasonResource:
  seasonNumber: integer
  monitored: boolean
  statistics: SeasonStatisticsResource
  images: MediaCover[]

SeasonStatisticsResource:
  nextAiring: date-time
  previousAiring: date-time
  episodeFileCount: integer
  episodeCount: integer
  totalEpisodeCount: integer
  sizeOnDisk: integer (int64)
  releaseGroups: string[]
  percentOfEpisodes: number (read-only)
```

**Episode Endpoints**
- `GET /api/v3/episode` — List episodes with filters:
  - `?seriesId=` (required for listing)
  - `?seasonNumber=` (filter by season)
  - `?episodeIds=` (specific IDs)
  - `?episodeFileId=`
  - `?includeSeries=`, `?includeEpisodeFile=`, `?includeImages=`
- `GET /api/v3/episode/{id}` — Get specific episode
- `PUT /api/v3/episode/{id}` — Update episode (typically for monitored status)
- `PUT /api/v3/episode/monitor` — Bulk update monitored status

**Episode Resource Structure**
```
EpisodeResource:
  id: integer
  seriesId: integer
  tvdbId: integer
  episodeFileId: integer
  seasonNumber: integer
  episodeNumber: integer
  title: string
  airDate: string
  airDateUtc: date-time
  lastSearchTime: date-time
  runtime: integer
  finaleType: string
  overview: string
  episodeFile: EpisodeFileResource
  hasFile: boolean
  monitored: boolean
  absoluteEpisodeNumber: integer
  sceneAbsoluteEpisodeNumber: integer
  sceneEpisodeNumber: integer
  sceneSeasonNumber: integer
  unverifiedSceneNumbering: boolean
  endTime: date-time
  grabDate: date-time
  series: SeriesResource
  images: MediaCover[]
```

**Episode File Resource Structure**
```
EpisodeFileResource:
  id: integer
  seriesId: integer
  seasonNumber: integer
  relativePath: string
  path: string
  size: integer (int64)
  dateAdded: date-time
  sceneName: string
  releaseGroup: string
  languages: Language[]
  quality: QualityModel
  customFormats: CustomFormatResource[]
  customFormatScore: integer
  indexerFlags: integer
  releaseType: ReleaseType
  mediaInfo: MediaInfoResource
  qualityCutoffNotMet: boolean
```

**Episode File Endpoints**
- `GET /api/v3/episodefile` — List episode files (`?seriesId=`, `?episodeFileIds=`)
- `GET /api/v3/episodefile/{id}` — Get specific file
- `PUT /api/v3/episodefile/{id}` — Update file metadata
- `DELETE /api/v3/episodefile/{id}` — Delete file
- `PUT /api/v3/episodefile/bulk` — Bulk update
- `DELETE /api/v3/episodefile/bulk` — Bulk delete

**Wanted/Missing Endpoints**
- `GET /api/v3/wanted/missing` — Paginated list of missing episodes
  - Parameters: `page`, `pageSize`, `sortKey`, `sortDirection`, `monitored`
  - Options: `includeSeries`, `includeImages`, `includeEpisodeFile`
  - Returns: `EpisodeResourcePagingResource` with `totalRecords` and `records[]`
  
- `GET /api/v3/wanted/cutoff` — Episodes below quality cutoff (upgrade candidates)
  - Same parameters and structure as missing endpoint

**Release/Search Endpoints**
- `GET /api/v3/release` — Search releases for episode
  - Parameters: `seriesId`, `seasonNumber`, `episodeId`
- `POST /api/v3/release` — Grab a specific release
- `POST /api/v3/release/push` — Push release to download client

**Command Names for Sonarr**
- `SeriesSearch` — Search for all episodes in a series (body: `{ "seriesId": <id> }`)
- `SeasonSearch` — Search for all episodes in a season (body: `{ "seriesId": <id>, "seasonNumber": <num> }`)
- `EpisodeSearch` — Search for specific episodes (body: `{ "episodeIds": [<id>, ...] }`)
- `RefreshSeries` — Refresh series metadata
- `RescanSeries` — Rescan series files on disk
- `RssSync` — Trigger RSS feed sync
- `MissingEpisodeSearch` — Search all missing episodes
- `CutoffUnmetEpisodeSearch` — Search all episodes below cutoff

---

### Radarr-Specific API

Radarr manages movies as individual items with no hierarchical structure.

**Movie Endpoints**
- `GET /api/v3/movie` — List all movies
  - Parameters: `?tmdbId=`, `?excludeLocalCovers=`, `?languageId=`
- `GET /api/v3/movie/{id}` — Get specific movie
- `POST /api/v3/movie` — Add new movie
- `PUT /api/v3/movie/{id}` — Update movie (`?moveFiles=` for path changes)
- `DELETE /api/v3/movie/{id}` — Delete movie (`?deleteFiles=`, `?addImportExclusion=`)
- `PUT /api/v3/movie/editor` — Bulk update movies
- `DELETE /api/v3/movie/editor` — Bulk delete movies
- `GET /api/v3/movie/lookup` — Search by term
- `GET /api/v3/movie/lookup/tmdb` — Search by TMDb ID
- `GET /api/v3/movie/lookup/imdb` — Search by IMDb ID
- `POST /api/v3/movie/import` — Import movies

**Movie Resource Structure**
```
MovieResource:
  id: integer
  title: string
  originalTitle: string
  originalLanguage: Language
  alternateTitles: AlternativeTitleResource[]
  secondaryYear: integer
  sortTitle: string
  sizeOnDisk: integer (int64)
  status: MovieStatusType (tba, announced, inCinemas, released, deleted)
  overview: string
  inCinemas: date-time
  physicalRelease: date-time
  digitalRelease: date-time
  releaseDate: date-time
  physicalReleaseNote: string
  images: MediaCover[]
  website: string
  remotePoster: string
  year: integer
  youTubeTrailerId: string
  studio: string
  path: string
  qualityProfileId: integer
  hasFile: boolean
  movieFileId: integer
  monitored: boolean
  minimumAvailability: MovieStatusType
  isAvailable: boolean
  folderName: string
  runtime: integer
  cleanTitle: string
  imdbId: string
  tmdbId: integer
  titleSlug: string
  rootFolderPath: string
  certification: string
  genres: string[]
  tags: integer[]
  added: date-time
  addOptions: AddMovieOptions
  ratings: Ratings
  movieFile: MovieFileResource
  collection: MovieCollectionResource
  popularity: number (float)
  lastSearchTime: date-time
  statistics: MovieStatisticsResource
```

**Movie File Resource Structure**
```
MovieFileResource:
  id: integer
  movieId: integer
  relativePath: string
  path: string
  size: integer (int64)
  dateAdded: date-time
  sceneName: string
  releaseGroup: string
  edition: string
  languages: Language[]
  quality: QualityModel
  customFormats: CustomFormatResource[]
  customFormatScore: integer
  indexerFlags: integer
  mediaInfo: MediaInfoResource
  originalFilePath: string
  qualityCutoffNotMet: boolean
```

**Movie File Endpoints**
- `GET /api/v3/moviefile` — List files (`?movieId=[]`, `?movieFileIds=[]`)
- `GET /api/v3/moviefile/{id}` — Get specific file
- `PUT /api/v3/moviefile/{id}` — Update file metadata
- `DELETE /api/v3/moviefile/{id}` — Delete file
- `PUT /api/v3/moviefile/bulk` — Bulk update
- `DELETE /api/v3/moviefile/bulk` — Bulk delete

**Wanted/Missing Endpoints**
- `GET /api/v3/wanted/missing` — Paginated missing movies
  - Parameters: `page`, `pageSize`, `sortKey`, `sortDirection`, `monitored`
  - Returns: `MovieResourcePagingResource`
  
- `GET /api/v3/wanted/cutoff` — Movies below quality cutoff
  - Same parameters as missing

**Collection Endpoints**
- `GET /api/v3/collection` — List collections (`?tmdbId=`)
- `GET /api/v3/collection/{id}` — Get specific collection
- `PUT /api/v3/collection` — Update collection
- `PUT /api/v3/collection/{id}` — Update specific collection

**Release/Search Endpoints**
- `GET /api/v3/release` — Search releases (`?movieId=`)
- `POST /api/v3/release` — Grab release

**Command Names for Radarr**
- `MoviesSearch` — Search for specific movies (body: `{ "movieIds": [<id>, ...] }`)
- `RefreshMovie` — Refresh movie metadata
- `RescanMovie` — Rescan movie files
- `RssSync` — Trigger RSS sync
- `MissingMoviesSearch` — Search all missing movies
- `CutoffUnmetMoviesSearch` — Search movies below cutoff

---

### Whisparr-Specific API

Whisparr manages adult content in a structure similar to Sonarr with series/seasons/episodes.

**Series Endpoints**
- `GET /api/v3/series` — List all series
- `GET /api/v3/series/{id}` — Get specific series
- `POST /api/v3/series` — Add series
- `PUT /api/v3/series/{id}` — Update series
- `DELETE /api/v3/series/{id}` — Delete series
- `GET /api/v3/series/lookup` — Search for series

**Episode Endpoints**
- `GET /api/v3/episode` — List episodes (`?seriesId=`, `?seasonNumber=`, `?episodeIds=`, `?episodeFileId=`, `?includeImages=`)
- `GET /api/v3/episode/{id}` — Get episode
- `PUT /api/v3/episode/{id}` — Update episode
- `PUT /api/v3/episode/monitor` — Bulk update monitored

**Episode File Endpoints**
- `GET /api/v3/episodefile` — List files
- `GET /api/v3/episodefile/{id}` — Get file
- `PUT /api/v3/episodefile/{id}` — Update file
- `DELETE /api/v3/episodefile/{id}` — Delete file

**Wanted Endpoints**
- `GET /api/v3/wanted/missing` — Missing episodes
- `GET /api/v3/wanted/cutoff` — Episodes below cutoff

**Calendar Feed**
- `GET /feed/v3/calendar/whisparr.ics` — iCal feed

---

### Quality Model Structure

All *arr applications share a common quality model:

```
QualityModel:
  quality: Quality
  revision: Revision

Quality:
  id: integer
  name: string
  source: QualitySource
  resolution: integer

Revision:
  version: integer
  real: integer
  isRepack: boolean
```

The `qualityCutoffNotMet` boolean on file resources indicates whether an item is an upgrade candidate based on the quality profile's cutoff setting.

---

### Pagination Pattern

Paginated endpoints follow a consistent pattern:

**Request Parameters:**
- `page`: integer (1-indexed)
- `pageSize`: integer (default varies, typically 10-50)
- `sortKey`: string (field to sort by)
- `sortDirection`: 'ascending' | 'descending'

**Response Structure:**
```
{
  "page": integer,
  "pageSize": integer,
  "sortKey": string,
  "sortDirection": string,
  "totalRecords": integer,
  "records": []
}
```

For library sync, paginate in batches of 1000 items to handle large libraries efficiently.

---

### Command Execution Pattern

To trigger a search via the API:

1. **Send command**: `POST /api/v3/command` with appropriate body
2. **Track status**: Poll `GET /api/v3/command/{id}` for completion
3. **Command states**: `queued` → `started` → `completed` (or `failed`)

Command response includes:
- `id`: Track this command
- `status`: Current state
- `started`, `ended`: Timestamps
- `message`: Status or error message
- `result`: Success/failure indicator

---

## Database Architecture

### Design Philosophy

The database architecture separates two distinct concerns:

1. **Content Mirror**: What exists in the *arr applications and at what quality
2. **Search State**: What actions Comradarr has taken on items

This separation allows the content mirror to be rebuilt from *arr applications at any time while preserving Comradarr's operational state. It also means we only create search state records when we actually take action on an item, keeping the search state table lean for gap-only users while properly scaling for users who want full upgrade tracking.

### Drizzle Schema Design

Define all tables in `$lib/server/db/schema.ts`. Use `pgTable` with proper column types:

- `integer().primaryKey().generatedAlwaysAsIdentity()` for auto-incrementing primary keys
- `varchar()` with explicit length constraints
- `timestamp().defaultNow().notNull()` for created_at columns
- Proper foreign key relationships with `references()`

Derive TypeScript types from schema using `$inferSelect` and `$inferInsert` to maintain a single source of truth.

### Database Connection

Configure Bun's native PostgreSQL connection pool in `$lib/server/db/index.ts` with:
- Pool size of 10-25 connections for most applications
- `idleTimeout` for closing idle connections (30s recommended)
- `maxLifetime` for connection recycling (30min recommended)
- `connectionTimeout` for acquisition timeout

Use Drizzle's prepared statements via `.prepare()` for frequently executed queries to skip query planning overhead.

### Content Mirror Tables

**connectors**
Stores configured *arr application connections including URL, API key (encrypted), connector type, display name, enabled status, and instance-specific settings. Tracks last successful connection time and health status.

**series**
For Sonarr and Whisparr connectors. Stores series-level metadata including external identifiers (tvdbId, imdbId, tmdbId), title, status (continuing, ended, upcoming), total season count, series type (standard, daily, anime), and quality profile reference. Links to connector.

**seasons**
For Sonarr and Whisparr connectors. Stores season-level aggregates including season number, total episode count, monitored status, and statistics (episodes downloaded, episodes missing, percent complete). Links to series.

**episodes**
For Sonarr and Whisparr connectors. Stores episode-level data including season and episode numbers, title, air date (airDateUtc), monitored status, hasFile boolean, current quality (null if missing), qualityCutoffNotMet flag, episodeFileId, and lastSearchTime. Links to season.

**movies**
For Radarr connectors. Stores movie data including external identifiers (tmdbId, imdbId), title, year, status, monitored status, hasFile boolean, movieFileId, current quality (null if missing), qualityCutoffNotMet flag, minimumAvailability, isAvailable, and lastSearchTime. Links to connector.

**sync_state**
Tracks synchronization status per connector including last sync timestamp, last full reconciliation timestamp, sync cursor for incremental updates, and sync health metrics.

### Search State Tables

**search_registry**
Core tracking table for all search operations. Contains:
- Reference to content item (polymorphic: episode_id or movie_id)
- Connector reference for efficient querying
- Search type enumeration (gap or upgrade)
- Current state enumeration (pending, queued, searching, cooldown, failed, exhausted)
- Search attempt counter
- Last searched timestamp
- Next eligible search timestamp (calculated based on cooldown rules)
- Failure category (null, no_results, indexer_error, rate_limited, timeout)
- Priority score (calculated)
- Created timestamp

**request_queue**
Active queue of pending search requests. Contains:
- Reference to search registry entries (one-to-many for batched searches)
- Batch identifier for grouped searches
- Priority score
- Created timestamp
- Scheduled dispatch timestamp
- Connector reference
- Search parameters (series/season context for batch optimization)

**search_history**
Append-only log of completed search operations for analytics. Contains:
- Snapshot of relevant data at search time
- Outcome enumeration (success, no_results, error)
- Response metadata (items found, time taken)
- Timestamp

### Index Strategy

Essential indexes for performance at scale:

**Content mirror indexes:**
- episodes: (connector_id, has_file) for gap queries (has_file = false)
- episodes: (connector_id, quality_cutoff_not_met) for upgrade queries  
- episodes: (series_id, season_number) for batch grouping
- movies: (connector_id, has_file) for gap queries
- movies: (connector_id, quality_cutoff_not_met) for upgrade queries

**Search state indexes:**
- search_registry: (content_type, content_id) for lookups
- search_registry: (state, next_eligible_at) for queue processing
- search_registry: (connector_id, search_type, state) for sweep filtering
- search_registry: (state, updated_at) for pruning queries
- request_queue: (scheduled_dispatch_at, priority) for queue ordering

### Data Lifecycle

**Content mirror lifecycle:**
- Created during sync from *arr application
- Updated on subsequent syncs when *arr data changes (check hasFile, quality, monitored changes)
- Deleted when item removed from *arr application (cascade deletes search state)

**Search state lifecycle:**
- Created when item first qualifies for search and is selected by discovery module
- Updated after each search attempt with new state and timestamps
- State transitions: pending → queued → searching → cooldown → (repeat or exhausted)
- Removed when search succeeds (hasFile becomes true or qualityCutoffNotMet becomes false)
- Removed when content mirror item deleted
- Pruned when exhausted and older than retention threshold

### Pruning Strategy

To prevent unbounded growth of the search state table:

**Automatic removal on success:**
- When gap search succeeds and hasFile becomes true in content mirror, delete search registry entry
- When upgrade search succeeds and qualityCutoffNotMet becomes false, delete search registry entry

**Exhausted record pruning:**
- After configurable maximum attempts (default 10), mark state as exhausted
- Exhausted records older than configurable threshold (default 30 days) are pruned
- Pruning runs as scheduled maintenance task

**Orphan cleanup:**
- If content mirror item is deleted (series removed from *arr), cascade delete search state
- Periodic orphan scan catches any missed cascades

**History retention:**
- Search history pruned to configurable retention period (default 30 days)
- Aggregated statistics preserved separately for long-term analytics

### Migrations

Use Drizzle Kit for migrations:
- `bunx drizzle-kit generate` — Generate migrations from schema changes
- `bunx drizzle-kit migrate` — Apply pending migrations
- `bunx drizzle-kit push` — Push schema directly (dev only)
- `bunx drizzle-kit studio` — Open database GUI

Configure in `drizzle.config.ts` with `prefix: 'timestamp'` for ordered migrations.

---

## Synchronization Strategy

### Incremental Sync

Runs frequently (default every 15 minutes):

1. Query *arr application for series/movies list
2. For Sonarr/Whisparr: Fetch episodes for series with recent activity using `GET /api/v3/episode?seriesId=`
3. For Radarr: Compare movie list with local mirror
4. Use pagination (pageSize=1000) for large libraries
5. Upsert items into content mirror tables
6. Update hasFile, quality, qualityCutoffNotMet status from API responses
7. Update sync_state with new timestamp
8. Trigger discovery module for newly missing items (hasFile changed to false)

### Full Reconciliation

Runs periodically (default daily) or on-demand:

1. Fetch complete library from *arr application:
   - Sonarr/Whisparr: `GET /api/v3/series` then `GET /api/v3/episode?seriesId=` for each
   - Radarr: `GET /api/v3/movie`
2. Compare against content mirror to identify:
   - New items to insert
   - Changed items to update (hasFile, quality, monitored)
   - Removed items to delete (with cascade to search state)
3. Rebuild aggregate statistics (season episode counts using SeasonStatisticsResource)
4. Mark reconciliation timestamp in sync_state
5. Log reconciliation summary

### Using Wanted Endpoints for Gap Detection

As an optimization, use the built-in wanted endpoints:

**For missing content:**
```
GET /api/v3/wanted/missing?page=1&pageSize=1000&monitored=true
```
Returns paginated list of all missing monitored items with totalRecords for progress tracking.

**For upgrade candidates:**
```
GET /api/v3/wanted/cutoff?page=1&pageSize=1000&monitored=true
```
Returns items where qualityCutoffNotMet is true.

These endpoints provide efficient gap detection without needing to fetch and analyze the entire library.

### Sync Failure Handling

- Retry with exponential backoff on transient failures
- Track consecutive failure count per connector
- Mark connector unhealthy after threshold failures
- Notify user of sync issues
- Continue other connector syncs independently

---

## Episode Search Batching Logic

### The Problem

Searching for individual episodes is inefficient and strains indexers. Season packs are more efficient but inappropriate when only a few episodes are missing. The batching logic must make intelligent decisions.

### Season Analysis

When processing gaps for a series, analyze at season level using SeasonStatisticsResource:

**Calculate season completeness:**
- Total episodes: `totalEpisodeCount`
- Downloaded: `episodeFileCount`
- Missing: `totalEpisodeCount - episodeFileCount`
- Percent complete: `percentOfEpisodes`

**Determine season status:**
- Fully aired: `nextAiring` is null
- Currently airing: `nextAiring` is set
- Upcoming: All episodes have future air dates

### Batching Decision Tree

**Season pack search** when all conditions met:
- Season is fully aired (nextAiring is null)
- Missing percentage exceeds threshold (default 50%)
- Season pack searching enabled for connector
- No recent season pack search in cooldown

**Individual episode search** when any condition met:
- Season is currently airing (nextAiring is set)
- Missing percentage below threshold
- Fewer than configurable count missing (default 3)
- Season pack searching disabled
- Previous season pack search failed

**Hybrid approach:**
- First attempt season pack for heavily incomplete seasons
- After season pack cooldown, search remaining individual episodes
- Track both search types separately in search registry

### Configurable Thresholds

Per connector settings:
- Enable/disable season pack searching
- Season pack threshold percentage (default 50%)
- Maximum individual episodes before forcing season pack (default 5)
- Season pack cooldown period (default 7 days)
- Individual episode cooldown period (default 24 hours)

### Batch Formation for Queue

When adding to request queue:
- Group individual episode searches by series for sequential processing
- Limit concurrent searches per series to avoid *arr command queue overload
- Respect throttle profile batch sizes
- Calculate batch priority from highest priority item in batch

### Command Construction

**Season search command:**
```json
POST /api/v3/command
{
  "name": "SeasonSearch",
  "seriesId": 123,
  "seasonNumber": 2
}
```

**Episode search command (batched):**
```json
POST /api/v3/command
{
  "name": "EpisodeSearch",
  "episodeIds": [456, 457, 458]
}
```

**Movie search command:**
```json
POST /api/v3/command
{
  "name": "MoviesSearch",
  "movieIds": [789]
}
```

---

## Queue Processing Logic

### Priority Calculation

Search priority considers multiple factors with configurable weights:

**Content age factor:**
- Newer content (airDateUtc/releaseDate recently passed) scored higher
- Rationale: More likely to be available on indexers

**Missing duration factor:**
- Items missing longer scored lower
- Use lastSearchTime to track search history
- Rationale: If not found yet, probably harder to find

**User priority override:**
- Manual priority boost/reduction per item or series
- Allows user to prioritize specific content

**Failure penalty:**
- Each failed attempt reduces priority
- Prevents hammering indexers for unavailable content

**Search type factor:**
- Gaps scored higher than upgrades by default
- Configurable per connector

**Series priority inheritance:**
- Episodes inherit base priority from series
- Allows prioritizing entire shows

### Queue Processing Cycle

1. Check throttle profile allowances (requests remaining, cooldown status)
2. Query request queue for eligible items (scheduled_dispatch_at <= now)
3. Group by connector for efficient processing
4. For each connector within limits:
   - Dequeue highest priority batch
   - Update search registry state to "searching"
   - Send search command to *arr application via POST /api/v3/command
   - Poll GET /api/v3/command/{id} for completion (status: completed/failed)
   - Update search registry with outcome
   - Calculate next eligible time based on outcome
   - Log to search history
5. Sleep until next processing cycle

### Failure Handling

**No results:**
- Increment attempt counter
- Set state to cooldown
- Calculate extended cooldown (exponential backoff)
- After max attempts, set state to exhausted

**Indexer error:**
- Track error type from command message
- Shorter cooldown than no results
- Notify if persistent

**Rate limited:**
- Pause all searches for affected connector
- Extended cooldown for specific item
- Adjust throttle profile dynamically

**Timeout:**
- Treat as transient failure
- Standard cooldown
- Track timeout frequency for connector health

---

## Connector Implementation Details

### Supported Applications

**Sonarr Connector**
Handles television series. Must support v3 and v4 APIs with version auto-detection via `GET /api/v3/system/status`. Content mirror includes series, seasons, and episodes tables. Implements episode-level tracking with season-aware batching using SeasonSearch and EpisodeSearch commands.

**Radarr Connector**
Handles movies. Must support v3, v4, and v5 APIs with version auto-detection. Content mirror uses movies table. Simpler gap detection as movies are single items. Uses MoviesSearch command.

**Whisparr Connector**
Handles adult content. Structure mirrors Sonarr with series/seasons/episodes. Same command patterns as Sonarr.

### API Version Detection

On connector creation and periodically:
```
GET /api/v3/system/status
```
Response includes:
- `version`: Application version string
- `appName`: "Sonarr", "Radarr", or "Whisparr"
- `branch`: Release branch
- `authentication`: Auth type enabled
- `startTime`: For uptime tracking

Store detected version with connector. Use version-appropriate features. Warn user if version unsupported.

### Connection Health Monitoring

Each connector maintains health metrics tracked via:
- `GET /ping` - Simple availability (200 OK)
- `GET /api/v3/health` - Application health issues

Health status levels:
- Healthy: Normal operation
- Degraded: Health warnings present, elevated errors
- Unhealthy: Repeated failures, authentication issues
- Offline: Cannot connect

Unhealthy connectors:
- Pause sweep cycles
- Continue health check attempts
- Notify user
- Auto-resume when healthy

### API Communication Patterns

All *arr communication should:
- Use connection pooling for efficiency
- Implement request timeouts (configurable, default 30 seconds via `AbortSignal.timeout()`)
- Handle rate limiting responses (HTTP 429) with backoff
- Log requests and responses at debug level
- Support optional SSL certificate verification bypass for self-signed certificates
- Include User-Agent header identifying Comradarr and version
- Include X-Api-Key header for authentication

---

## User Interface Design

### Layout Structure

The interface uses a sidebar navigation layout with the main content area adapting to the selected section. The sidebar should be collapsible on smaller screens. Support dark and light themes with system preference detection.

Use shadcn-svelte components integrated via `unocss-preset-shadcn`. Define UnoCSS shortcuts for repeated utility combinations.

### Dashboard View

The dashboard provides an at-a-glance overview:

**Connection status panel:**
- Health indicators for all configured connectors
- Quick actions for unhealthy connectors
- Last sync time per connector

**Statistics cards:**
- Total content gaps across all connectors (from wanted/missing endpoints)
- Total upgrade candidates (from wanted/cutoff endpoints)
- Items currently in queue
- Searches completed today
- Success rate trending

**Activity feed:**
- Recent discoveries
- Recent search outcomes
- System events

**Library completion visualization:**
- Per-connector completion percentage
- Breakdown by content type (movies, series, etc.)
- Trend over time (sparkline)

**Upcoming schedule:**
- Next scheduled sweeps
- Current sweep progress if running

### Connectors View

**Connector list:**
- Card or table layout (user preference)
- Status indicator, name, type, URL
- Quick stats (gaps, queue depth, success rate)
- Enable/disable toggle
- Quick actions (sync now, test connection, edit, delete)

**Add connector flow:**
- Select connector type (Sonarr, Radarr, Whisparr)
- Enter URL and API key
- Test connection with validation via GET /ping and GET /api/v3/system/status
- Configure instance name and settings
- Initial sync option

**Connector detail view:**
- Full configuration editing
- Connection health history (from /api/v3/health)
- Sync history and status
- Per-connector statistics
- Associated sweep schedules

### Content View

**Unified content browser:**
- Filterable by connector, content type, status
- Status filters: all, missing only (hasFile=false), upgrade candidates (qualityCutoffNotMet=true), queued, searching, exhausted
- Search by title
- Sortable columns

**Series/movie detail:**
- Metadata from *arr application
- Current quality status (from QualityModel)
- Gap and upgrade status per episode (for series)
- Search history for this item (lastSearchTime)
- Manual actions (queue search, adjust priority, mark exhausted)

**Bulk actions:**
- Select multiple items
- Queue selected for search
- Adjust priority
- Mark as exhausted
- Clear search state (re-evaluate)

### Queue View

**Active queue display:**
- Real-time updates
- Priority-sorted list
- Estimated dispatch time
- Current processing indicator (show command status)

**Queue management:**
- Manual priority adjustment
- Remove from queue
- Pause/resume queue processing
- Clear entire queue

**Recent completions:**
- Last N completed searches
- Outcome indicators (from command result)
- Link to content detail

### Schedules View

**Schedule list:**
- All configured sweep schedules
- Associated connector
- Cron expression with human-readable description
- Next run time
- Enable/disable toggle

**Schedule editor:**
- Connector selection
- Sweep type (gaps, upgrades, both)
- Cron expression with builder UI for non-technical users
- Throttle profile selection
- Batch size limits

**Timeline visualization:**
- Calendar or timeline view of upcoming sweeps
- Helps identify schedule conflicts or gaps

### Analytics View

**Time-series charts:**
- Gap discovery rate over time
- Search volume and success rate
- Queue depth trending
- Library completion progress

**Connector comparison:**
- Success rates by connector
- Response times by connector
- Error rates by connector

**Content analysis:**
- Most searched items
- Hardest to find content (high attempt count)
- Quality distribution

**Export options:**
- CSV export of statistics
- Date range selection

### Settings View

**General settings:**
- Application display name
- Timezone selection
- Update check preference
- Log verbosity level

**Throttle profiles:**
- List of profiles with presets (conservative, moderate, aggressive)
- Create custom profiles
- Configure: requests per minute, batch size, cooldown periods, daily budget, backoff multipliers

**Notifications:**
- Enable/disable master toggle
- Channel configuration (add Discord, Telegram, etc.)
- Per-channel event filtering
- Test notification button
- Quiet hours configuration
- Message template customization

**Search behavior:**
- Default priority weights
- Season pack thresholds
- Cooldown periods
- Maximum retry attempts
- Exhausted item retention

**Security:**
- Authentication mode (full, local bypass, disabled)
- Change password
- Session management
- API key management for external access

**Database:**
- Connection status
- Database size statistics
- Manual maintenance actions (vacuum, prune)
- Backup/restore functionality

**About:**
- Version information
- Update availability
- Links to documentation and repository

---

## Notification System Design

### Event Types

**Sweep events:**
- Sweep started
- Sweep completed with summary (gaps found, items queued)

**Search events:**
- Batch search completed
- Search success (content grabbed - command completed successfully)
- Search exhausted (max retries reached)

**Connector events:**
- Connector health changed (from /api/v3/health)
- Sync completed
- Sync failed

**System events:**
- Application started
- Update available
- Database maintenance completed
- Error threshold exceeded

### Channel Configuration

Each notification channel supports:
- Event type selection (which events trigger notifications)
- Minimum severity level
- Connector filtering (only events from specific connectors)
- Batching window (combine events within time window)
- Quiet hours (suppress notifications during specified times)
- Rate limiting (maximum notifications per hour)

### Message Templating

Customizable templates with placeholders:
- {content_title} - Title of movie/series/episode
- {content_year} - Year of release
- {connector_name} - Name of connector
- {connector_type} - Type of connector (Sonarr, Radarr, Whisparr)
- {event_type} - Type of event
- {timestamp} - Event timestamp
- {statistics} - Relevant statistics block
- {url} - Link to content in Comradarr

### Notification Batching

To prevent notification spam:
- Configurable batching window (default 5 minutes)
- Combine similar events into digest
- Summary format: "Found 15 missing episodes across 3 series"
- Individual details available in Comradarr UI

---

## Security Considerations

### Authentication Implementation

Implement authentication in `hooks.server.ts` using the `handle` hook. Validate sessions and populate `event.locals` with user data. Declare the `Locals` interface in `app.d.ts`.

### Authentication Modes

**Full authentication:**
- Username and password required for all access
- Session-based with configurable timeout
- Secure password hashing (Argon2)
- Account lockout after failed attempts

**Local network bypass:**
- Authentication required only for non-RFC1918 addresses
- Local networks (10.x.x.x, 172.16.x.x-172.31.x.x, 192.168.x.x) bypass authentication
- Useful for home network deployments

**Disabled authentication:**
- No authentication required
- Prominent warning about security implications
- Intended only for reverse proxy setups with external authentication

### API Key Authentication

For external integrations:
- Generate API keys with optional descriptions
- Keys can be scoped to read-only or full access
- Individual key revocation
- Key usage logging
- Rate limiting per key

### Secrets Management

Sensitive data handling:
- *arr API keys encrypted at rest using application secret
- Notification credentials encrypted at rest
- Secrets never logged
- Secrets masked in UI (show last 4 characters only)
- Secure secret rotation support

### SQL Injection Prevention

Rely on Drizzle's automatic parameterization. Use the query builder or `sql` template literal—never string concatenation for dynamic values. Never use `sql.raw()` with user input.

### Network Security

- All external API calls use HTTPS by default
- Configurable SSL certificate verification (disable for self-signed)
- No sensitive data in URL parameters (use X-Api-Key header)
- CSRF protection on all forms (handled by SvelteKit)

### Security Headers

Configure security headers in `hooks.server.ts`:
- X-Frame-Options: SAMEORIGIN
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- Strict-Transport-Security (production only)

---

## Configuration Management

### Environment Variables

Required:
- DATABASE_URL: PostgreSQL connection string

Optional with defaults:
- HOST: Listen address (default 0.0.0.0)
- PORT: Listen port (default 3000)
- BASE_URL: Base URL path for reverse proxy (default /)
- TZ: Timezone (default UTC)
- LOG_LEVEL: Logging verbosity (default info)
- SECRET_KEY: Encryption key for secrets (generated if not provided)
- ADMIN_USER: Initial admin username (default admin)
- ADMIN_PASS: Initial admin password (required on first run if auth enabled)

### Configuration Persistence

- User-configured settings stored in database
- Environment variables take precedence for deployment settings
- Settings changes take effect immediately (except HOST, PORT, DATABASE_URL)
- Configuration export/import for backup and migration

### Docker Deployment

**Multi-stage Dockerfile:**
- Base stage with `oven/bun:1-alpine`
- Dependencies stage with BuildKit cache mounts for `~/.bun/install/cache`
- Build stage with `NODE_ENV=production` and `bun run build`
- Production stage with non-root user (`USER bun`), copying built output

**Single container with external PostgreSQL:**
- Mount volume for any local data (logs if file-based)
- Provide DATABASE_URL environment variable
- Optionally provide SECRET_KEY for consistent encryption across restarts

**Single container with embedded PostgreSQL:**
- Mount volume for PostgreSQL data directory
- Comradarr manages embedded PostgreSQL lifecycle
- Suitable for simple deployments

**Docker Compose configuration:**
- `depends_on` with `condition: service_healthy` for database
- Health check using `pg_isready`
- Docker secrets for database passwords
- Named volumes for PostgreSQL data

---

## Performance Considerations

### Database Performance

- Connection pooling with configurable pool size (10-25 connections)
- Prepared statements for repeated queries using Drizzle's `.prepare()`
- Appropriate indexes on all query patterns (see Database Architecture section)
- Query timeout configuration
- Slow query logging at debug level
- Periodic VACUUM and ANALYZE maintenance

### Memory Management

- Stream large API responses using async iterators
- Paginate all *arr API requests (1000 items per page)
- Paginate database queries for large result sets
- Limit in-memory queue size with database persistence
- Use `$state.raw()` for large datasets where deep proxy overhead matters

### Concurrent Operations

- Non-blocking async operations throughout
- Limit concurrent *arr API requests per connector
- Limit concurrent database connections
- Queue processing runs independently of web server
- Sweep cycles can run concurrently for different connectors

### Scaling Guidance

For libraries under 50,000 items:
- Default configuration sufficient
- 512MB RAM recommended

For libraries 50,000-500,000 items:
- Increase database connection pool
- Consider dedicated PostgreSQL instance
- 1GB RAM recommended

For libraries over 500,000 items:
- Dedicated PostgreSQL with tuned configuration
- Increase sync and processing batch sizes
- 2GB+ RAM recommended
- Consider multiple Comradarr instances per connector type

---

## Logging and Debugging

### Log Levels

- **Error**: Failures requiring attention
- **Warn**: Recoverable issues and degraded operation
- **Info**: Normal operation milestones (sweep completed, searches dispatched)
- **Debug**: Detailed operation tracing (API calls, queue decisions)
- **Trace**: Full request/response bodies

### Log Structure

Structured JSON logging for machine parsing:
- timestamp
- level
- module
- message
- correlation_id (for tracing operations)
- additional context fields

Console output option with human-readable formatting for development.

### Correlation IDs

- Generate unique ID for each incoming request
- Propagate through all related operations
- Include in logs and error responses
- Enables tracing a single operation across modules

### Log Management

- Configurable output (stdout, file, both)
- Log rotation if file-based
- Retention configuration
- Log level changeable at runtime without restart

---

## Deployment Requirements

### Docker Container

Container configuration:
- Multi-stage build for minimal image size using `oven/bun:1-alpine`
- Non-root user execution (`USER bun`)
- Health check endpoint (/health)
- Graceful shutdown handling (complete in-progress operations)
- Signal handling for configuration reload (SIGHUP)
- BuildKit cache mounts for faster rebuilds

Volume mounts:
- /data for embedded PostgreSQL (if used)
- /config for optional configuration file

### Health Check Endpoint

Returns:
- Application status
- Database connection status
- Per-connector health summary (aggregated from /api/v3/health calls)
- Queue status
- Memory usage

### Resource Requirements

Minimum:
- 256MB RAM
- 1 CPU core
- 1GB storage for database

Recommended:
- 512MB RAM
- 2 CPU cores
- 5GB storage for database (scales with library size)

### Backup and Restore

**Backup includes:**
- All database tables
- Encrypted secrets (require same SECRET_KEY to restore)

**Backup methods:**
- Manual trigger from UI
- Scheduled automatic backups
- PostgreSQL-native backup tools

**Restore process:**
- Validate backup integrity
- Optional selective restore (configuration only, or full)
- Automatic migration if backup from older version

---

## Testing Strategy

### Unit Tests

Use Vitest for unit tests of business logic, utilities, and pure functions. Configure separate test projects for client and server code.

### Component Tests

Use Vitest with `@vitest/browser-playwright` for component tests in real browser environments rather than jsdom. Use `@testing-library/svelte` for Svelte-specific testing utilities.

### E2E Tests

Configure Playwright with SvelteKit's `build && preview` command for production-like end-to-end tests. Use `reuseExistingServer: !process.env.CI` for development efficiency.

### Type Checking

Run `svelte-check` in CI pipelines to catch type errors across `.svelte` files (TypeScript's `tsc` doesn't check Svelte files).

---

## Future Extension Points

Design the architecture to accommodate future enhancements without major refactoring:

- Additional *arr application support (Lidarr for music, Readarr for books)
- Prowlarr integration for indexer-aware search decisions
- Multi-user support with per-user permissions and connectors
- Remote instance federation (multiple Comradarr instances sharing state)
- Public REST API for third-party integrations
- GraphQL API option
- Plugin system for custom discovery logic or notification channels
- Mobile companion app via API (PWA)
- Prometheus metrics endpoint for monitoring integration

---

## Development Guidelines

### Code Organization

Maintain clear separation following SvelteKit conventions:
- Routes (SvelteKit routes for pages and API endpoints)
- Services (business logic in `$lib/server/`, stateless where possible)
- Repositories (database access via Drizzle in `$lib/server/db/`)
- Clients (external API communication in `$lib/server/connectors/`)
- Types (shared type definitions, inferred from Drizzle schema where possible)
- Utils (pure utility functions in `$lib/utils/`)

### Svelte 5 Patterns

- Use `$props()` with destructuring, never `export let`
- Use `$state()` for reactive state, `$derived()` for computed values
- Use `$effect()` only for side effects (DOM, logging, external sync)
- Use `{#snippet}` and `{@render}` instead of `<slot>`
- Use callback props instead of `createEventDispatcher`
- Place shared state in `.svelte.ts` files with exported classes or objects

### Error Handling

Implement consistent error handling:
- Typed error classes for different failure modes
- User-friendly error messages separate from technical details
- Proper error propagation through async boundaries
- Global error boundary in UI with recovery options
- Use `fail()` in form actions for validation errors
- API endpoints return consistent error response format

### Code Quality

- Strict TypeScript configuration extending SvelteKit's generated config
- Consistent formatting (Prettier or Biome)
- Linting with ESLint and Svelte-specific rules
- Pre-commit hooks for formatting and linting
- Conventional commits for changelog generation
- Run `svelte-check` in CI
