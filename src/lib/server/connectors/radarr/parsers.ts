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

export const RadarrMovieFileSchema = v.object({
	id: v.number(),
	quality: QualityModelSchema,
	size: v.number(),
	relativePath: v.optional(v.string())
});

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

export function parsePaginatedMoviesLenient(
	data: unknown,
	onInvalid?: (record: unknown, error: string) => void
): LenientParseResult<PaginatedResponse<RadarrMovie>> {
	const result = parsePaginatedResponseLenient(data, RadarrMovieSchema, onInvalid);
	// Type assertion needed due to exactOptionalPropertyTypes - Valibot infers
	// optional fields as `Type | undefined` but our types use `property?: Type`
	return result as LenientParseResult<PaginatedResponse<RadarrMovie>>;
}
