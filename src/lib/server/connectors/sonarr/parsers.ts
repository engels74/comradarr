/**
 * API response parsers for Sonarr using Valibot for runtime validation.
 *
 * Provides type-safe parsing with graceful error handling for:
 * - Series responses (Requirement 27.2)
 * - Episode responses (Requirement 27.3)
 *
 * Design:
 * - Unknown fields are ignored (Requirement 27.7)
 * - Malformed records return errors instead of throwing (Requirement 27.8)
 *
 * @module connectors/sonarr/parsers

 */

import * as v from 'valibot';
import type { PaginatedResponse } from '../common/types';
import {
	type ParseResult,
	type LenientParseResult,
	createPaginatedResponseSchema,
	QualityModelSchema,
	parsePaginatedResponseLenient
} from '../common/parsers';
import type {
	SonarrSeries,
	SonarrSeason,
	SonarrSeasonStatistics,
	SonarrSeriesStatistics,
	SonarrEpisode,
	SonarrEpisodeFile
} from './types';

// =============================================================================
// Valibot Schemas
// =============================================================================

/**
 * Schema for season statistics within a series response
 */
export const SonarrSeasonStatisticsSchema = v.object({
	episodeFileCount: v.number(),
	episodeCount: v.number(),
	totalEpisodeCount: v.number(),
	sizeOnDisk: v.number(),
	percentOfEpisodes: v.number()
});

/**
 * Schema for a season within a series response
 */
export const SonarrSeasonSchema = v.object({
	seasonNumber: v.number(),
	monitored: v.boolean(),
	statistics: v.optional(SonarrSeasonStatisticsSchema)
});

/**
 * Schema for series statistics
 */
export const SonarrSeriesStatisticsSchema = v.object({
	seasonCount: v.number(),
	episodeFileCount: v.number(),
	episodeCount: v.number(),
	sizeOnDisk: v.number(),
	percentOfEpisodes: v.number()
});

/**
 * Valibot schema for Sonarr series response
 * GET /api/v3/series
 *
 * Required fields per Requirement 27.2:
 * - id, title, tvdbId, status, seasons array, statistics
 *

 */
export const SonarrSeriesSchema = v.object({
	id: v.number(),
	title: v.string(),
	tvdbId: v.number(),
	status: v.string(),
	monitored: v.boolean(),
	qualityProfileId: v.number(),
	seasons: v.array(SonarrSeasonSchema),
	statistics: v.optional(SonarrSeriesStatisticsSchema)
});

/**
 * Schema for episode file information
 */
export const SonarrEpisodeFileSchema = v.object({
	id: v.number(),
	quality: QualityModelSchema,
	size: v.number(),
	relativePath: v.optional(v.string())
});

/**
 * Valibot schema for Sonarr episode response
 * GET /api/v3/episode or GET /api/v3/wanted/missing
 *
 * Required fields per Requirement 27.3:
 * - id, seriesId, seasonNumber, episodeNumber, hasFile, airDateUtc, qualityCutoffNotMet
 *

 */
export const SonarrEpisodeSchema = v.object({
	id: v.number(),
	seriesId: v.number(),
	seasonNumber: v.number(),
	episodeNumber: v.number(),
	title: v.optional(v.string()),
	airDateUtc: v.optional(v.string()),
	hasFile: v.boolean(),
	monitored: v.boolean(),
	qualityCutoffNotMet: v.boolean(),
	episodeFileId: v.optional(v.number()),
	episodeFile: v.optional(SonarrEpisodeFileSchema)
});

// =============================================================================
// Parser Functions
// =============================================================================

/**
 * Parses a Sonarr series response from an unknown API response value.
 *
 * @param data - Unknown data from API response
 * @returns ParseResult with typed SonarrSeries or error details
 *

 *
 * @example
 * ```typescript
 * const result = parseSonarrSeries(apiResponse);
 * if (result.success) {
 *   console.log(`Series: ${result.data.title} (${result.data.seasons.length} seasons)`);
 * } else {
 *   console.warn('Malformed series:', result.error);
 * }
 * ```
 */
