import * as v from 'valibot';
import type { QualityModel } from '$lib/utils/quality';
import type { CommandResponse, CommandStatus, PaginatedResponse } from './types';

export type ParseResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; issues?: v.BaseIssue<unknown>[] };

export type LenientParseResult<T> =
	| { success: true; data: T; skipped: number }
	| { success: false; error: string; issues?: v.BaseIssue<unknown>[] };

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

export const CommandStatusSchema = v.picklist([
	'queued',
	'started',
	'completed',
	'failed',
	'aborted',
	'cancelled',
	'orphaned'
]);

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

export function parseCommandResponse(data: unknown): ParseResult<CommandResponse> {
	const result = v.safeParse(CommandResponseSchema, data);

	if (result.success) {
		// Spread optional properties only when defined (required for exactOptionalPropertyTypes)
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

/** Filters out invalid records, calling onInvalid callback for skipped items. */
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

const PaginatedMetadataSchema = v.object({
	page: v.number(),
	pageSize: v.number(),
	sortKey: v.optional(v.string(), ''),
	sortDirection: v.optional(v.picklist(['ascending', 'descending']), 'ascending'),
	totalRecords: v.number(),
	records: v.array(v.unknown())
});

/** Skips malformed records instead of failing the entire parse. */
export function parsePaginatedResponseLenient<T extends v.GenericSchema>(
	data: unknown,
	recordSchema: T,
	onInvalid?: (record: unknown, error: string) => void
): LenientParseResult<PaginatedResponse<v.InferOutput<T>>> {
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
