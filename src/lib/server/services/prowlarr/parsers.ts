/**
 * API response parsers for Prowlarr using Valibot for runtime validation.
 *
 * Provides type-safe parsing with graceful error handling for:
 * - Indexer status responses (Requirement 38.2)
 * - Indexer definition responses
 *
 * Design:
 * - Unknown fields are ignored for forward compatibility
 * - Malformed records return errors instead of throwing
 *
 * @module services/prowlarr/parsers

 */

import * as v from 'valibot';
import type { ParseResult } from '$lib/server/connectors/common/parsers';
import type { ProwlarrIndexerStatus, ProwlarrIndexer } from './types.js';

/**
 * Valibot schema for indexer status response.
 * Retrieved via GET /api/v1/indexerstatus
 *

 */
export const ProwlarrIndexerStatusSchema = v.object({
	id: v.number(),
	indexerId: v.number(),
	disabledTill: v.nullable(v.string()),
	mostRecentFailure: v.nullable(v.string()),
	initialFailure: v.nullable(v.string())
});

/**
 * Valibot schema for indexer definition response.
 * Retrieved via GET /api/v1/indexer
 */
export const ProwlarrIndexerSchema = v.object({
	id: v.number(),
	name: v.string(),
	implementation: v.string(),
	enable: v.boolean(),
	protocol: v.string(),
	priority: v.number()
});

/**
 * Parses a Prowlarr indexer status response.
 *
 * @param data - Unknown data from API response
 * @returns ParseResult with typed ProwlarrIndexerStatus or error details
 *

 *
 * @example
 * ```typescript
 * const result = parseProwlarrIndexerStatus(apiResponse);
 * if (result.success) {
 *   if (result.data.disabledTill) {
 *     console.log(`Indexer ${result.data.indexerId} disabled until ${result.data.disabledTill}`);
 *   }
 * }
 * ```
 */
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

/**
 * Parses a Prowlarr indexer definition response.
 *
 * @param data - Unknown data from API response
 * @returns ParseResult with typed ProwlarrIndexer or error details
 *
 * @example
 * ```typescript
 * const result = parseProwlarrIndexer(apiResponse);
 * if (result.success) {
 *   console.log(`Indexer: ${result.data.name} (${result.data.implementation})`);
 * }
 * ```
 */
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
