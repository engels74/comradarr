/**
 * API response parsers for Radarr using Valibot for runtime validation.
 *
 * Provides type-safe parsing with graceful error handling for movie responses.
 * Unknown fields are ignored and malformed records return errors instead of throwing.
 *
 * @module connectors/radarr/parsers
 */

import * as v from 'valibot';
import {
	createPaginatedResponseSchema,
	type LenientParseResult,
	type ParseResult,
	parsePaginatedResponseLenient,
	QualityModelSchema
} from '../common/parsers';
import type { PaginatedResponse } from '../common/types';
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
 * Valibot schema for Radarr movie response (GET /api/v3/movie).
 * Required: id, title, tmdbId, imdbId, year, hasFile, qualityCutoffNotMet
 */
export const RadarrMovieSchema = v.object({
	id: v.number(),
	title: v.string(),
	tmdbId: v.number(),
	imdbId: v.optional(v.string()),
	year: v.number(),
	hasFile: v.boolean(),
	monitored: v.boolean(),
	qualityCutoffNotMet: v.optional(v.nullable(v.boolean())),
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
			// qualityCutoffNotMet may be undefined (missing) or null (no file)
			qualityCutoffNotMet: output.qualityCutoffNotMet ?? null,
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
export function parsePaginatedMovies(data: unknown): ParseResult<PaginatedResponse<RadarrMovie>> {
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
					// qualityCutoffNotMet may be undefined (missing) or null (no file)
					qualityCutoffNotMet: record.qualityCutoffNotMet ?? null,
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

// =============================================================================
// Lenient Parser Functions
// =============================================================================

/**
 * Parses a paginated movies response leniently, skipping malformed records.
 * Use this when you want to continue processing even if some movie records are invalid.
 *
 * @param data - Unknown data from API response
 * @param onInvalid - Optional callback for invalid records (for logging warnings)
 * @returns LenientParseResult with typed PaginatedResponse<RadarrMovie>, skipped count, or error
 *

 *
 * @example
 * ```typescript
 * const result = parsePaginatedMoviesLenient(
 *   apiResponse,
 *   (record, error) => console.warn('Skipping malformed movie:', error)
 * );
 * if (result.success) {
 *   console.log(`Parsed ${result.data.records.length} movies, skipped ${result.skipped}`);
 * }
 * ```
 */
export function parsePaginatedMoviesLenient(
	data: unknown,
	onInvalid?: (record: unknown, error: string) => void
): LenientParseResult<PaginatedResponse<RadarrMovie>> {
	const result = parsePaginatedResponseLenient(data, RadarrMovieSchema, onInvalid);
	// Type assertion needed due to exactOptionalPropertyTypes - Valibot infers
	// optional fields as `Type | undefined` but our types use `property?: Type`
	return result as LenientParseResult<PaginatedResponse<RadarrMovie>>;
}
