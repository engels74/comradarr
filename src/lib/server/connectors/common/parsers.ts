/**
 * API response parsers for *arr applications using Valibot for runtime validation.
 *
 * Provides type-safe parsing with graceful error handling for:
 * - Paginated responses (Requirement 27.1)
 * - Quality model (Requirement 27.5)
 * - Command responses (Requirement 27.6)
 *
 * Design:
 * - Unknown fields are ignored (Requirement 27.7)
 * - Malformed records return errors instead of throwing (Requirement 27.8)
 *
 * @module connectors/common/parsers
 * @requirements 27.1, 27.5, 27.6, 27.7, 27.8
 */

import * as v from 'valibot';
import type { QualityModel } from '$lib/utils/quality';
import type { PaginatedResponse, CommandResponse, CommandStatus } from './types';

/**
 * Result type for parser functions.
 * Enables graceful degradation - callers can log warnings and skip malformed records.
 */
export type ParseResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; issues?: v.BaseIssue<unknown>[] };

/**
 * Result type for lenient parser functions that skip malformed records.
 * Includes a count of skipped records for transparency.
 *
 * @requirements 27.8
 */
export type LenientParseResult<T> =
	| { success: true; data: T; skipped: number }
	| { success: false; error: string; issues?: v.BaseIssue<unknown>[] };

/**
 * Valibot schema for QualityModel from *arr API responses.
 * Matches the structure in $lib/utils/quality.ts
 *
 * @requirements 27.5
 */
export const QualityModelSchema = v.object({
	quality: v.object({
		id: v.number(),
		name: v.string(),
		source: v.string(),
		resolution: v.number()
	}),
	revision: v.object({
		version: v.number(),
		real: v.number(),
		isRepack: v.boolean()
	})
});

/**
 * Command status enum schema
 */
export const CommandStatusSchema = v.picklist(['queued', 'started', 'completed', 'failed']);

/**
 * Valibot schema for CommandResponse from *arr API.
 * POST /api/v3/command returns this structure.
 *
 * Required fields per Requirement 27.6:
 * - id, name, status, started, ended, message
 *
 * @requirements 27.6
 */
export const CommandResponseSchema = v.object({
	id: v.number(),
	name: v.string(),
	commandName: v.optional(v.string()),
	message: v.optional(v.string()),
	body: v.optional(v.record(v.string(), v.unknown())),
	priority: v.optional(v.string()),
	status: CommandStatusSchema,
	queued: v.string(),
	started: v.optional(v.string()),
	ended: v.optional(v.string()),
	duration: v.optional(v.string()),
	trigger: v.optional(v.string()),
	stateChangeTime: v.optional(v.string()),
	sendUpdatesToClient: v.optional(v.boolean()),
	updateScheduledTask: v.optional(v.boolean()),
	lastExecutionTime: v.optional(v.string())
});

/**
 * Creates a Valibot schema for paginated responses with a specific record type.
 *
 * Required fields per Requirement 27.1:
 * - page, pageSize, totalRecords, records array
 *
 * @param recordSchema - Valibot schema for individual records in the response
 * @returns Paginated response schema
 *
 * @requirements 27.1
 */
export function createPaginatedResponseSchema<T extends v.GenericSchema>(recordSchema: T) {
	return v.object({
		page: v.number(),
		pageSize: v.number(),
		sortKey: v.optional(v.string(), ''),
		sortDirection: v.optional(v.picklist(['ascending', 'descending']), 'ascending'),
		totalRecords: v.number(),
		records: v.array(recordSchema)
	});
}

/**
 * Parses a QualityModel from an unknown API response value.
 *
 * @param data - Unknown data from API response
 * @returns ParseResult with typed QualityModel or error details
 *
 * @requirements 27.5, 27.7, 27.8
 *
 * @example
 * ```typescript
 * const result = parseQualityModel(apiResponse.quality);
 * if (result.success) {
 *   console.log(result.data.quality.name);
 * } else {
 *   console.warn('Malformed quality model:', result.error);
 * }
 * ```
 */
