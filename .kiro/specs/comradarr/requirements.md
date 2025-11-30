# Requirements Document

## Introduction

Comradarr is a media library completion service that integrates with *arr applications (Sonarr, Radarr, Whisparr) to systematically identify and request missing or upgradeable content. Unlike similar tools that pollute *arr applications with tags to track state, Comradarr maintains all state in its own PostgreSQL database, providing accurate episode-level tracking, clean separation of concerns, and proper scalability for large libraries.

## Glossary

- **Connector**: A configured connection to an *arr application instance storing URL, API key, and instance-specific settings
- **Sweep Cycle**: A scheduled operation that scans a connector's library for content gaps or upgrade opportunities
- **Content Gap**: Missing items within a library — episodes not yet downloaded, movies added but not acquired
- **Upgrade Candidate**: Existing items that could be replaced with higher quality versions based on quality profile
- **Throttle Profile**: Rate-limiting configuration controlling batch sizes, delays, cooldowns, and daily request budgets
- **Request Queue**: A prioritized list of search requests waiting to be sent to *arr applications
- **Content Mirror**: Local database copy of what exists in *arr applications and at what quality
- **Search State**: Records of what actions Comradarr has taken on items
- **Quality Profile**: Configuration in *arr applications defining acceptable quality levels and upgrade cutoffs
- **Season Pack**: A single release containing all episodes of a season

## Requirements

### Requirement 1: Connector Management

**User Story:** As a user, I want to configure connections to my *arr applications, so that Comradarr can communicate with them to identify and request content.

#### Acceptance Criteria

1. WHEN a user adds a new connector THEN the System SHALL store the URL, API key (encrypted using AES-256-GCM), connector type, display name, and enabled status
2. WHEN a user tests a connector connection THEN the System SHALL validate connectivity via GET /ping and GET /api/v3/system/status endpoints and report success or failure with details
3. WHEN a connector is created THEN the System SHALL auto-detect the API version from the system/status response and store it
4. WHEN a connector health check runs THEN the System SHALL query GET /api/v3/health and update the connector's health status (healthy, degraded, unhealthy, offline)
5. WHEN a connector becomes unhealthy THEN the System SHALL pause sweep cycles for that connector and notify the user

### Requirement 2: Library Synchronization

**User Story:** As a user, I want Comradarr to synchronize my library data from *arr applications, so that it can accurately track what content I have and what is missing.

#### Acceptance Criteria

1. WHEN an incremental sync runs THEN the System SHALL query the *arr application for series/movies and update the content mirror with changes to hasFile, quality, and monitored status
2. WHEN a full reconciliation runs THEN the System SHALL fetch the complete library, compare against the content mirror, insert new items, update changed items, and delete removed items with cascade to search state
3. WHEN syncing Sonarr or Whisparr content THEN the System SHALL store series, seasons, and episodes with their respective metadata including tvdbId, seasonNumber, episodeNumber, airDateUtc, and qualityCutoffNotMet
4. WHEN syncing Radarr content THEN the System SHALL store movies with metadata including tmdbId, imdbId, year, hasFile, movieFileId, and qualityCutoffNotMet
5. WHEN pagination is required THEN the System SHALL request data in batches of 1000 items per page
6. WHEN a sync fails THEN the System SHALL retry with exponential backoff and mark the connector unhealthy after a configurable threshold of consecutive failures

### Requirement 3: Content Gap Discovery

**User Story:** As a user, I want Comradarr to identify missing content in my library, so that I can automatically request searches for that content.

#### Acceptance Criteria

1. WHEN discovering content gaps THEN the System SHALL identify all monitored items where hasFile equals false
2. WHEN using the wanted/missing endpoint THEN the System SHALL query GET /api/v3/wanted/missing with pagination to efficiently retrieve missing items
3. WHEN a new gap is discovered THEN the System SHALL create a search registry entry with state "pending" and search type "gap"
4. WHEN an item's hasFile status changes from false to true THEN the System SHALL delete the corresponding search registry entry

