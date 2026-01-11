/**
 * Core database schema for Comradarr
 *
 * Tables defined:
 * - throttleProfiles: Rate-limiting configuration presets
 * - connectors: *arr application connections with encrypted API keys
 * - throttleState: Runtime rate-limiting state per connector
 * - series, seasons, episodes: Sonarr/Whisparr content mirror
 * - movies: Radarr content mirror
 * - searchRegistry, requestQueue, searchHistory: Search state tracking
 * - syncState: Sync tracking per connector
 * - users, sessions: Authentication
 * - apiKeys: External API authentication keys
 * - apiKeyUsageLogs: API key usage audit logs
 * - apiKeyRateLimitState: Runtime rate-limiting state per API key
 * - prowlarrInstances: Prowlarr connections for indexer health monitoring
 * - prowlarrIndexerHealth: Cached indexer health status
 * - notificationChannels: Notification channel configurations
 * - notificationHistory: Sent notification tracking
 * - completionSnapshots: Library completion history for trend visualization
 * - sweepSchedules: Per-connector sweep schedule configurations
 * - analyticsEvents: Raw analytics event tracking
 * - analyticsHourlyStats: Hourly aggregated statistics
 * - analyticsDailyStats: Daily aggregated statistics
 * - appSettings: Application-wide configuration settings
 */

import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar
} from 'drizzle-orm/pg-core';

// =============================================================================
// Throttle Profiles Table
// =============================================================================

