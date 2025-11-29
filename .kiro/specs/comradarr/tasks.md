# Implementation Plan

## Phase 1: Project Foundation

- [ ] 1. Initialize SvelteKit project with Bun
  - [x] 1.1 Create SvelteKit project with TypeScript
    - Run `bun create svelte@latest comradarr` with TypeScript option
    - Configure svelte-adapter-bun in svelte.config.js
    - Set up strict TypeScript configuration in tsconfig.json
    - _Requirements: 30.1, 30.2_

  - [x] 1.2 Configure UnoCSS and shadcn-svelte
    - Install UnoCSS with presetWind, presetAnimations, presetShadcn
    - Configure uno.config.ts with shortcuts for buttons, cards, status indicators
    - Initialize shadcn-svelte components
    - _Requirements: 22.1, 22.4_

  - [x] 1.3 Set up Drizzle ORM and database schema
    - Install drizzle-orm and drizzle-kit
    - Create drizzle.config.ts with timestamp prefix migrations
    - Create database client in $lib/server/db/index.ts with Bun native SQL driver
    - _Requirements: 13.4, 14.1, 14.2, 14.3_

  - [ ] 1.4 Create core database schema
    - Define connectors table with encrypted API key field
    - Define series, seasons, episodes tables for Sonarr/Whisparr
    - Define movies table for Radarr
    - Define search_registry, request_queue, search_history tables
    - Define sync_state table
    - Create indexes for efficient queries
    - _Requirements: 14.1, 14.2, 14.3_

  - [ ] 1.5 Implement quality model serialization
    - Create QualityModel TypeScript interface
    - Implement serializeQuality and deserializeQuality functions
    - _Requirements: 14.4, 14.5_

  - [ ] 1.6 Write property test for quality model round trip
    - **Property 1: Quality Model Round Trip**
    - **Validates: Requirements 14.4, 14.5**

- [ ] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 2: Authentication and Security

- [ ] 3. Implement authentication system
  - [ ] 3.1 Create auth schema and session management
    - Define users and sessions tables
    - Implement session creation and validation
    - Configure Argon2id password hashing
    - _Requirements: 10.1, 10.2_

  - [ ] 3.2 Implement hooks.server.ts authentication
    - Create handle hook for session validation
    - Populate event.locals.user
    - Add security headers (X-Frame-Options, X-Content-Type-Options, etc.)
    - _Requirements: 10.4, 10.5_

  - [ ] 3.3 Create login/logout routes
    - Create (auth) route group with login page
    - Implement login form action with validation
    - Implement logout action
    - _Requirements: 10.1, 10.2_

  - [ ] 3.4 Implement route protection
    - Create (app) route group layout with auth guard
    - Redirect unauthenticated users to login
    - _Requirements: 10.4_

  - [ ] 3.5 Implement account lockout
    - Track failed login attempts
    - Lock account after threshold failures
    - Reset counter on successful login
    - _Requirements: 35.1, 35.2, 35.3, 35.4, 35.5_

  - [ ] 3.6 Implement API key encryption
    - Create encrypt/decrypt functions using AES-256-GCM
    - Integrate with connector storage
    - _Requirements: 1.1, 36.1_

  - [ ] 3.7 Write property test for connector data persistence
    - **Property 20: Connector Data Persistence**
    - **Validates: Requirements 1.1**

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 3: *arr API Client Infrastructure

- [ ] 5. Build base API client
  - [ ] 5.1 Create base client with authentication and timeout
    - Implement BaseArrClient class with X-Api-Key header
    - Configure AbortSignal.timeout (default 30s)
    - Add User-Agent header
    - _Requirements: 23.1, 23.2_

  - [ ] 5.2 Implement error handling and categorization
    - Create typed error classes (NetworkError, AuthenticationError, RateLimitError, ServerError)
    - Categorize errors by HTTP status code
    - _Requirements: 23.3, 23.4, 28.1, 28.2, 28.3, 28.4, 28.5, 28.6_

  - [ ] 5.3 Implement retry logic with exponential backoff
    - Create withRetry wrapper function
    - Configure base delay, max delay, backoff multiplier
    - Skip retry for non-retryable errors
    - _Requirements: 23.5_

  - [ ] 5.4 Write property test for exponential backoff calculation
    - **Property 7: Exponential Backoff Calculation**
    - **Validates: Requirements 5.5**