### Requirement 4: Upgrade Candidate Discovery

**User Story:** As a user, I want Comradarr to identify content that can be upgraded to higher quality, so that I can improve my library quality over time.

#### Acceptance Criteria

1. WHEN discovering upgrade candidates THEN the System SHALL identify all monitored items where qualityCutoffNotMet equals true
2. WHEN using the wanted/cutoff endpoint THEN the System SHALL query GET /api/v3/wanted/cutoff with pagination to efficiently retrieve upgrade candidates
3. WHEN a new upgrade candidate is discovered THEN the System SHALL create a search registry entry with state "pending" and search type "upgrade"
4. WHEN an item's qualityCutoffNotMet status changes from true to false THEN the System SHALL delete the corresponding search registry entry

### Requirement 5: Search Request Queue Management

**User Story:** As a user, I want search requests to be queued and processed intelligently, so that indexers are not overwhelmed and searches are prioritized appropriately.

#### Acceptance Criteria

1. WHEN an item is queued for search THEN the System SHALL calculate a priority score based on content age, missing duration, user priority override, failure penalty, and search type factor
2. WHEN processing the queue THEN the System SHALL dispatch requests in priority order while respecting throttle profile limits
3. WHEN a search is dispatched THEN the System SHALL send the appropriate command (EpisodeSearch, SeasonSearch, or MoviesSearch) via POST /api/v3/command
4. WHEN a search command completes THEN the System SHALL poll GET /api/v3/command/{id} until status equals "completed" or "failed"
5. WHEN a search fails with no results THEN the System SHALL increment the attempt counter, set state to "cooldown", and calculate the next eligible search time using exponential backoff
6. WHEN a search reaches the maximum retry attempts THEN the System SHALL set the state to "exhausted"

### Requirement 6: Episode Search Batching

**User Story:** As a user, I want episode searches to be batched intelligently, so that season packs are used when appropriate and individual episodes are searched when necessary.

#### Acceptance Criteria

1. WHEN a season is fully aired and missing percentage exceeds the configured threshold THEN the System SHALL use SeasonSearch command instead of individual EpisodeSearch commands
2. WHEN a season is currently airing THEN the System SHALL use individual EpisodeSearch commands
3. WHEN fewer episodes are missing than the configured threshold THEN the System SHALL use individual EpisodeSearch commands
4. WHEN batching individual episode searches THEN the System SHALL group episodes by series and limit concurrent searches per series
5. WHEN a season pack search fails THEN the System SHALL fall back to individual episode searches after the cooldown period

### Requirement 7: Throttle Profile Management

**User Story:** As a user, I want to configure rate limiting profiles, so that I can prevent indexer bans while maximizing search efficiency.

#### Acceptance Criteria

1. WHEN a throttle profile is configured THEN the System SHALL enforce requests per minute, batch size, cooldown periods, and daily request budget limits
2. WHEN the daily request budget is exhausted THEN the System SHALL pause queue processing until the next day
3. WHEN an HTTP 429 response is received THEN the System SHALL pause all searches for the affected connector and apply extended cooldown
4. WHEN a throttle profile is applied THEN the System SHALL track request counts and reset them at the configured interval
5. WHEN preset profiles are available THEN the System SHALL provide Conservative, Moderate, and Aggressive presets with predefined limits
6. WHEN a user creates a custom profile THEN the System SHALL allow configuring all rate limiting parameters independently
7. WHEN a connector has no profile assigned THEN the System SHALL use the global default profile (Moderate preset)

### Requirement 8: Sweep Cycle Scheduling

**User Story:** As a user, I want to schedule automated sweep cycles, so that my library is continuously monitored for gaps and upgrade opportunities.

#### Acceptance Criteria