export function parseQualityModel(data: unknown): ParseResult<QualityModel> {
	const result = v.safeParse(QualityModelSchema, data);

	if (result.success) {
		return { success: true, data: result.output };
	}

	return {
		success: false,
		error: `Invalid quality model: ${result.issues.map((i) => i.message).join(', ')}`,
		issues: result.issues
	};
}

/**
 * Parses a CommandResponse from an unknown API response value.
 *
 * @param data - Unknown data from API response
 * @returns ParseResult with typed CommandResponse or error details
 *
 * @requirements 27.6, 27.7, 27.8
 *
 * @example
 * ```typescript
 * const result = parseCommandResponse(apiResponse);
 * if (result.success) {
 *   console.log(`Command ${result.data.name} status: ${result.data.status}`);
 * } else {
 *   console.warn('Malformed command response:', result.error);
 * }
 * ```
 */
export function parseCommandResponse(data: unknown): ParseResult<CommandResponse> {
	const result = v.safeParse(CommandResponseSchema, data);

	if (result.success) {
		// Map to CommandResponse type, ensuring all required fields
		// Use object spreading to conditionally include optional properties
		// (required for exactOptionalPropertyTypes TypeScript setting)
		const output = result.output;
		const commandResponse: CommandResponse = {
			id: output.id,
			name: output.name,
			commandName: output.commandName ?? output.name,
			body: output.body ?? {},
			priority: output.priority ?? 'normal',
			status: output.status as CommandStatus,
			queued: output.queued,
			trigger: output.trigger ?? 'manual',
			stateChangeTime: output.stateChangeTime ?? output.queued,
			sendUpdatesToClient: output.sendUpdatesToClient ?? false,
			updateScheduledTask: output.updateScheduledTask ?? false,
			// Conditionally include optional properties only when defined
			...(output.message !== undefined && { message: output.message }),
			...(output.started !== undefined && { started: output.started }),
			...(output.ended !== undefined && { ended: output.ended }),
			...(output.duration !== undefined && { duration: output.duration }),
			...(output.lastExecutionTime !== undefined && {
				lastExecutionTime: output.lastExecutionTime
			})
		};
		return { success: true, data: commandResponse };
	}

	return {
		success: false,
		error: `Invalid command response: ${result.issues.map((i) => i.message).join(', ')}`,
		issues: result.issues
	};
}

/**
 * Parses a paginated response from an unknown API response value.
 *
 * @param data - Unknown data from API response
 * @param recordSchema - Valibot schema for validating individual records
 * @returns ParseResult with typed PaginatedResponse or error details
 *
 * @requirements 27.1, 27.7, 27.8
 *
 * @example
 * ```typescript
 * const MovieSchema = v.object({ id: v.number(), title: v.string() });
 * const result = parsePaginatedResponse(apiResponse, MovieSchema);
 * if (result.success) {
 *   console.log(`Found ${result.data.totalRecords} movies`);
 *   for (const movie of result.data.records) {
 *     console.log(movie.title);
 *   }
 * } else {
 *   console.warn('Malformed paginated response:', result.error);
 * }
 * ```
 */
export function parsePaginatedResponse<T extends v.GenericSchema>(
	data: unknown,
	recordSchema: T
): ParseResult<PaginatedResponse<v.InferOutput<T>>> {
	const schema = createPaginatedResponseSchema(recordSchema);
	const result = v.safeParse(schema, data);

	if (result.success) {
		const output = result.output;
		const paginatedResponse: PaginatedResponse<v.InferOutput<T>> = {
			page: output.page,
			pageSize: output.pageSize,
			sortKey: output.sortKey ?? '',
			sortDirection: output.sortDirection ?? 'ascending',
			totalRecords: output.totalRecords,
			records: output.records
		};
		return { success: true, data: paginatedResponse };
	}

	return {
		success: false,
		error: `Invalid paginated response: ${result.issues.map((i) => i.message).join(', ')}`,
		issues: result.issues
	};
}

