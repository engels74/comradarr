/**
 * Core database schema for Comradarr
 *
 * Tables defined:
 * - throttleProfiles: Rate-limiting configuration presets (Requirements 7.1, 7.5)
 * - connectors: *arr application connections with encrypted API keys
 * - throttleState: Runtime rate-limiting state per connector (Requirements 7.1, 7.4)
 * - series, seasons, episodes: Sonarr/Whisparr content mirror
 * - movies: Radarr content mirror
 * - searchRegistry, requestQueue, searchHistory: Search state tracking
 * - syncState: Sync tracking per connector
 * - users, sessions: Authentication (Requirements 10.1, 10.2)
 *
 * Requirements: 7.1, 7.4, 7.5, 10.1, 10.2, 14.1, 14.2, 14.3
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
// Throttle Profiles Table (Requirements 7.1, 7.5)
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
// Throttle State Table (Requirements 7.1, 7.4)
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
// Episodes Table (Requirement 14.1)
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
		// Requirement 14.3: Indexes for efficient gap and upgrade queries
		index('episodes_gap_idx').on(table.connectorId, table.hasFile),
		index('episodes_upgrade_idx').on(table.connectorId, table.qualityCutoffNotMet)
	]
);

// =============================================================================
// Movies Table (Requirement 14.2)
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
		// Requirement 14.3: Indexes for efficient gap and upgrade queries
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
		seasonPackFailed: boolean('season_pack_failed').notNull().default(false), // Requirement 6.5: Track if season pack search failed for fallback to individual episodes
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
// Users Table (Requirements 10.1, 10.2)
// =============================================================================

export const users = pgTable('users', {
	id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
	username: varchar('username', { length: 100 }).notNull().unique(),
	passwordHash: text('password_hash').notNull(), // Argon2id hash
	displayName: varchar('display_name', { length: 100 }),
	role: varchar('role', { length: 20 }).notNull().default('user'), // 'admin' | 'user'

	// Account lockout fields (for Requirements 35.1-35.5, logic implemented later)
	failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
	lockedUntil: timestamp('locked_until', { withTimezone: true }),
	lastFailedLogin: timestamp('last_failed_login', { withTimezone: true }),

	// Audit timestamps
	lastLogin: timestamp('last_login', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

// =============================================================================
// Sessions Table (Requirements 10.1, 10.2)
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