1. WHEN a sweep schedule is configured THEN the System SHALL execute sweeps at the specified cron intervals with timezone awareness
2. WHEN a sweep cycle starts THEN the System SHALL run discovery for the configured search types (gaps, upgrades, or both)
3. WHEN a sweep is already running for a connector THEN the System SHALL skip the new sweep execution using Croner's protect option
4. WHEN a sweep completes THEN the System SHALL log a summary of discoveries and items queued

### Requirement 9: Notification System

**User Story:** As a user, I want to receive notifications about important events, so that I can stay informed about my library completion progress.

#### Acceptance Criteria

1. WHEN a notification channel is configured THEN the System SHALL support Discord, Telegram, Slack, Pushover, Gotify, ntfy, email via SMTP, and generic webhooks
2. WHEN a notifiable event occurs THEN the System SHALL send notifications to all enabled channels that have that event type selected
3. WHEN batching is enabled THEN the System SHALL combine similar events within the configured time window into a digest notification
4. WHEN quiet hours are configured THEN the System SHALL suppress notifications during the specified time period
5. WHEN a webhook requires signature verification THEN the System SHALL use request.text() for raw body access

### Requirement 10: User Authentication

**User Story:** As a user, I want to secure access to Comradarr, so that unauthorized users cannot modify my configuration or trigger searches.

#### Acceptance Criteria

1. WHEN full authentication mode is enabled THEN the System SHALL require username and password for all access with sessions stored in PostgreSQL
2. WHEN a user logs in THEN the System SHALL hash passwords using Argon2id and create a session with configurable expiry
3. WHEN local network bypass mode is enabled THEN the System SHALL allow unauthenticated access from RFC1918 addresses only
4. WHEN an unauthenticated request is made to a protected route THEN the System SHALL redirect to the login page
5. WHEN security headers are applied THEN the System SHALL include X-Frame-Options, X-Content-Type-Options, Referrer-Policy, and Strict-Transport-Security headers

### Requirement 11: Search State Persistence

**User Story:** As a user, I want Comradarr to maintain its own search state, so that my *arr applications remain clean and state survives application restarts.

#### Acceptance Criteria

1. WHEN a search registry entry is created THEN the System SHALL store content reference, connector reference, search type, state, attempt counter, timestamps, and priority score
2. WHEN search state is queried THEN the System SHALL return entries filtered by connector, search type, and state
3. WHEN pruning exhausted records THEN the System SHALL delete entries older than the configured retention threshold
4. WHEN a content mirror item is deleted THEN the System SHALL cascade delete the corresponding search state entries

### Requirement 12: Analytics and Reporting

**User Story:** As a user, I want to view analytics about my library completion progress, so that I can understand trends and identify issues.

#### Acceptance Criteria

1. WHEN analytics are collected THEN the System SHALL track gap discovery rate, search volume, success rate, and queue depth over time
2. WHEN viewing analytics THEN the System SHALL display time-series charts for key metrics
3. WHEN comparing connectors THEN the System SHALL show success rates, response times, and error rates per connector
4. WHEN exporting analytics THEN the System SHALL provide CSV export with configurable date range

### Requirement 13: Database Management

**User Story:** As a user, I want the database to be maintained automatically, so that performance remains optimal as my library grows.

#### Acceptance Criteria

1. WHEN database maintenance runs THEN the System SHALL execute VACUUM and ANALYZE operations
2. WHEN orphan cleanup runs THEN the System SHALL delete search state entries without corresponding content mirror items
3. WHEN search history exceeds the retention period THEN the System SHALL prune old records while preserving aggregated statistics
4. WHEN the database connection pool is configured THEN the System SHALL use 10-25 connections with idle timeout and max lifetime settings

### Requirement 14: Content Mirror Data Model

**User Story:** As a developer, I want a well-structured content mirror, so that gap detection and upgrade tracking are efficient and accurate.

#### Acceptance Criteria