export const throttleProfiles = pgTable('throttle_profiles', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	name: varchar('name', { length: 50 }).notNull().unique(),
	description: text('description'),
	requestsPerMinute: integer('requests_per_minute').notNull(),
	dailyBudget: integer('daily_budget'), // null = unlimited
	batchSize: integer('batch_size').notNull(),
	batchCooldownSeconds: integer('batch_cooldown_seconds').notNull(),
	rateLimitPauseSeconds: integer('rate_limit_pause_seconds').notNull(),
	isDefault: boolean('is_default').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// =============================================================================
// Connectors Table
// =============================================================================

export const connectors = pgTable('connectors', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	type: varchar('type', { length: 20 }).notNull(), // 'sonarr' | 'radarr' | 'whisparr'
	name: varchar('name', { length: 100 }).notNull(),
	url: varchar('url', { length: 500 }).notNull(),
	apiKeyEncrypted: text('api_key_encrypted').notNull(), // AES-256-GCM encrypted
	enabled: boolean('enabled').notNull().default(true),
	healthStatus: varchar('health_status', { length: 20 }).notNull().default('unknown'), // 'healthy' | 'degraded' | 'unhealthy' | 'offline' | 'unknown'
	queuePaused: boolean('queue_paused').notNull().default(false), // Whether queue processing is paused for this connector
	throttleProfileId: integer('throttle_profile_id').references(() => throttleProfiles.id, {
		onDelete: 'set null'
	}), // FK to throttle profile (null = use default)
	lastSync: timestamp('last_sync', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// =============================================================================
// Throttle State Table
// =============================================================================

export const throttleState = pgTable('throttle_state', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	connectorId: integer('connector_id')
		.notNull()
		.references(() => connectors.id, { onDelete: 'cascade' })
		.unique(),
	requestsThisMinute: integer('requests_this_minute').notNull().default(0),
	requestsToday: integer('requests_today').notNull().default(0),
	minuteWindowStart: timestamp('minute_window_start', { withTimezone: true }),
	dayWindowStart: timestamp('day_window_start', { withTimezone: true }),
	pausedUntil: timestamp('paused_until', { withTimezone: true }),
	pauseReason: varchar('pause_reason', { length: 50 }), // 'rate_limit' | 'daily_budget_exhausted' | 'manual'
	lastRequestAt: timestamp('last_request_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// =============================================================================
// Series Table (Sonarr/Whisparr)
// =============================================================================

export const series = pgTable(
	'series',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		connectorId: integer('connector_id')
			.notNull()
			.references(() => connectors.id, { onDelete: 'cascade' }),
		arrId: integer('arr_id').notNull(), // ID in the *arr application
		tvdbId: integer('tvdb_id'),
		title: varchar('title', { length: 500 }).notNull(),
		status: varchar('status', { length: 50 }), // 'continuing' | 'ended' | etc.
		monitored: boolean('monitored').notNull().default(true),
		qualityProfileId: integer('quality_profile_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [uniqueIndex('series_connector_arr_idx').on(table.connectorId, table.arrId)]
);

// =============================================================================
// Seasons Table
// =============================================================================

export const seasons = pgTable(
	'seasons',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		seriesId: integer('series_id')
			.notNull()
			.references(() => series.id, { onDelete: 'cascade' }),
		seasonNumber: integer('season_number').notNull(),
		monitored: boolean('monitored').notNull().default(true),
		totalEpisodes: integer('total_episodes').notNull().default(0),
		downloadedEpisodes: integer('downloaded_episodes').notNull().default(0),
		nextAiring: timestamp('next_airing', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [uniqueIndex('seasons_series_number_idx').on(table.seriesId, table.seasonNumber)]
);

// =============================================================================
// Episodes Table
// =============================================================================

export const episodes = pgTable(
	'episodes',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		seasonId: integer('season_id')
			.notNull()
			.references(() => seasons.id, { onDelete: 'cascade' }),
		connectorId: integer('connector_id')
			.notNull()
			.references(() => connectors.id, { onDelete: 'cascade' }),
		arrId: integer('arr_id').notNull(), // ID in the *arr application
		seasonNumber: integer('season_number').notNull(),
		episodeNumber: integer('episode_number').notNull(),
		title: varchar('title', { length: 500 }),
		airDate: timestamp('air_date', { withTimezone: true }),
		monitored: boolean('monitored').notNull().default(true),
		hasFile: boolean('has_file').notNull().default(false),
		quality: jsonb('quality'), // QualityModel JSON structure
		qualityCutoffNotMet: boolean('quality_cutoff_not_met').notNull().default(false),
		episodeFileId: integer('episode_file_id'),
		lastSearchTime: timestamp('last_search_time', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('episodes_connector_arr_idx').on(table.connectorId, table.arrId),
		// Indexes for efficient gap and upgrade queries
		index('episodes_gap_idx').on(table.connectorId, table.hasFile),
		index('episodes_upgrade_idx').on(table.connectorId, table.qualityCutoffNotMet)
	]
);

// =============================================================================
// Movies Table
// =============================================================================

export const movies = pgTable(
	'movies',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		connectorId: integer('connector_id')
			.notNull()
			.references(() => connectors.id, { onDelete: 'cascade' }),
		arrId: integer('arr_id').notNull(), // ID in the *arr application
		tmdbId: integer('tmdb_id'),
		imdbId: varchar('imdb_id', { length: 20 }),
		title: varchar('title', { length: 500 }).notNull(),
		year: integer('year'),
		monitored: boolean('monitored').notNull().default(true),
		hasFile: boolean('has_file').notNull().default(false),
		quality: jsonb('quality'), // QualityModel JSON structure
		qualityCutoffNotMet: boolean('quality_cutoff_not_met').notNull().default(false),
		movieFileId: integer('movie_file_id'),
		lastSearchTime: timestamp('last_search_time', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('movies_connector_arr_idx').on(table.connectorId, table.arrId),
		// Indexes for efficient gap and upgrade queries
		index('movies_gap_idx').on(table.connectorId, table.hasFile),
		index('movies_upgrade_idx').on(table.connectorId, table.qualityCutoffNotMet)
	]
);

// =============================================================================
// Search Registry Table
// =============================================================================

export const searchRegistry = pgTable(
	'search_registry',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		connectorId: integer('connector_id')
			.notNull()
			.references(() => connectors.id, { onDelete: 'cascade' }),
		contentType: varchar('content_type', { length: 20 }).notNull(), // 'episode' | 'movie'
		contentId: integer('content_id').notNull(), // References episodes.id or movies.id
		searchType: varchar('search_type', { length: 20 }).notNull(), // 'gap' | 'upgrade'
		state: varchar('state', { length: 20 }).notNull().default('pending'), // 'pending' | 'queued' | 'searching' | 'cooldown' | 'exhausted'
		attemptCount: integer('attempt_count').notNull().default(0),
		lastSearched: timestamp('last_searched', { withTimezone: true }),
		nextEligible: timestamp('next_eligible', { withTimezone: true }),
		failureCategory: varchar('failure_category', { length: 50 }),
		seasonPackFailed: boolean('season_pack_failed').notNull().default(false), // Track if season pack search failed for fallback to individual episodes
		backlogTier: integer('backlog_tier').notNull().default(0), // 0 = normal retry, 1-5 = backlog tiers with extended delays
		priority: integer('priority').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('search_registry_content_idx').on(
			table.connectorId,
			table.contentType,
			table.contentId
		),
		index('search_registry_state_idx').on(table.connectorId, table.state),
		index('search_registry_eligible_idx').on(table.state, table.nextEligible)
	]
);

// =============================================================================
// Request Queue Table
// =============================================================================

export const requestQueue = pgTable(
	'request_queue',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		searchRegistryId: integer('search_registry_id')
			.notNull()
			.references(() => searchRegistry.id, { onDelete: 'cascade' }),
		connectorId: integer('connector_id')
			.notNull()
			.references(() => connectors.id, { onDelete: 'cascade' }),
		batchId: varchar('batch_id', { length: 50 }),
		priority: integer('priority').notNull().default(0),
		scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('request_queue_priority_idx').on(
			table.connectorId,
			table.priority.desc(),
			table.scheduledAt
		)
	]
);

// =============================================================================
// Search History Table
// =============================================================================

export const searchHistory = pgTable(
	'search_history',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		searchRegistryId: integer('search_registry_id').references(() => searchRegistry.id, {
			onDelete: 'set null'
		}),
		connectorId: integer('connector_id')
			.notNull()
			.references(() => connectors.id, { onDelete: 'cascade' }),
		contentType: varchar('content_type', { length: 20 }).notNull(),
		contentId: integer('content_id').notNull(),
		outcome: varchar('outcome', { length: 50 }).notNull(), // 'success' | 'no_results' | 'error' | 'timeout'
		metadata: jsonb('metadata'), // Additional outcome details
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('search_history_connector_idx').on(table.connectorId, table.createdAt.desc()),
		index('search_history_content_idx').on(table.contentType, table.contentId)
	]
);

// =============================================================================
// Sync State Table
// =============================================================================

export const syncState = pgTable('sync_state', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	connectorId: integer('connector_id')
		.notNull()
		.references(() => connectors.id, { onDelete: 'cascade' })
		.unique(),
	lastSync: timestamp('last_sync', { withTimezone: true }),
	lastReconciliation: timestamp('last_reconciliation', { withTimezone: true }),
	cursor: jsonb('cursor'), // Pagination/incremental sync cursor
	consecutiveFailures: integer('consecutive_failures').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// =============================================================================
// Users Table
// =============================================================================

export const users = pgTable('users', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	username: varchar('username', { length: 100 }).notNull().unique(),
	passwordHash: text('password_hash').notNull(), // Argon2id hash
	displayName: varchar('display_name', { length: 100 }),
	role: varchar('role', { length: 20 }).notNull().default('user'), // 'admin' | 'user'

	// Account lockout fields
	failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
	lockedUntil: timestamp('locked_until', { withTimezone: true }),
	lastFailedLogin: timestamp('last_failed_login', { withTimezone: true }),

	// Audit timestamps
	lastLogin: timestamp('last_login', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// =============================================================================
// Sessions Table
// =============================================================================

export const sessions = pgTable(
	'sessions',
	{
		id: varchar('id', { length: 64 }).primaryKey(), // Secure random hex token
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }).notNull().defaultNow(),
		userAgent: varchar('user_agent', { length: 500 }),
		ipAddress: varchar('ip_address', { length: 45 }) // IPv6 max length
	},
	(table) => [
		index('sessions_user_idx').on(table.userId),
		index('sessions_expires_idx').on(table.expiresAt)
	]
);

// =============================================================================
// API Keys Table
// =============================================================================

/**
 * Stores API keys for programmatic access to Comradarr.
 * Keys are hashed (not encrypted) since they cannot be recovered - shown only once at creation.
 * Follows industry best practices (GitHub, AWS pattern) for API key management.
 */
export const apiKeys = pgTable(
	'api_keys',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: varchar('name', { length: 100 }).notNull(),
		description: text('description'),
		scope: varchar('scope', { length: 20 }).notNull().default('read'), // 'read' | 'full'
		keyPrefix: varchar('key_prefix', { length: 8 }).notNull(), // First 8 chars for UI identification
		keyHash: text('key_hash').notNull(), // Argon2id hash of full key
		rateLimitPerMinute: integer('rate_limit_per_minute'), // null = unlimited
		expiresAt: timestamp('expires_at', { withTimezone: true }), // null = never expires
		revokedAt: timestamp('revoked_at', { withTimezone: true }), // null = active, set = revoked
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('api_keys_user_idx').on(table.userId),
		index('api_keys_prefix_idx').on(table.keyPrefix)
	]
);

// =============================================================================
// API Key Usage Logs Table
// =============================================================================

/**
 * Logs API key usage for auditing and debugging.
 * Records key identifier, endpoint, method, and timestamp.
 */
export const apiKeyUsageLogs = pgTable(
	'api_key_usage_logs',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		apiKeyId: integer('api_key_id')
			.notNull()
			.references(() => apiKeys.id, { onDelete: 'cascade' }),
		endpoint: varchar('endpoint', { length: 500 }).notNull(),
		method: varchar('method', { length: 10 }).notNull(),
		statusCode: integer('status_code'),
		responseTimeMs: integer('response_time_ms'),
		ipAddress: varchar('ip_address', { length: 45 }), // IPv6 max length
		userAgent: varchar('user_agent', { length: 500 }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('api_key_usage_logs_key_idx').on(table.apiKeyId),
		index('api_key_usage_logs_created_idx').on(table.createdAt)
	]
);

// =============================================================================
// API Key Rate Limit State Table
// =============================================================================

/**
 * Tracks runtime rate-limiting state per API key.
 * Similar to throttleState but for external API access rather than connector operations.
 */
export const apiKeyRateLimitState = pgTable(
	'api_key_rate_limit_state',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		apiKeyId: integer('api_key_id')
			.notNull()
			.references(() => apiKeys.id, { onDelete: 'cascade' })
			.unique(),
		requestsThisMinute: integer('requests_this_minute').notNull().default(0),
		minuteWindowStart: timestamp('minute_window_start', { withTimezone: true }),
		lastRequestAt: timestamp('last_request_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [index('api_key_rate_limit_state_api_key_idx').on(table.apiKeyId)]
);

// =============================================================================
// Prowlarr Instances Table
// =============================================================================

export const prowlarrInstances = pgTable('prowlarr_instances', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	name: varchar('name', { length: 100 }).notNull(),
	url: varchar('url', { length: 500 }).notNull(),
	apiKeyEncrypted: text('api_key_encrypted').notNull(), // AES-256-GCM encrypted
	enabled: boolean('enabled').notNull().default(true),
	healthStatus: varchar('health_status', { length: 20 }).notNull().default('unknown'), // 'healthy' | 'degraded' | 'unhealthy' | 'offline' | 'unknown'
	lastHealthCheck: timestamp('last_health_check', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// =============================================================================
// Prowlarr Indexer Health Cache Table
// =============================================================================

export const prowlarrIndexerHealth = pgTable(
	'prowlarr_indexer_health',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		prowlarrInstanceId: integer('prowlarr_instance_id')
			.notNull()
			.references(() => prowlarrInstances.id, { onDelete: 'cascade' }),
		indexerId: integer('indexer_id').notNull(), // Prowlarr's indexer ID
		name: varchar('name', { length: 200 }).notNull(),
		enabled: boolean('enabled').notNull(),
		isRateLimited: boolean('is_rate_limited').notNull().default(false),
		rateLimitExpiresAt: timestamp('rate_limit_expires_at', { withTimezone: true }),
		mostRecentFailure: timestamp('most_recent_failure', { withTimezone: true }),
		lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Unique constraint: one entry per indexer per instance
		uniqueIndex('prowlarr_indexer_health_instance_indexer_idx').on(
			table.prowlarrInstanceId,
			table.indexerId
		),
		// Index for finding rate-limited indexers
		index('prowlarr_indexer_health_rate_limited_idx').on(
			table.prowlarrInstanceId,
			table.isRateLimited
		)
	]
);

// =============================================================================
// Type Exports (Drizzle inference)
// =============================================================================

export type ThrottleProfile = typeof throttleProfiles.$inferSelect;
export type NewThrottleProfile = typeof throttleProfiles.$inferInsert;

export type Connector = typeof connectors.$inferSelect;
export type NewConnector = typeof connectors.$inferInsert;

export type ThrottleState = typeof throttleState.$inferSelect;
export type NewThrottleState = typeof throttleState.$inferInsert;

export type Series = typeof series.$inferSelect;
export type NewSeries = typeof series.$inferInsert;

export type Season = typeof seasons.$inferSelect;
export type NewSeason = typeof seasons.$inferInsert;

export type Episode = typeof episodes.$inferSelect;
export type NewEpisode = typeof episodes.$inferInsert;

export type Movie = typeof movies.$inferSelect;
export type NewMovie = typeof movies.$inferInsert;

export type SearchRegistry = typeof searchRegistry.$inferSelect;
export type NewSearchRegistry = typeof searchRegistry.$inferInsert;

export type RequestQueue = typeof requestQueue.$inferSelect;
export type NewRequestQueue = typeof requestQueue.$inferInsert;

export type SearchHistory = typeof searchHistory.$inferSelect;
export type NewSearchHistory = typeof searchHistory.$inferInsert;

export type SyncState = typeof syncState.$inferSelect;
export type NewSyncState = typeof syncState.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type ApiKeyUsageLog = typeof apiKeyUsageLogs.$inferSelect;
export type NewApiKeyUsageLog = typeof apiKeyUsageLogs.$inferInsert;

export type ApiKeyRateLimitState = typeof apiKeyRateLimitState.$inferSelect;
export type NewApiKeyRateLimitState = typeof apiKeyRateLimitState.$inferInsert;

export type ProwlarrInstance = typeof prowlarrInstances.$inferSelect;
export type NewProwlarrInstance = typeof prowlarrInstances.$inferInsert;

export type ProwlarrIndexerHealth = typeof prowlarrIndexerHealth.$inferSelect;
export type NewProwlarrIndexerHealth = typeof prowlarrIndexerHealth.$inferInsert;

// =============================================================================
// Notification Channels Table
// =============================================================================

/**
 * Stores notification channel configurations for various notification providers.
 * Supports Discord, Telegram, Slack, Pushover, Gotify, ntfy, email, and webhooks.
 * Sensitive credentials are encrypted using AES-256-GCM.
 */
export const notificationChannels = pgTable(
	'notification_channels',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		name: varchar('name', { length: 100 }).notNull(),
		type: varchar('type', { length: 20 }).notNull(), // 'discord' | 'telegram' | 'slack' | 'pushover' | 'gotify' | 'ntfy' | 'email' | 'webhook'
		config: jsonb('config'), // Non-sensitive configuration (e.g., topic URL, server URL, SMTP settings)
		configEncrypted: text('config_encrypted'), // AES-256-GCM encrypted sensitive credentials (API keys, tokens, passwords)
		enabled: boolean('enabled').notNull().default(true),
		enabledEvents: jsonb('enabled_events'), // Array of event types to notify on (e.g., ['sweep_completed', 'search_success'])
		// Batching configuration
		batchingEnabled: boolean('batching_enabled').notNull().default(false),
		batchingWindowSeconds: integer('batching_window_seconds').notNull().default(60),
		// Quiet hours configuration
		quietHoursEnabled: boolean('quiet_hours_enabled').notNull().default(false),
		quietHoursStart: varchar('quiet_hours_start', { length: 5 }), // HH:MM format (e.g., '22:00')
		quietHoursEnd: varchar('quiet_hours_end', { length: 5 }), // HH:MM format (e.g., '08:00')
		quietHoursTimezone: varchar('quiet_hours_timezone', { length: 50 }).default('UTC'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Index for querying enabled channels by type
		index('notification_channels_type_enabled_idx').on(table.type, table.enabled)
	]
);

export type NotificationChannel = typeof notificationChannels.$inferSelect;
export type NewNotificationChannel = typeof notificationChannels.$inferInsert;

// =============================================================================
// Notification History Table
// =============================================================================

/**
 * Tracks sent notifications and their outcomes.
 * Used for debugging, retry logic, and batching related notifications.
 */
export const notificationHistory = pgTable(
	'notification_history',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		channelId: integer('channel_id')
			.notNull()
			.references(() => notificationChannels.id, { onDelete: 'cascade' }),
		eventType: varchar('event_type', { length: 50 }).notNull(), // 'sweep_started' | 'sweep_completed' | 'search_success' | etc.
		eventData: jsonb('event_data'), // Full event payload
		status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'sent' | 'failed' | 'batched'
		sentAt: timestamp('sent_at', { withTimezone: true }),
		errorMessage: text('error_message'), // Error details if failed
		batchId: varchar('batch_id', { length: 50 }), // Groups batched notifications together
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Index for querying notification history by channel
		index('notification_history_channel_idx').on(table.channelId, table.createdAt.desc()),
		// Index for querying by status (e.g., finding pending notifications)
		index('notification_history_status_idx').on(table.status, table.createdAt),
		// Index for batch grouping
		index('notification_history_batch_idx').on(table.batchId)
	]
);

export type NotificationHistory = typeof notificationHistory.$inferSelect;
export type NewNotificationHistory = typeof notificationHistory.$inferInsert;

// =============================================================================
// Completion Snapshots Table
// =============================================================================

/**
 * Stores periodic library completion snapshots for trend visualization.
 * Captured daily by scheduler job for sparkline display on dashboard.
 */
export const completionSnapshots = pgTable(
	'completion_snapshots',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		connectorId: integer('connector_id')
			.notNull()
			.references(() => connectors.id, { onDelete: 'cascade' }),
		capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
		// Episode stats (for Sonarr/Whisparr)
		episodesMonitored: integer('episodes_monitored').notNull().default(0),
		episodesDownloaded: integer('episodes_downloaded').notNull().default(0),
		// Movie stats (for Radarr)
		moviesMonitored: integer('movies_monitored').notNull().default(0),
		moviesDownloaded: integer('movies_downloaded').notNull().default(0),
		// Computed completion percentage stored as basis points (0-10000) for precision
		completionPercentage: integer('completion_percentage').notNull().default(0)
	},
	(table) => [
		// Index for querying recent snapshots per connector (most recent first)
		index('completion_snapshots_connector_time_idx').on(table.connectorId, table.capturedAt.desc()),
		// Unique constraint to prevent duplicate snapshots at same timestamp
		uniqueIndex('completion_snapshots_connector_captured_idx').on(
			table.connectorId,
			table.capturedAt
		)
	]
);

export type CompletionSnapshot = typeof completionSnapshots.$inferSelect;
export type NewCompletionSnapshot = typeof completionSnapshots.$inferInsert;

// =============================================================================
// Sweep Schedules Table
// =============================================================================

/**
 * Stores per-connector sweep schedule configurations.
 * Allows configurable cron-based sweep cycles with enable/disable per schedule.
 */
export const sweepSchedules = pgTable(
	'sweep_schedules',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		connectorId: integer('connector_id').references(() => connectors.id, {
			onDelete: 'cascade'
		}), // null = global schedule for all connectors
		name: varchar('name', { length: 100 }).notNull(),
		sweepType: varchar('sweep_type', { length: 30 }).notNull(), // 'incremental' | 'full_reconciliation'
		cronExpression: varchar('cron_expression', { length: 100 }).notNull(),
		timezone: varchar('timezone', { length: 50 }).notNull().default('UTC'),
		enabled: boolean('enabled').notNull().default(true),
		throttleProfileId: integer('throttle_profile_id').references(() => throttleProfiles.id, {
			onDelete: 'set null'
		}),
		lastRunAt: timestamp('last_run_at', { withTimezone: true }),
		nextRunAt: timestamp('next_run_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Index for finding schedules by connector
		index('sweep_schedules_connector_idx').on(table.connectorId),
		// Index for finding enabled schedules
		index('sweep_schedules_enabled_idx').on(table.enabled)
	]
);

export type SweepSchedule = typeof sweepSchedules.$inferSelect;
export type NewSweepSchedule = typeof sweepSchedules.$inferInsert;

// =============================================================================
// Analytics Events Table
// =============================================================================

/**
 * Stores raw analytics events for detailed analysis and time-series tracking.
 * Events include gap/upgrade discoveries, search operations, sync events, etc.
 */
export const analyticsEvents = pgTable(
	'analytics_events',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		connectorId: integer('connector_id').references(() => connectors.id, {
			onDelete: 'cascade'
		}), // null = system-wide events
		eventType: varchar('event_type', { length: 50 }).notNull(), // 'gap_discovered' | 'upgrade_discovered' | 'search_dispatched' | 'search_completed' | 'search_failed' | 'search_no_results' | 'queue_depth_sampled' | 'sync_completed' | 'sync_failed'
		eventData: jsonb('event_data'), // Event-specific payload (e.g., contentId, responseTimeMs, errorMessage)
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Index for time-series queries by event type
		index('analytics_events_type_time_idx').on(table.eventType, table.createdAt.desc()),
		// Index for connector-specific analytics
		index('analytics_events_connector_time_idx').on(table.connectorId, table.createdAt.desc()),
		// Index for querying events by date range (for CSV export)
		index('analytics_events_created_idx').on(table.createdAt)
	]
);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;

// =============================================================================
// Analytics Hourly Statistics Table
// =============================================================================

/**
 * Pre-computed hourly statistics per connector for efficient time-series queries.
 * Updated by analytics collector service, used for dashboard charts and comparisons.
 */
export const analyticsHourlyStats = pgTable(
	'analytics_hourly_stats',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		connectorId: integer('connector_id')
			.notNull()
			.references(() => connectors.id, { onDelete: 'cascade' }),
		hourBucket: timestamp('hour_bucket', { withTimezone: true }).notNull(), // Truncated to hour
		// Discovery metrics
		gapsDiscovered: integer('gaps_discovered').notNull().default(0),
		upgradesDiscovered: integer('upgrades_discovered').notNull().default(0),
		// Search volume metrics
		searchesDispatched: integer('searches_dispatched').notNull().default(0),
		searchesSuccessful: integer('searches_successful').notNull().default(0),
		searchesFailed: integer('searches_failed').notNull().default(0),
		searchesNoResults: integer('searches_no_results').notNull().default(0),
		// Queue metrics
		avgQueueDepth: integer('avg_queue_depth').notNull().default(0),
		peakQueueDepth: integer('peak_queue_depth').notNull().default(0),
		// Response time metrics (for connector comparison)
		avgResponseTimeMs: integer('avg_response_time_ms'),
		maxResponseTimeMs: integer('max_response_time_ms'),
		// Error rate tracking
		errorCount: integer('error_count').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Unique constraint: one row per connector per hour
		uniqueIndex('analytics_hourly_stats_connector_hour_idx').on(
			table.connectorId,
			table.hourBucket
		),
		// Index for time-series queries (most recent first)
		index('analytics_hourly_stats_time_idx').on(table.hourBucket.desc()),
		// Index for connector comparison queries
		index('analytics_hourly_stats_connector_idx').on(table.connectorId, table.hourBucket.desc())
	]
);

export type AnalyticsHourlyStat = typeof analyticsHourlyStats.$inferSelect;
export type NewAnalyticsHourlyStat = typeof analyticsHourlyStats.$inferInsert;

// =============================================================================
// Analytics Daily Statistics Table
// =============================================================================

/**
 * Rolled-up daily statistics for long-term trend analysis and CSV export.
 * Aggregated from hourly stats or raw events by maintenance job.
 */
export const analyticsDailyStats = pgTable(
	'analytics_daily_stats',
	{
		id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
		connectorId: integer('connector_id')
			.notNull()
			.references(() => connectors.id, { onDelete: 'cascade' }),
		dateBucket: timestamp('date_bucket', { withTimezone: true }).notNull(), // Truncated to day (midnight UTC)
		// Discovery metrics
		gapsDiscovered: integer('gaps_discovered').notNull().default(0),
		upgradesDiscovered: integer('upgrades_discovered').notNull().default(0),
		// Search volume metrics
		searchesDispatched: integer('searches_dispatched').notNull().default(0),
		searchesSuccessful: integer('searches_successful').notNull().default(0),
		searchesFailed: integer('searches_failed').notNull().default(0),
		searchesNoResults: integer('searches_no_results').notNull().default(0),
		// Queue metrics
		avgQueueDepth: integer('avg_queue_depth').notNull().default(0),
		peakQueueDepth: integer('peak_queue_depth').notNull().default(0),
		// Response time metrics
		avgResponseTimeMs: integer('avg_response_time_ms'),
		maxResponseTimeMs: integer('max_response_time_ms'),
		// Error rate tracking
		errorCount: integer('error_count').notNull().default(0),
		// Library completion snapshot (denormalized for export convenience)
		completionPercentage: integer('completion_percentage'), // 0-10000 basis points
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		// Unique constraint: one row per connector per day
		uniqueIndex('analytics_daily_stats_connector_date_idx').on(table.connectorId, table.dateBucket),
		// Index for date range queries (CSV export)
		index('analytics_daily_stats_date_idx').on(table.dateBucket.desc()),
		// Index for connector-specific queries
		index('analytics_daily_stats_connector_idx').on(table.connectorId, table.dateBucket.desc())
	]
);

export type AnalyticsDailyStat = typeof analyticsDailyStats.$inferSelect;
export type NewAnalyticsDailyStat = typeof analyticsDailyStats.$inferInsert;

// =============================================================================
// App Settings Table
// =============================================================================

/**
 * Stores application-wide configuration settings as key-value pairs.
 * Used for general settings like app name, timezone, log level, and update preferences.
 */
export const appSettings = pgTable('app_settings', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	key: varchar('key', { length: 100 }).notNull().unique(),
	value: text('value').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export type AppSetting = typeof appSettings.$inferSelect;
export type NewAppSetting = typeof appSettings.$inferInsert;
