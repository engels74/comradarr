// Unknown fields are ignored for forward compatibility; malformed records return errors

import * as v from 'valibot';
import type { ParseResult } from '$lib/server/connectors/common/parsers';
import type { ProwlarrIndexer, ProwlarrIndexerStatus } from './types.js';

export const ProwlarrIndexerStatusSchema = v.object({
	id: v.number(),
	indexerId: v.number(),
	disabledTill: v.nullable(v.string()),
	mostRecentFailure: v.nullable(v.string()),
	initialFailure: v.nullable(v.string())
});

export const ProwlarrIndexerSchema = v.object({
	id: v.number(),
	name: v.string(),
	implementation: v.string(),
	enable: v.boolean(),
	protocol: v.string(),
	priority: v.number()
});

export function parseProwlarrIndexerStatus(data: unknown): ParseResult<ProwlarrIndexerStatus> {
	const result = v.safeParse(ProwlarrIndexerStatusSchema, data);

	if (result.success) {
		return { success: true, data: result.output };
	}

	return {
		success: false,
		error: `Invalid indexer status response: ${result.issues.map((i) => i.message).join(', ')}`,
		issues: result.issues
	};
}

export function parseProwlarrIndexer(data: unknown): ParseResult<ProwlarrIndexer> {
	const result = v.safeParse(ProwlarrIndexerSchema, data);

	if (result.success) {
		return { success: true, data: result.output };
	}

	return {
		success: false,
		error: `Invalid indexer response: ${result.issues.map((i) => i.message).join(', ')}`,
		issues: result.issues
	};
}
