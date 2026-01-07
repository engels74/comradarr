import * as v from 'valibot';
import {
	createPaginatedResponseSchema,
	type LenientParseResult,
	type ParseResult,
	parsePaginatedResponseLenient,
	QualityModelSchema
} from '../common/parsers';
import type { PaginatedResponse } from '../common/types';
import type {
	SonarrEpisode,
	SonarrEpisodeFile,
	SonarrSeason,
	SonarrSeasonStatistics,
	SonarrSeries,
	SonarrSeriesStatistics
} from './types';

export const SonarrSeasonStatisticsSchema = v.object({
	episodeFileCount: v.number(),
	episodeCount: v.number(),
	totalEpisodeCount: v.number(),
	sizeOnDisk: v.number(),
	percentOfEpisodes: v.number()
});

export const SonarrSeasonSchema = v.object({
	seasonNumber: v.number(),
	monitored: v.boolean(),
	statistics: v.optional(SonarrSeasonStatisticsSchema)
});

export const SonarrSeriesStatisticsSchema = v.object({
	seasonCount: v.number(),
	episodeFileCount: v.number(),
	episodeCount: v.number(),
	sizeOnDisk: v.number(),
	percentOfEpisodes: v.number()
});

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

export const SonarrEpisodeFileSchema = v.object({
	id: v.number(),
	quality: QualityModelSchema,
	size: v.number(),
	relativePath: v.optional(v.string())
});

export const SonarrEpisodeSchema = v.object({
	id: v.number(),
	seriesId: v.number(),
	seasonNumber: v.number(),
	episodeNumber: v.number(),
	title: v.optional(v.string()),
	airDateUtc: v.optional(v.string()),
	hasFile: v.boolean(),
	monitored: v.boolean(),
	qualityCutoffNotMet: v.optional(v.nullable(v.boolean())),
	episodeFileId: v.optional(v.number()),
	episodeFile: v.optional(SonarrEpisodeFileSchema)
});

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
			// qualityCutoffNotMet may be undefined (missing) or null (no file)
			qualityCutoffNotMet: output.qualityCutoffNotMet ?? null,
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
					// qualityCutoffNotMet may be undefined (missing) or null (no file)
					qualityCutoffNotMet: record.qualityCutoffNotMet ?? null,
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

export function parsePaginatedSeriesLenient(
	data: unknown,
	onInvalid?: (record: unknown, error: string) => void
): LenientParseResult<PaginatedResponse<SonarrSeries>> {
	const result = parsePaginatedResponseLenient(data, SonarrSeriesSchema, onInvalid);
	// Type assertion needed due to exactOptionalPropertyTypes - Valibot infers
	// optional fields as `Type | undefined` but our types use `property?: Type`
	return result as LenientParseResult<PaginatedResponse<SonarrSeries>>;
}

export function parsePaginatedEpisodesLenient(
	data: unknown,
	onInvalid?: (record: unknown, error: string) => void
): LenientParseResult<PaginatedResponse<SonarrEpisode>> {
	const result = parsePaginatedResponseLenient(data, SonarrEpisodeSchema, onInvalid);
	// Type assertion needed due to exactOptionalPropertyTypes - Valibot infers
	// optional fields as `Type | undefined` but our types use `property?: Type`
	return result as LenientParseResult<PaginatedResponse<SonarrEpisode>>;
}