- [ ] 6. Implement API response parsing
  - [ ] 6.1 Create response parsers for common types
    - Implement pagination response parser
    - Implement quality model parser
    - Implement command response parser
    - _Requirements: 27.1, 27.5, 27.6_

  - [ ] 6.2 Create Sonarr-specific parsers
    - Implement series response parser
    - Implement episode response parser
    - _Requirements: 27.2, 27.3_

  - [ ] 6.3 Create Radarr-specific parsers
    - Implement movie response parser
    - _Requirements: 27.4_

  - [ ] 6.4 Implement parser robustness
    - Ignore unknown fields in responses
    - Skip malformed records with warning
    - _Requirements: 27.7, 27.8_

  - [ ] 6.5 Write property test for API response parsing
    - **Property 13: API Response Parsing Completeness**
    - **Property 14: Parser Robustness to Extra Fields**
    - **Property 15: Parser Graceful Degradation**
    - **Validates: Requirements 27.1-27.8**

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 4: Connector Implementations

- [ ] 8. Implement Sonarr connector
  - [ ] 8.1 Create Sonarr client extending base client
    - Implement ping and getSystemStatus methods
    - Implement getHealth method
    - _Requirements: 1.2, 1.3, 1.4, 24.1_

  - [ ] 8.2 Implement library data methods
    - Implement getSeries with pagination
    - Implement getEpisodes for a series
    - _Requirements: 24.1, 24.2_

  - [ ] 8.3 Implement wanted endpoints
    - Implement getWantedMissing with pagination
    - Implement getWantedCutoff with pagination
    - _Requirements: 24.3, 24.4_

  - [ ] 8.4 Implement search commands
    - Implement sendEpisodeSearch command
    - Implement sendSeasonSearch command
    - Implement getCommandStatus polling
    - _Requirements: 24.5, 24.6, 24.7_

- [ ] 9. Implement Radarr connector
  - [ ] 9.1 Create Radarr client extending base client
    - Implement ping, getSystemStatus, getHealth methods
    - Implement API version detection
    - _Requirements: 25.6_

  - [ ] 9.2 Implement library data methods
    - Implement getMovies with pagination
    - _Requirements: 25.1_

  - [ ] 9.3 Implement wanted endpoints
    - Implement getWantedMissing with pagination
    - Implement getWantedCutoff with pagination
    - _Requirements: 25.2, 25.3_

  - [ ] 9.4 Implement search commands
    - Implement sendMoviesSearch command
    - Implement getCommandStatus polling
    - _Requirements: 25.4, 25.5_

- [ ] 10. Implement Whisparr connector
  - [ ] 10.1 Create Whisparr client extending base client
    - Implement ping, getSystemStatus, getHealth methods
    - _Requirements: 26.1_

  - [ ] 10.2 Implement library and wanted methods
    - Implement getSeries, getEpisodes
    - Implement getWantedMissing, getWantedCutoff
    - _Requirements: 26.2, 26.3, 26.4_

  - [ ] 10.3 Implement search commands
    - Implement sendEpisodeSearch, sendSeasonSearch
    - _Requirements: 26.5_

- [ ] 11. Implement pagination utilities
  - [ ] 11.1 Create async iterator for paginated responses
    - Implement fetchAllPages generator function
    - Continue until page * pageSize >= totalRecords
    - _Requirements: 29.1, 29.2_

  - [ ] 11.2 Write property test for pagination completeness
    - **Property 16: Pagination Completeness**
    - **Validates: Requirements 29.2**

- [ ] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 5: Connector Management UI

- [ ] 13. Create connector management pages
  - [ ] 13.1 Create connector list page
    - Display connectors with status indicator, name, type, URL
    - Show quick stats (gaps, queue depth)
    - Add enable/disable toggle
    - _Requirements: 16.1_

  - [ ] 13.2 Create add connector form
    - Implement form with type selection, URL, API key inputs
    - Add test connection button
    - Validate with Valibot schema
    - _Requirements: 16.2, 16.3_

  - [ ] 13.3 Create connector detail page
    - Display full configuration
    - Show connection health history
    - Show sync history and status
    - _Requirements: 16.4, 16.5_

  - [ ] 13.4 Implement connector CRUD operations
    - Create server actions for add, edit, delete
    - Implement test connection action
    - _Requirements: 1.1, 1.2_

- [ ] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 6: Sync Service

- [ ] 15. Implement sync service
  - [ ] 15.1 Create incremental sync logic
    - Fetch series/movies from connector
    - Update content mirror with changes
    - Track sync state per connector
    - _Requirements: 2.1, 2.3, 2.4, 2.5_

  - [ ] 15.2 Create full reconciliation logic
    - Fetch complete library
    - Compare with content mirror
    - Insert new, update changed, delete removed items
    - Cascade delete search state for removed items
    - _Requirements: 2.2_

  - [ ] 15.3 Implement sync failure handling
    - Retry with exponential backoff
    - Track consecutive failures
    - Mark connector unhealthy after threshold
    - _Requirements: 2.6_

  - [ ] 15.4 Write property test for sync reconciliation
    - **Property 18: Sync Reconciliation Correctness**
    - **Validates: Requirements 2.2**

