/**
 * API response parsers for Radarr using Valibot for runtime validation.
 *
 * Provides type-safe parsing with graceful error handling for:
 * - Movie responses (Requirement 27.4)
 *
 * Design:
 * - Unknown fields are ignored (Requirement 27.7)
 * - Malformed records return errors instead of throwing (Requirement 27.8)
 *
 * @module connectors/radarr/parsers
 * @requirements 27.4, 27.7, 27.8
 */

import * as v from 'valibot';
import type { PaginatedResponse } from '../common/types';
import {
	type ParseResult,
	createPaginatedResponseSchema,
	QualityModelSchema
} from '../common/parsers';
import type { RadarrMovie, RadarrMovieFile } from './types';

// =============================================================================
// Valibot Schemas
// =============================================================================

/**
 * Schema for movie file information
 */
export const RadarrMovieFileSchema = v.object({
	id: v.number(),
	quality: QualityModelSchema,
	size: v.number(),
	relativePath: v.optional(v.string())
});

/**
 * Valibot schema for Radarr movie response
 * GET /api/v3/movie
 *
 * Required fields per Requirement 27.4:
 * - id, title, tmdbId, imdbId, year, hasFile, qualityCutoffNotMet
 *
 * @requirements 27.4
 */
export const RadarrMovieSchema = v.object({
	id: v.number(),
	title: v.string(),
	tmdbId: v.number(),
	imdbId: v.optional(v.string()),
	year: v.number(),
	hasFile: v.boolean(),
	monitored: v.boolean(),
	qualityCutoffNotMet: v.boolean(),
	movieFileId: v.optional(v.number()),
	movieFile: v.optional(RadarrMovieFileSchema),
	status: v.optional(v.string())
});

// =============================================================================
// Parser Functions
// =============================================================================

/**
 * Parses a Radarr movie response from an unknown API response value.
 *
 * @param data - Unknown data from API response
 * @returns ParseResult with typed RadarrMovie or error details
 *
 * @requirements 27.4, 27.7, 27.8
 *
 * @example
 * ```typescript
 * const result = parseRadarrMovie(apiResponse);
 * if (result.success) {
 *   console.log(`Movie: ${result.data.title} (${result.data.year})`);
 * } else {
 *   console.warn('Malformed movie:', result.error);
 * }
 * ```
 */
export function parseRadarrMovie(data: unknown): ParseResult<RadarrMovie> {
	const result = v.safeParse(RadarrMovieSchema, data);

	if (result.success) {
		// Map to RadarrMovie type, handling optional fields
		const output = result.output;
		const movie: RadarrMovie = {
			id: output.id,
			title: output.title,
			tmdbId: output.tmdbId,
			year: output.year,
			hasFile: output.hasFile,
			monitored: output.monitored,
			qualityCutoffNotMet: output.qualityCutoffNotMet,
			// Conditionally include optional properties only when defined
			...(output.imdbId !== undefined && { imdbId: output.imdbId }),
			...(output.movieFileId !== undefined && { movieFileId: output.movieFileId }),
			...(output.movieFile !== undefined && {
				movieFile: output.movieFile as RadarrMovieFile
			}),
			...(output.status !== undefined && { status: output.status })
		};
		return { success: true, data: movie };
	}

	return {
		success: false,
		error: `Invalid Radarr movie response: ${result.issues.map((i) => i.message).join(', ')}`,
		issues: result.issues
	};
}

/**
 * Parses a paginated movie response from Radarr API.
 * Used for /api/v3/wanted/missing and /api/v3/wanted/cutoff endpoints.
 *
 * @param data - Unknown data from API response
 * @returns ParseResult with typed PaginatedResponse<RadarrMovie> or error details
 *
 * @requirements 27.1, 27.4, 27.7, 27.8
 *
 * @example
 * ```typescript
 * const result = parsePaginatedMovies(apiResponse);
 * if (result.success) {
 *   console.log(`Found ${result.data.totalRecords} movies`);
 *   for (const movie of result.data.records) {
 *     console.log(`${movie.title} (${movie.year})`);
 *   }
 * }
 * ```
 */
export function parsePaginatedMovies(
	data: unknown
): ParseResult<PaginatedResponse<RadarrMovie>> {
	const schema = createPaginatedResponseSchema(RadarrMovieSchema);
	const result = v.safeParse(schema, data);

	if (result.success) {
		const output = result.output;
		const paginatedResponse: PaginatedResponse<RadarrMovie> = {
			page: output.page,
			pageSize: output.pageSize,
			sortKey: output.sortKey ?? '',
			sortDirection: output.sortDirection ?? 'ascending',
			totalRecords: output.totalRecords,
			records: output.records.map((record) => {
				// Map each record to RadarrMovie with proper optional handling
				const movie: RadarrMovie = {
					id: record.id,
					title: record.title,
					tmdbId: record.tmdbId,
					year: record.year,
					hasFile: record.hasFile,
					monitored: record.monitored,
					qualityCutoffNotMet: record.qualityCutoffNotMet,
					...(record.imdbId !== undefined && { imdbId: record.imdbId }),
					...(record.movieFileId !== undefined && { movieFileId: record.movieFileId }),
					...(record.movieFile !== undefined && {
						movieFile: record.movieFile as RadarrMovieFile
					}),
					...(record.status !== undefined && { status: record.status })
				};
				return movie;
			})
		};
		return { success: true, data: paginatedResponse };
	}

	return {
		success: false,
		error: `Invalid paginated movies response: ${result.issues.map((i) => i.message).join(', ')}`,
		issues: result.issues
	};
}