/**
 * Helper to parse an array of records, filtering out invalid entries with warnings.
 * Useful for processing API responses where some records may be malformed.
 *
 * @param records - Array of unknown records from API
 * @param recordSchema - Valibot schema for validating records
 * @param onInvalid - Optional callback for invalid records (for logging)
 * @returns Array of valid parsed records
 *
 * @requirements 27.8
 *
 * @example
 * ```typescript
 * const validMovies = parseRecordsWithWarnings(
 *   apiResponse.records,
 *   MovieSchema,
 *   (record, error) => console.warn('Skipping malformed movie:', error)
 * );
 * ```
 */
export function parseRecordsWithWarnings<T extends v.GenericSchema>(
	records: unknown[],
	recordSchema: T,
	onInvalid?: (record: unknown, error: string) => void
): v.InferOutput<T>[] {
	const validRecords: v.InferOutput<T>[] = [];

	for (const record of records) {
		const result = v.safeParse(recordSchema, record);
		if (result.success) {
			validRecords.push(result.output);
		} else if (onInvalid) {
			const error = result.issues.map((i) => i.message).join(', ');
			onInvalid(record, error);
		}
	}

	return validRecords;
}

/**
 * Schema for paginated response metadata (without records validation).
 * Used by lenient parser to validate structure before processing records individually.
 */
const PaginatedMetadataSchema = v.object({
	page: v.number(),
	pageSize: v.number(),
	sortKey: v.optional(v.string(), ''),
	sortDirection: v.optional(v.picklist(['ascending', 'descending']), 'ascending'),
	totalRecords: v.number(),
	records: v.array(v.unknown())
});

/**
 * Parses a paginated response leniently, skipping malformed records with warnings.
 * Unlike parsePaginatedResponse(), this function will return valid records even
 * if some records in the response are malformed.
 *
 * @param data - Unknown data from API response
 * @param recordSchema - Valibot schema for validating individual records
 * @param onInvalid - Optional callback for invalid records (for logging warnings)
 * @returns LenientParseResult with typed PaginatedResponse, skipped count, or error
 *
 * @requirements 27.7, 27.8
 *
 * @example
 * ```typescript
 * const result = parsePaginatedResponseLenient(
 *   apiResponse,
 *   MovieSchema,
 *   (record, error) => console.warn('Skipping malformed movie:', error)
 * );
 * if (result.success) {
 *   console.log(`Parsed ${result.data.records.length} movies, skipped ${result.skipped}`);
 * }
 * ```
 */
export function parsePaginatedResponseLenient<T extends v.GenericSchema>(
	data: unknown,
	recordSchema: T,
	onInvalid?: (record: unknown, error: string) => void
): LenientParseResult<PaginatedResponse<v.InferOutput<T>>> {
	// First, validate the paginated structure (without strict record validation)
	const metadataResult = v.safeParse(PaginatedMetadataSchema, data);

	if (!metadataResult.success) {
		return {
			success: false,
			error: `Invalid paginated response structure: ${metadataResult.issues.map((i) => i.message).join(', ')}`,
			issues: metadataResult.issues
		};
	}

	const metadata = metadataResult.output;
	const rawRecords = metadata.records;
	let skippedCount = 0;

	// Parse each record individually, collecting valid ones and counting skipped
	const validRecords = parseRecordsWithWarnings(rawRecords, recordSchema, (record, error) => {
		skippedCount++;
		if (onInvalid) {
			onInvalid(record, error);
		}
	});

	const paginatedResponse: PaginatedResponse<v.InferOutput<T>> = {
		page: metadata.page,
		pageSize: metadata.pageSize,
		sortKey: metadata.sortKey ?? '',
		sortDirection: metadata.sortDirection ?? 'ascending',
		totalRecords: metadata.totalRecords,
		records: validRecords
	};

	return { success: true, data: paginatedResponse, skipped: skippedCount };
}