- [ ] 16. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 7: Discovery Service

- [ ] 17. Implement discovery service
  - [ ] 17.1 Create gap detector
    - Query content mirror for monitored items with hasFile=false
    - Create search registry entries for new gaps
    - _Requirements: 3.1, 3.2, 3.3_

  - [ ] 17.2 Create upgrade detector
    - Query content mirror for monitored items with qualityCutoffNotMet=true
    - Create search registry entries for new upgrade candidates
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 17.3 Implement registry cleanup on success
    - Delete search registry when hasFile becomes true
    - Delete search registry when qualityCutoffNotMet becomes false
    - _Requirements: 3.4, 4.4_

  - [ ] 17.4 Write property tests for discovery
    - **Property 2: Gap Discovery Correctness**
    - **Property 3: Upgrade Discovery Correctness**
    - **Property 4: Search Registry Cleanup on Success**
    - **Validates: Requirements 3.1, 3.3, 3.4, 4.1, 4.3, 4.4**

- [ ] 18. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 8: Queue Service

- [ ] 19. Implement priority calculation
  - [ ] 19.1 Create priority calculator
    - Factor in content age, missing duration, user priority
    - Apply failure penalty
    - Apply search type factor (gaps vs upgrades)
    - _Requirements: 5.1_

  - [ ] 19.2 Write property test for priority calculation
    - **Property 5: Priority Calculation Determinism**
    - **Validates: Requirements 5.1**

- [ ] 20. Implement queue management
  - [ ] 20.1 Create queue service
    - Implement enqueue with priority calculation
    - Implement dequeue in priority order
    - Implement pause/resume/clear operations
    - _Requirements: 5.2_

  - [ ] 20.2 Implement search state transitions
    - Transition pending → queued → searching → cooldown/exhausted
    - Calculate next eligible time on failure
    - Mark exhausted at max attempts
    - _Requirements: 5.5, 5.6_

  - [ ] 20.3 Write property tests for queue
    - **Property 6: Queue Processing Order**
    - **Property 8: Exhaustion at Max Attempts**
    - **Validates: Requirements 5.2, 5.6**

- [ ] 21. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 9: Episode Batching

- [ ] 22. Implement batching logic
  - [ ] 22.1 Create batching decision logic
    - Analyze season statistics (total, downloaded, nextAiring)
    - Decide SeasonSearch vs EpisodeSearch based on thresholds
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ] 22.2 Implement episode grouping
    - Group episodes by series
    - Limit batch size to 10 episodes per command
    - _Requirements: 6.4, 29.4, 29.5_

  - [ ] 22.3 Implement season pack fallback
    - Track season pack search failures
    - Fall back to individual episodes after cooldown
    - _Requirements: 6.5_

  - [ ] 22.4 Write property tests for batching
    - **Property 9: Episode Batching Decision**
    - **Property 10: Episode Grouping by Series**
    - **Property 17: Search Command Batch Size Limits**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 29.4, 29.5**

- [ ] 23. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 10: Throttle Profiles

- [ ] 24. Implement throttle profile management
  - [ ] 24.1 Create throttle profile schema and CRUD
    - Define throttle_profiles table
    - Implement create, read, update, delete operations
    - _Requirements: 7.1_

  - [ ] 24.2 Implement rate limiting enforcement
    - Track requests per minute
    - Track daily budget
    - Pause processing when limits reached
    - _Requirements: 7.1, 7.2_

  - [ ] 24.3 Implement HTTP 429 handling
    - Pause connector on rate limit response
    - Apply extended cooldown
    - _Requirements: 7.3_

  - [ ] 24.4 Implement counter reset
    - Reset request counts at configured interval
    - _Requirements: 7.4_

  - [ ] 24.5 Write property tests for throttling
    - **Property 11: Throttle Profile Enforcement**
    - **Property 12: Request Counter Reset**
    - **Validates: Requirements 7.1, 7.2, 7.4**

- [ ] 25. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 11: Scheduler