export function parseSonarrSeries(data: unknown): ParseResult<SonarrSeries> {
	const result = v.safeParse(SonarrSeriesSchema, data);

	if (result.success) {
		// Map to SonarrSeries type, handling optional fields
		const output = result.output;
		const series: SonarrSeries = {
			id: output.id,
			title: output.title,
			tvdbId: output.tvdbId,
			status: output.status,
			monitored: output.monitored,
			qualityProfileId: output.qualityProfileId,
			seasons: output.seasons.map((season) => {
				const mappedSeason: SonarrSeason = {
					seasonNumber: season.seasonNumber,
					monitored: season.monitored
				};
				if (season.statistics !== undefined) {
					mappedSeason.statistics = season.statistics as SonarrSeasonStatistics;
				}
				return mappedSeason;
			}),
			// Only include statistics if defined
			...(output.statistics !== undefined && {
				statistics: output.statistics as SonarrSeriesStatistics
			})
		};
		return { success: true, data: series };
	}

	return {
		success: false,
		error: `Invalid Sonarr series response: ${result.issues.map((i) => i.message).join(', ')}`,
		issues: result.issues
	};
}

/**
 * Parses a Sonarr episode response from an unknown API response value.
 *
 * @param data - Unknown data from API response
 * @returns ParseResult with typed SonarrEpisode or error details
 *

 *
 * @example
 * ```typescript
 * const result = parseSonarrEpisode(apiResponse);
 * if (result.success) {
 *   console.log(`S${result.data.seasonNumber}E${result.data.episodeNumber}: ${result.data.title}`);
 * } else {
 *   console.warn('Malformed episode:', result.error);
 * }
 * ```
 */
export function parseSonarrEpisode(data: unknown): ParseResult<SonarrEpisode> {
	const result = v.safeParse(SonarrEpisodeSchema, data);

	if (result.success) {
		// Map to SonarrEpisode type, handling optional fields
		const output = result.output;
		const episode: SonarrEpisode = {
			id: output.id,
			seriesId: output.seriesId,
			seasonNumber: output.seasonNumber,
			episodeNumber: output.episodeNumber,
			hasFile: output.hasFile,
			monitored: output.monitored,
			qualityCutoffNotMet: output.qualityCutoffNotMet,
			// Conditionally include optional properties only when defined
			...(output.title !== undefined && { title: output.title }),
			...(output.airDateUtc !== undefined && { airDateUtc: output.airDateUtc }),
			...(output.episodeFileId !== undefined && { episodeFileId: output.episodeFileId }),
			...(output.episodeFile !== undefined && {
				episodeFile: output.episodeFile as SonarrEpisodeFile
			})
		};
		return { success: true, data: episode };
	}

	return {
		success: false,
		error: `Invalid Sonarr episode response: ${result.issues.map((i) => i.message).join(', ')}`,
		issues: result.issues
	};
}

/**
 * Parses a paginated series response from Sonarr API.
 *
 * @param data - Unknown data from API response
 * @returns ParseResult with typed PaginatedResponse<SonarrSeries> or error details
 *

 *
 * @example
 * ```typescript
 * const result = parsePaginatedSeries(apiResponse);
 * if (result.success) {
 *   console.log(`Found ${result.data.totalRecords} series`);
 *   for (const series of result.data.records) {
 *     console.log(series.title);
 *   }
 * }
 * ```
 */
export function parsePaginatedSeries(data: unknown): ParseResult<PaginatedResponse<SonarrSeries>> {
	const schema = createPaginatedResponseSchema(SonarrSeriesSchema);
	const result = v.safeParse(schema, data);

	if (result.success) {
		const output = result.output;
		const paginatedResponse: PaginatedResponse<SonarrSeries> = {
			page: output.page,
			pageSize: output.pageSize,
			sortKey: output.sortKey ?? '',
			sortDirection: output.sortDirection ?? 'ascending',
			totalRecords: output.totalRecords,
			records: output.records.map((record) => {
				// Map each record to SonarrSeries with proper optional handling
				const series: SonarrSeries = {
					id: record.id,
					title: record.title,
					tvdbId: record.tvdbId,
					status: record.status,
					monitored: record.monitored,
					qualityProfileId: record.qualityProfileId,
					seasons: record.seasons.map((season) => {
						const mappedSeason: SonarrSeason = {
							seasonNumber: season.seasonNumber,
							monitored: season.monitored
						};
						if (season.statistics !== undefined) {
							mappedSeason.statistics = season.statistics as SonarrSeasonStatistics;
						}
						return mappedSeason;
					}),
					...(record.statistics !== undefined && {
						statistics: record.statistics as SonarrSeriesStatistics
					})
				};
				return series;
			})
		};
		return { success: true, data: paginatedResponse };
	}

	return {
		success: false,
		error: `Invalid paginated series response: ${result.issues.map((i) => i.message).join(', ')}`,
		issues: result.issues
	};
}

