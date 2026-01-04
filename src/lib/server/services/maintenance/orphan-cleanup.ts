/**
 * Orphan cleanup service for search state maintenance.
 *
 * Deletes search_registry entries that reference content_id values
 * that no longer exist in the episodes or movies tables.
 *
 * This can happen if:
 * - Content was deleted directly without proper cleanup
 * - Edge cases during reconciliation
 * - Race conditions between sync and search operations
 *
 * @module services/maintenance/orphan-cleanup

 */

import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { createLogger } from '$lib/server/logger';
import type { OrphanCleanupResult } from './types';

const logger = createLogger('orphan-cleanup');

// =============================================================================
// Public API
// =============================================================================

/**
 * Clean up orphaned search registry entries.
 *
 * Deletes search_registry entries where:
 * - content_type = 'episode' AND contentId doesn't exist in episodes table
 * - content_type = 'movie' AND contentId doesn't exist in movies table
 *
 * Note: request_queue entries will cascade delete automatically (FK to search_registry).
 * search_history entries will have search_registry_id set to null (FK with SET NULL).
 *
 * @returns Result with count of deleted orphans and timing metrics
 *
 * @example
 * ```typescript
 * const result = await cleanupOrphanedSearchState();
 * if (result.success) {
 *   console.log(`Cleaned up ${result.totalOrphansDeleted} orphaned entries`);
 * }
 * ```
 */
export async function cleanupOrphanedSearchState(): Promise<OrphanCleanupResult> {
	const startTime = Date.now();
	let episodeOrphansDeleted = 0;
	let movieOrphansDeleted = 0;

	try {
		logger.info('Starting orphan cleanup');

		// 1. Delete orphaned episode search registries
		// These are entries where content_type = 'episode' but the referenced
		// episode no longer exists in the episodes table
		const episodeResult = await db.execute(sql`
			DELETE FROM search_registry sr
			WHERE sr.content_type = 'episode'
			  AND NOT EXISTS (
				SELECT 1 FROM episodes e
				WHERE e.id = sr.content_id
				  AND e.connector_id = sr.connector_id
			  )
			RETURNING sr.id
		`);
		episodeOrphansDeleted = episodeResult.length;

		if (episodeOrphansDeleted > 0) {
			logger.info('Deleted orphaned episode registries', {
				count: episodeOrphansDeleted
			});
		}

		// 2. Delete orphaned movie search registries
		// These are entries where content_type = 'movie' but the referenced
		// movie no longer exists in the movies table
		const movieResult = await db.execute(sql`
			DELETE FROM search_registry sr
			WHERE sr.content_type = 'movie'
			  AND NOT EXISTS (
				SELECT 1 FROM movies m
				WHERE m.id = sr.content_id
				  AND m.connector_id = sr.connector_id
			  )
			RETURNING sr.id
		`);
		movieOrphansDeleted = movieResult.length;

		if (movieOrphansDeleted > 0) {
			logger.info('Deleted orphaned movie registries', {
				count: movieOrphansDeleted
			});
		}

		const totalOrphansDeleted = episodeOrphansDeleted + movieOrphansDeleted;
		const durationMs = Date.now() - startTime;

		if (totalOrphansDeleted > 0) {
			logger.info('Orphan cleanup completed', {
				episodeOrphansDeleted,
				movieOrphansDeleted,
				totalOrphansDeleted,
				durationMs
			});
		} else {
			logger.info('No orphaned entries found');
		}

		return {
			success: true,
			episodeOrphansDeleted,
			movieOrphansDeleted,
			totalOrphansDeleted,
			durationMs
		};
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		logger.error('Orphan cleanup failed', {
			error: errorMessage,
			episodeOrphansDeleted,
			movieOrphansDeleted,
			durationMs
		});

		return {
			success: false,
			episodeOrphansDeleted,
			movieOrphansDeleted,
			totalOrphansDeleted: episodeOrphansDeleted + movieOrphansDeleted,
			durationMs,
			error: errorMessage
		};
	}
}