- [ ] 26. Implement scheduler
  - [ ] 26.1 Create Croner job initialization
    - Initialize jobs in hooks.server.ts
    - Configure protect: true for overrun protection
    - _Requirements: 8.1, 8.3_

  - [ ] 26.2 Implement sweep cycle jobs
    - Create incremental sync job (every 15 minutes)
    - Create full reconciliation job (daily)
    - Create queue processor job (every minute)
    - _Requirements: 8.1, 8.2, 8.4_

  - [ ] 26.3 Implement health check job
    - Check connector health every 5 minutes
    - Update connector health status
    - _Requirements: 1.4_

  - [ ] 26.4 Implement unhealthy connector exclusion
    - Skip sweep cycles for unhealthy connectors
    - _Requirements: 1.5_

  - [ ] 26.5 Write property test for unhealthy connector exclusion
    - **Property 19: Unhealthy Connector Exclusion**
    - **Validates: Requirements 1.5**

- [ ] 27. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 12: Content Browser UI

- [ ] 28. Create content browser pages
  - [ ] 28.1 Create content list page
    - Display content with filters (connector, type, status)
    - Implement title search
    - Show sortable columns
    - _Requirements: 17.1, 17.2_

  - [ ] 28.2 Create series detail page
    - Display metadata and quality status per episode
    - Show gap and upgrade status
    - Show search history
    - _Requirements: 17.3_

  - [ ] 28.3 Create movie detail page
    - Display metadata and current quality
    - Show search history and lastSearchTime
    - _Requirements: 17.4_

  - [ ] 28.4 Implement bulk actions
    - Select multiple items
    - Queue for search, adjust priority, mark exhausted
    - _Requirements: 17.5_

- [ ] 29. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 13: Queue Management UI

- [ ] 30. Create queue management pages
  - [ ] 30.1 Create queue list page
    - Display items in priority order
    - Show estimated dispatch time
    - Show current processing indicator
    - _Requirements: 18.1_

  - [ ] 30.2 Implement queue controls
    - Add priority adjustment
    - Add remove from queue
    - Add pause/resume/clear actions
    - _Requirements: 18.2, 18.3_

  - [ ] 30.3 Create recent completions view
    - Display last N completed searches
    - Show outcome indicators
    - _Requirements: 18.4_

  - [ ] 30.4 Implement real-time updates
    - Use SvelteKit invalidation for queue updates
    - _Requirements: 18.5_

- [ ] 31. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 14: Dashboard

- [ ] 32. Create dashboard page
  - [ ] 32.1 Create connection status panel
    - Display health indicators for all connectors
    - Show last sync time per connector
    - _Requirements: 15.1_

  - [ ] 32.2 Create statistics cards
    - Show total gaps, upgrade candidates, queue items
    - Show searches completed today and success rate
    - _Requirements: 15.2_

  - [ ] 32.3 Create activity feed
    - Display recent discoveries and search outcomes
    - Show system events
    - _Requirements: 15.3_

  - [ ] 32.4 Create library completion visualization
    - Show per-connector completion percentage
    - Add trend sparklines
    - _Requirements: 15.4_

  - [ ] 32.5 Create upcoming schedule display
    - Show next scheduled sweeps
    - Show current sweep progress
    - _Requirements: 15.5_

- [ ] 33. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 15: Notifications

- [ ] 34. Implement notification system
  - [ ] 34.1 Create notification channel schema
    - Define notification_channels table
    - Define notification_history table
    - _Requirements: 9.1_

  - [ ] 34.2 Implement notification channels
    - Implement Discord webhook
    - Implement Telegram bot API
    - Implement Slack webhook
    - Implement email via SMTP
    - Implement generic webhook with signature support
    - _Requirements: 9.1, 9.5_

  - [ ] 34.3 Implement notification dispatch
    - Send to enabled channels for event type
    - Support message templating
    - _Requirements: 9.2_

  - [ ] 34.4 Implement notification batching
    - Combine similar events within time window
    - _Requirements: 9.3_

  - [ ] 34.5 Implement quiet hours
    - Suppress notifications during configured period
    - _Requirements: 9.4_

- [ ] 35. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 16: Schedule Management UI

- [ ] 36. Create schedule management pages
  - [ ] 36.1 Create schedule list page
    - Display schedules with connector, cron, next run
    - Add enable/disable toggle
    - _Requirements: 19.1_

  - [ ] 36.2 Create schedule editor
    - Add connector and sweep type selection
    - Add cron expression input with builder UI
    - Add throttle profile selection
    - _Requirements: 19.2, 19.3_

  - [ ] 36.3 Create timeline visualization
    - Display calendar view of upcoming sweeps
    - _Requirements: 19.4_

- [ ] 37. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 17: Analytics