1. WHEN storing episode data THEN the System SHALL include seasonNumber, episodeNumber, title, airDateUtc, monitored, hasFile, quality, qualityCutoffNotMet, episodeFileId, and lastSearchTime
2. WHEN storing movie data THEN the System SHALL include tmdbId, imdbId, title, year, monitored, hasFile, quality, qualityCutoffNotMet, movieFileId, and lastSearchTime
3. WHEN indexing content THEN the System SHALL create indexes on (connector_id, has_file) and (connector_id, quality_cutoff_not_met) for efficient gap and upgrade queries
4. WHEN serializing quality data THEN the System SHALL store the QualityModel structure including quality name, source, resolution, and revision
5. WHEN deserializing quality data THEN the System SHALL reconstruct the QualityModel structure accurately from stored data

### Requirement 15: Dashboard Interface

**User Story:** As a user, I want a dashboard that provides an at-a-glance overview of my library status, so that I can quickly understand the state of my media collection.

#### Acceptance Criteria

1. WHEN the dashboard loads THEN the System SHALL display health indicators for all configured connectors with last sync time
2. WHEN displaying statistics THEN the System SHALL show total content gaps, total upgrade candidates, items in queue, searches completed today, and success rate
3. WHEN displaying the activity feed THEN the System SHALL show recent discoveries, search outcomes, and system events in chronological order
4. WHEN displaying library completion THEN the System SHALL show per-connector completion percentage with trend sparklines
5. WHEN displaying upcoming schedules THEN the System SHALL show next scheduled sweeps and current sweep progress if running

### Requirement 16: Connector Management Interface

**User Story:** As a user, I want to manage my *arr application connections through a visual interface, so that I can easily add, edit, and monitor connectors.

#### Acceptance Criteria

1. WHEN viewing the connector list THEN the System SHALL display status indicator, name, type, URL, quick stats, and enable/disable toggle for each connector
2. WHEN adding a connector THEN the System SHALL provide a form to select type, enter URL and API key, test connection, and configure instance name
3. WHEN testing a connection THEN the System SHALL validate via GET /ping and display success or detailed error message
4. WHEN viewing connector details THEN the System SHALL display full configuration, connection health history, sync history, and per-connector statistics
5. WHEN a connector has errors THEN the System SHALL display actionable quick actions to resolve issues

### Requirement 17: Content Browser Interface

**User Story:** As a user, I want to browse and search my library content, so that I can view status and manually manage individual items.

#### Acceptance Criteria

1. WHEN browsing content THEN the System SHALL provide filters for connector, content type, and status (all, missing, upgrade candidates, queued, searching, exhausted)
2. WHEN searching content THEN the System SHALL filter results by title with real-time updates
3. WHEN viewing series detail THEN the System SHALL display metadata, current quality status per episode, gap and upgrade status, and search history
4. WHEN viewing movie detail THEN the System SHALL display metadata, current quality, search history, and lastSearchTime
5. WHEN performing bulk actions THEN the System SHALL allow selecting multiple items to queue for search, adjust priority, mark exhausted, or clear search state

### Requirement 18: Queue Management Interface

**User Story:** As a user, I want to view and manage the search request queue, so that I can monitor progress and adjust priorities.

#### Acceptance Criteria

1. WHEN viewing the queue THEN the System SHALL display items in priority order with estimated dispatch time and current processing indicator
2. WHEN managing queue items THEN the System SHALL allow manual priority adjustment and removal from queue
3. WHEN controlling the queue THEN the System SHALL provide pause, resume, and clear entire queue actions
4. WHEN viewing recent completions THEN the System SHALL display the last N completed searches with outcome indicators
5. WHEN the queue updates THEN the System SHALL reflect changes in real-time without page refresh

### Requirement 19: Schedule Management Interface

**User Story:** As a user, I want to configure and monitor sweep schedules, so that I can automate library scanning at appropriate intervals.

#### Acceptance Criteria

1. WHEN viewing schedules THEN the System SHALL display all configured sweep schedules with associated connector, cron expression, next run time, and enable/disable toggle
2. WHEN editing a schedule THEN the System SHALL provide connector selection, sweep type selection, cron expression input with builder UI, and throttle profile selection
3. WHEN displaying cron expressions THEN the System SHALL show human-readable descriptions alongside the technical expression
4. WHEN viewing the timeline THEN the System SHALL display a calendar or timeline view of upcoming sweeps to identify conflicts