/**
 * Parses a paginated episode response from Sonarr API.
 * Used for /api/v3/wanted/missing and /api/v3/wanted/cutoff endpoints.
 *
 * @param data - Unknown data from API response
 * @returns ParseResult with typed PaginatedResponse<SonarrEpisode> or error details
 *

 *
 * @example
 * ```typescript
 * const result = parsePaginatedEpisodes(apiResponse);
 * if (result.success) {
 *   console.log(`Found ${result.data.totalRecords} missing episodes`);
 *   for (const episode of result.data.records) {
 *     console.log(`S${episode.seasonNumber}E${episode.episodeNumber}`);
 *   }
 * }
 * ```
 */
export function parsePaginatedEpisodes(
	data: unknown
): ParseResult<PaginatedResponse<SonarrEpisode>> {
	const schema = createPaginatedResponseSchema(SonarrEpisodeSchema);
	const result = v.safeParse(schema, data);

	if (result.success) {
		const output = result.output;
		const paginatedResponse: PaginatedResponse<SonarrEpisode> = {
			page: output.page,
			pageSize: output.pageSize,
			sortKey: output.sortKey ?? '',
			sortDirection: output.sortDirection ?? 'ascending',
			totalRecords: output.totalRecords,
			records: output.records.map((record) => {
				// Map each record to SonarrEpisode with proper optional handling
				const episode: SonarrEpisode = {
					id: record.id,
					seriesId: record.seriesId,
					seasonNumber: record.seasonNumber,
					episodeNumber: record.episodeNumber,
					hasFile: record.hasFile,
					monitored: record.monitored,
					qualityCutoffNotMet: record.qualityCutoffNotMet,
					...(record.title !== undefined && { title: record.title }),
					...(record.airDateUtc !== undefined && { airDateUtc: record.airDateUtc }),
					...(record.episodeFileId !== undefined && { episodeFileId: record.episodeFileId }),
					...(record.episodeFile !== undefined && {
						episodeFile: record.episodeFile as SonarrEpisodeFile
					})
				};
				return episode;
			})
		};
		return { success: true, data: paginatedResponse };
	}

	return {
		success: false,
		error: `Invalid paginated episodes response: ${result.issues.map((i) => i.message).join(', ')}`,
		issues: result.issues
	};
}

// =============================================================================
// Lenient Parser Functions (Requirement 27.8)
// =============================================================================

/**
 * Parses a paginated series response leniently, skipping malformed records.
 * Use this when you want to continue processing even if some series records are invalid.
 *
 * @param data - Unknown data from API response
 * @param onInvalid - Optional callback for invalid records (for logging warnings)
 * @returns LenientParseResult with typed PaginatedResponse<SonarrSeries>, skipped count, or error
 *

 *
 * @example
 * ```typescript
 * const result = parsePaginatedSeriesLenient(
 *   apiResponse,
 *   (record, error) => console.warn('Skipping malformed series:', error)
 * );
 * if (result.success) {
 *   console.log(`Parsed ${result.data.records.length} series, skipped ${result.skipped}`);
 * }
 * ```
 */
export function parsePaginatedSeriesLenient(
	data: unknown,
	onInvalid?: (record: unknown, error: string) => void
): LenientParseResult<PaginatedResponse<SonarrSeries>> {
	const result = parsePaginatedResponseLenient(data, SonarrSeriesSchema, onInvalid);
	// Type assertion needed due to exactOptionalPropertyTypes - Valibot infers
	// optional fields as `Type | undefined` but our types use `property?: Type`
	return result as LenientParseResult<PaginatedResponse<SonarrSeries>>;
}

/**
 * Parses a paginated episodes response leniently, skipping malformed records.
 * Use this when you want to continue processing even if some episode records are invalid.
 *
 * @param data - Unknown data from API response
 * @param onInvalid - Optional callback for invalid records (for logging warnings)
 * @returns LenientParseResult with typed PaginatedResponse<SonarrEpisode>, skipped count, or error
 *

 *
 * @example
 * ```typescript
 * const result = parsePaginatedEpisodesLenient(
 *   apiResponse,
 *   (record, error) => console.warn('Skipping malformed episode:', error)
 * );
 * if (result.success) {
 *   console.log(`Parsed ${result.data.records.length} episodes, skipped ${result.skipped}`);
 * }
 * ```
 */
export function parsePaginatedEpisodesLenient(
	data: unknown,
	onInvalid?: (record: unknown, error: string) => void
): LenientParseResult<PaginatedResponse<SonarrEpisode>> {
	const result = parsePaginatedResponseLenient(data, SonarrEpisodeSchema, onInvalid);
	// Type assertion needed due to exactOptionalPropertyTypes - Valibot infers
	// optional fields as `Type | undefined` but our types use `property?: Type`
	return result as LenientParseResult<PaginatedResponse<SonarrEpisode>>;
}