- [ ] 38. Implement analytics
  - [ ] 38.1 Create analytics schema
    - Define analytics_events table
    - Define aggregated statistics tables
    - _Requirements: 12.1_

  - [ ] 38.2 Implement analytics collectors
    - Track gap discovery rate
    - Track search volume and success rate
    - Track queue depth
    - _Requirements: 12.1_

  - [ ] 38.3 Create analytics dashboard
    - Display time-series charts
    - Show connector comparison
    - Show content analysis
    - _Requirements: 12.2, 12.3_

  - [ ] 38.4 Implement CSV export
    - Export statistics with date range selection
    - _Requirements: 12.4_

- [ ] 39. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 18: Settings UI

- [ ] 40. Create settings pages
  - [ ] 40.1 Create general settings page
    - Add application name, timezone, log level options
    - _Requirements: 21.1_

  - [ ] 40.2 Create throttle profiles page
    - List profiles with presets
    - Add create/edit custom profile form
    - _Requirements: 21.2_

  - [ ] 40.3 Create notifications settings page
    - Add channel configuration
    - Add event filtering
    - Add test notification button
    - Add quiet hours configuration
    - _Requirements: 21.3_

  - [ ] 40.4 Create search behavior settings page
    - Add priority weights configuration
    - Add season pack thresholds
    - Add cooldown and retry settings
    - _Requirements: 21.4_

  - [ ] 40.5 Create security settings page
    - Add authentication mode selection
    - Add password change form
    - Add session management
    - _Requirements: 21.5_

- [ ] 41. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 19: Database Maintenance

- [ ] 42. Implement maintenance tasks
  - [ ] 42.1 Create maintenance service
    - Implement VACUUM and ANALYZE operations
    - _Requirements: 13.1_

  - [ ] 42.2 Implement orphan cleanup
    - Delete search state without content mirror items
    - _Requirements: 13.2_

  - [ ] 42.3 Implement history pruning
    - Prune search history older than retention period
    - Preserve aggregated statistics
    - _Requirements: 13.3_

  - [ ] 42.4 Schedule maintenance job
    - Run daily at configured time
    - _Requirements: 13.1_

- [ ] 43. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 20: Health Check and Logging

- [ ] 44. Implement health check endpoint
  - [ ] 44.1 Create /health endpoint
    - Return application status
    - Return database connection status
    - Return per-connector health summary
    - Return queue status and memory usage
    - _Requirements: 32.1, 32.2, 32.3, 32.4, 32.5_

- [ ] 45. Implement structured logging
  - [ ] 45.1 Create logger module
    - Implement structured JSON logging
    - Support log levels (error, warn, info, debug, trace)
    - _Requirements: 31.1, 31.4_

  - [ ] 45.2 Implement correlation ID propagation
    - Generate correlation ID in hooks.server.ts
    - Propagate through request lifecycle
    - _Requirements: 31.2_

  - [ ] 45.3 Implement runtime log level change
    - Allow changing log level without restart
    - _Requirements: 31.5_

- [ ] 46. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 21: Backup and Restore

- [ ] 47. Implement backup/restore
  - [ ] 47.1 Create backup service
    - Export all database tables
    - Include encrypted secrets
    - _Requirements: 33.1_

  - [ ] 47.2 Create restore service
    - Validate backup integrity
    - Check SECRET_KEY compatibility
    - Apply migrations if needed
    - _Requirements: 33.2, 33.3, 33.4_

  - [ ] 47.3 Implement scheduled backups
    - Create backups at configured interval
    - _Requirements: 33.5_

- [ ] 48. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 22: External API

- [ ] 49. Implement external API
  - [ ] 49.1 Create API key management
    - Generate API keys with description and scope
    - Store keys securely
    - _Requirements: 34.1_

  - [ ] 49.2 Implement API key authentication
    - Validate X-API-Key header
    - Enforce scope restrictions
    - _Requirements: 34.2_

  - [ ] 49.3 Implement key revocation and logging
    - Revoke keys immediately
    - Log API key usage
    - _Requirements: 34.3, 34.4_

  - [ ] 49.4 Implement API rate limiting
    - Enforce per-key request limits
    - _Requirements: 34.5_

- [ ] 50. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 23: Docker Deployment

- [ ] 51. Create Docker configuration
  - [ ] 51.1 Create multi-stage Dockerfile
    - Base stage with oven/bun:1-alpine
    - Dependencies stage with BuildKit cache mounts
    - Build stage with NODE_ENV=production
    - Production stage with non-root user
    - _Requirements: 37.1_

  - [ ] 51.2 Create Docker Compose configuration
    - Configure app service with health check
    - Configure PostgreSQL with secrets
    - Set up depends_on with service_healthy condition
    - _Requirements: 37.2_

  - [ ] 51.3 Configure health check in container
    - Add HEALTHCHECK instruction
    - _Requirements: 32.1_

- [ ] 52. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