### Requirement 20: Analytics Interface

**User Story:** As a user, I want to view detailed analytics about my library completion progress, so that I can understand trends and optimize my configuration.

#### Acceptance Criteria

1. WHEN viewing time-series charts THEN the System SHALL display gap discovery rate, search volume, success rate, and queue depth over configurable time periods
2. WHEN comparing connectors THEN the System SHALL display success rates, response times, and error rates side by side
3. WHEN analyzing content THEN the System SHALL show most searched items, hardest to find content, and quality distribution
4. WHEN exporting data THEN the System SHALL provide CSV export with selectable date range and metrics

### Requirement 21: Settings Interface

**User Story:** As a user, I want to configure application settings through a visual interface, so that I can customize behavior without editing configuration files.

#### Acceptance Criteria

1. WHEN configuring general settings THEN the System SHALL provide options for application name, timezone, log verbosity, and update preferences
2. WHEN configuring throttle profiles THEN the System SHALL allow creating custom profiles with requests per minute, batch size, cooldown periods, and daily budget
3. WHEN configuring notifications THEN the System SHALL provide channel configuration, per-channel event filtering, test notification, and quiet hours settings
4. WHEN configuring search behavior THEN the System SHALL provide options for priority weights, season pack thresholds, cooldown periods, and maximum retry attempts
5. WHEN configuring security THEN the System SHALL provide authentication mode selection, password change, and session management

### Requirement 22: Theme and Layout

**User Story:** As a user, I want a responsive and visually appealing interface, so that I can use Comradarr comfortably on different devices and in different lighting conditions.

#### Acceptance Criteria

1. WHEN the application loads THEN the System SHALL detect system theme preference and apply dark or light theme accordingly
2. WHEN the user toggles theme THEN the System SHALL switch between dark and light modes and persist the preference
3. WHEN viewing on smaller screens THEN the System SHALL collapse the sidebar navigation and adapt layout for mobile viewing
4. WHEN displaying status indicators THEN the System SHALL use consistent color coding (green for healthy, yellow for degraded, red for unhealthy)

### Requirement 23: *arr API Client Infrastructure

**User Story:** As a developer, I want a robust API client infrastructure, so that communication with *arr applications is reliable, typed, and maintainable.

#### Acceptance Criteria

1. WHEN making API requests THEN the System SHALL include the X-Api-Key header with the decrypted API key for authentication
2. WHEN making API requests THEN the System SHALL apply a configurable timeout using AbortSignal.timeout with a default of 30 seconds
3. WHEN an API request fails THEN the System SHALL categorize the error as network error, authentication error, rate limit error, or application error
4. WHEN an API request times out THEN the System SHALL abort the request and return a timeout error with the elapsed duration
5. WHEN retrying failed requests THEN the System SHALL use exponential backoff with configurable base delay and maximum retries

### Requirement 24: Sonarr API Integration

**User Story:** As a user with Sonarr, I want Comradarr to fully integrate with Sonarr's API, so that my TV series library is properly managed.

#### Acceptance Criteria

1. WHEN fetching series THEN the System SHALL call GET /api/v3/series and map the response to the internal Series model including tvdbId, title, status, seasons, and qualityProfileId
2. WHEN fetching episodes for a series THEN the System SHALL call GET /api/v3/episode with seriesId parameter and map responses including seasonNumber, episodeNumber, hasFile, and airDateUtc
3. WHEN fetching missing episodes THEN the System SHALL call GET /api/v3/wanted/missing with page, pageSize, and monitored parameters
4. WHEN fetching upgrade candidates THEN the System SHALL call GET /api/v3/wanted/cutoff with page, pageSize, and monitored parameters
5. WHEN triggering an episode search THEN the System SHALL POST to /api/v3/command with name "EpisodeSearch" and episodeIds array
6. WHEN triggering a season search THEN the System SHALL POST to /api/v3/command with name "SeasonSearch", seriesId, and seasonNumber
7. WHEN checking command status THEN the System SHALL poll GET /api/v3/command/{id} and parse status field for queued, started, completed, or failed states

### Requirement 25: Radarr API Integration

**User Story:** As a user with Radarr, I want Comradarr to fully integrate with Radarr's API, so that my movie library is properly managed.

#### Acceptance Criteria

1. WHEN fetching movies THEN the System SHALL call GET /api/v3/movie and map the response to the internal Movie model including tmdbId, imdbId, title, year, hasFile, and qualityCutoffNotMet
2. WHEN fetching missing movies THEN the System SHALL call GET /api/v3/wanted/missing with page, pageSize, and monitored parameters
3. WHEN fetching upgrade candidates THEN the System SHALL call GET /api/v3/wanted/cutoff with page, pageSize, and monitored parameters
4. WHEN triggering a movie search THEN the System SHALL POST to /api/v3/command with name "MoviesSearch" and movieIds array
5. WHEN checking command status THEN the System SHALL poll GET /api/v3/command/{id} and parse status field for queued, started, completed, or failed states
6. WHEN detecting API version THEN the System SHALL support v3, v4, and v5 API versions based on system/status response

### Requirement 26: Whisparr API Integration

**User Story:** As a user with Whisparr, I want Comradarr to fully integrate with Whisparr's API, so that my content library is properly managed.

#### Acceptance Criteria

1. WHEN fetching series THEN the System SHALL call GET /api/v3/series and map the response using the same structure as Sonarr
2. WHEN fetching episodes THEN the System SHALL call GET /api/v3/episode with seriesId parameter and map responses including seasonNumber, episodeNumber, hasFile, and airDateUtc
3. WHEN fetching missing episodes THEN the System SHALL call GET /api/v3/wanted/missing with page, pageSize, and monitored parameters
4. WHEN fetching upgrade candidates THEN the System SHALL call GET /api/v3/wanted/cutoff with page, pageSize, and monitored parameters
5. WHEN triggering searches THEN the System SHALL use the same command structure as Sonarr (EpisodeSearch, SeasonSearch)

### Requirement 27: API Response Parsing

**User Story:** As a developer, I want API responses to be parsed and validated correctly, so that data integrity is maintained throughout the system.

#### Acceptance Criteria

1. WHEN parsing paginated responses THEN the System SHALL extract page, pageSize, totalRecords, and records array from the response
2. WHEN parsing series responses THEN the System SHALL extract and validate id, title, tvdbId, status, seasons array, and statistics
3. WHEN parsing episode responses THEN the System SHALL extract and validate id, seriesId, seasonNumber, episodeNumber, hasFile, airDateUtc, and qualityCutoffNotMet
4. WHEN parsing movie responses THEN the System SHALL extract and validate id, title, tmdbId, imdbId, year, hasFile, and qualityCutoffNotMet
5. WHEN parsing quality model THEN the System SHALL extract quality.id, quality.name, quality.source, quality.resolution, and revision fields
6. WHEN parsing command responses THEN the System SHALL extract id, name, status, started, ended, and message fields
7. WHEN a response contains unexpected fields THEN the System SHALL ignore unknown fields and continue processing
8. WHEN a response is missing required fields THEN the System SHALL log a warning and skip the malformed record

### Requirement 28: API Error Handling

**User Story:** As a user, I want API errors to be handled gracefully, so that temporary issues do not cause data loss or system instability.

#### Acceptance Criteria

1. WHEN receiving HTTP 401 Unauthorized THEN the System SHALL mark the connector as having authentication failure and notify the user
2. WHEN receiving HTTP 404 Not Found THEN the System SHALL log the missing resource and continue processing other items
3. WHEN receiving HTTP 429 Too Many Requests THEN the System SHALL pause requests to that connector and apply the Retry-After header value if present
4. WHEN receiving HTTP 500-599 Server Error THEN the System SHALL retry with exponential backoff up to the configured maximum retries
5. WHEN a network error occurs THEN the System SHALL categorize it as connection refused, DNS failure, or timeout and log appropriately
6. WHEN SSL certificate validation fails THEN the System SHALL respect the connector's SSL verification setting and either fail or proceed accordingly

### Requirement 29: API Request Batching and Pagination

**User Story:** As a developer, I want API requests to be batched and paginated efficiently, so that large libraries can be synchronized without overwhelming the *arr applications.

#### Acceptance Criteria

1. WHEN fetching large datasets THEN the System SHALL paginate requests with pageSize of 1000 items
2. WHEN iterating paginated results THEN the System SHALL continue fetching until page * pageSize >= totalRecords
3. WHEN batching episode fetches THEN the System SHALL group requests by series to minimize API calls
4. WHEN batching search commands THEN the System SHALL group up to 10 episodes per EpisodeSearch command
5. WHEN batching movie searches THEN the System SHALL group up to 10 movies per MoviesSearch command
6. WHEN rate limiting is active THEN the System SHALL space requests according to the throttle profile's requests per minute setting



### Requirement 30: Configuration Management

**User Story:** As a user, I want to configure Comradarr through environment variables and persistent settings, so that I can deploy and customize the application for my environment.

#### Acceptance Criteria

1. WHEN the application starts THEN the System SHALL read DATABASE_URL from environment variables as the required PostgreSQL connection string
2. WHEN optional environment variables are not set THEN the System SHALL use defaults for HOST (0.0.0.0), PORT (3000), TZ (UTC), LOG_LEVEL (info), and BASE_URL (/)
3. WHEN SECRET_KEY is not provided THEN the System SHALL generate a secure key and persist it for consistent encryption across restarts
4. WHEN user-configured settings are changed THEN the System SHALL persist them to the database and apply changes immediately without restart
5. WHEN exporting configuration THEN the System SHALL provide a JSON export of all settings for backup and migration purposes

### Requirement 31: Logging and Debugging

**User Story:** As an administrator, I want structured logging with configurable verbosity, so that I can troubleshoot issues and monitor application behavior.

#### Acceptance Criteria

1. WHEN logging events THEN the System SHALL output structured JSON with timestamp, level, module, message, and correlation_id fields
2. WHEN a request is received THEN the System SHALL generate a unique correlation ID and propagate it through all related operations
3. WHEN LOG_LEVEL is set to debug THEN the System SHALL include detailed operation tracing including API calls and queue decisions
4. WHEN LOG_LEVEL is set to trace THEN the System SHALL include full request and response bodies
5. WHEN log level is changed at runtime THEN the System SHALL apply the new level without requiring a restart

### Requirement 32: Health Check Endpoint

**User Story:** As a DevOps engineer, I want a health check endpoint, so that I can monitor application status and configure container orchestration.

#### Acceptance Criteria

1. WHEN GET /health is called THEN the System SHALL return application status, database connection status, and memory usage
2. WHEN connectors are configured THEN the System SHALL include per-connector health summary in the health response
3. WHEN the database is unreachable THEN the System SHALL return HTTP 503 with degraded status
4. WHEN all systems are operational THEN the System SHALL return HTTP 200 with healthy status
5. WHEN queue processing is paused THEN the System SHALL include queue status in the health response

### Requirement 33: Backup and Restore

**User Story:** As a user, I want to backup and restore my Comradarr configuration and data, so that I can recover from failures or migrate to new deployments.

#### Acceptance Criteria

1. WHEN a backup is triggered THEN the System SHALL export all database tables and encrypted secrets to a downloadable file
2. WHEN restoring from backup THEN the System SHALL validate backup integrity before applying changes
3. WHEN restoring with a different SECRET_KEY THEN the System SHALL fail with a clear error message about encryption key mismatch
4. WHEN a backup is from an older version THEN the System SHALL apply necessary migrations during restore
5. WHEN scheduled backups are configured THEN the System SHALL automatically create backups at the specified interval

### Requirement 34: External API Authentication

**User Story:** As a developer, I want to access Comradarr via API keys, so that I can integrate with external tools and automation.

#### Acceptance Criteria

1. WHEN an API key is generated THEN the System SHALL store it with an optional description and scope (read-only or full access)
2. WHEN an API request includes a valid X-API-Key header THEN the System SHALL authenticate the request based on the key's scope
3. WHEN an API key is revoked THEN the System SHALL immediately reject requests using that key
4. WHEN API key usage is logged THEN the System SHALL record the key identifier, endpoint, and timestamp
5. WHEN rate limiting is configured THEN the System SHALL enforce per-key request limits

### Requirement 35: Account Security

**User Story:** As a security-conscious user, I want protection against brute force attacks, so that my Comradarr instance remains secure.

#### Acceptance Criteria

1. WHEN a login attempt fails THEN the System SHALL increment the failed attempt counter for that username
2. WHEN failed attempts exceed the configured threshold THEN the System SHALL lock the account for a configurable duration
3. WHEN an account is locked THEN the System SHALL reject login attempts and display the remaining lockout time
4. WHEN the lockout period expires THEN the System SHALL reset the failed attempt counter and allow login attempts
5. WHEN a successful login occurs THEN the System SHALL reset the failed attempt counter for that username

### Requirement 36: Secrets Management

**User Story:** As a security-conscious user, I want all sensitive data encrypted and protected, so that credentials are not exposed.

#### Acceptance Criteria

1. WHEN storing notification channel credentials THEN the System SHALL encrypt them using AES-256-GCM with the application SECRET_KEY
2. WHEN displaying API keys or credentials in the UI THEN the System SHALL mask all but the last 4 characters
3. WHEN logging requests or responses THEN the System SHALL redact sensitive fields including API keys and passwords
4. WHEN rotating the SECRET_KEY THEN the System SHALL re-encrypt all stored secrets with the new key
5. WHEN exporting configuration THEN the System SHALL exclude decrypted secrets from the export

### Requirement 37: Performance and Scaling

**User Story:** As a user with a large library, I want Comradarr to handle scale efficiently, so that performance remains acceptable as my library grows.

#### Acceptance Criteria

1. WHEN processing large API responses THEN the System SHALL stream data using async iterators to limit memory usage
2. WHEN making concurrent API requests THEN the System SHALL limit requests per connector to prevent overwhelming *arr applications
3. WHEN the in-memory queue exceeds the configured limit THEN the System SHALL persist overflow items to the database
4. WHEN database queries return large result sets THEN the System SHALL paginate results to limit memory consumption
5. WHEN sweep cycles run THEN the System SHALL allow concurrent execution for different connectors while preventing overlap for the same connector

### Requirement 38: Prowlarr Health Monitoring (Optional)

**User Story:** As a user with Prowlarr, I want Comradarr to optionally monitor my indexer health, so that I can be informed about indexer availability before searches are dispatched.

#### Acceptance Criteria

1. WHEN a Prowlarr connection is configured THEN the System SHALL store the URL and API key (encrypted using AES-256-GCM)
2. WHEN health monitoring is enabled THEN the System SHALL periodically query Prowlarr's /api/v1/indexerstatus endpoint to retrieve indexer status
3. WHEN an indexer has a disabledTill timestamp in the future THEN the System SHALL mark that indexer as rate-limited in the cached health status
4. WHEN displaying indexer health THEN the System SHALL show the current status of all indexers including name, health state, and any error messages
5. WHEN unhealthy indexers are detected THEN the System SHALL log a warning but SHALL NOT block search dispatch (informational only)
6. WHEN Prowlarr is unreachable THEN the System SHALL continue normal operation and display cached health data with a stale indicator
