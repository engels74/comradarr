/**
 * Property-based tests for API response parsers.
 *
 * Validates requirements:
 * - 27.1: Parse paginated responses (page, pageSize, totalRecords, records array)
 * - 27.5: Parse quality model (quality.id, quality.name, quality.source, quality.resolution, revision fields)
 * - 27.6: Parse command responses (id, name, status, started, ended, message fields)
 * - 27.7: Ignore unknown fields in responses
 * - 27.8: Malformed records return errors, don't throw
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as v from 'valibot';
import {
	parseQualityModel,
	parseCommandResponse,
	parsePaginatedResponse,
	parsePaginatedResponseLenient,
	parseRecordsWithWarnings,
	QualityModelSchema
} from '../../src/lib/server/connectors/common/parsers';
import type { QualityModel } from '../../src/lib/utils/quality';
import type { CommandStatus } from '../../src/lib/server/connectors/common/types';

/**
 * Arbitrary generator for valid QualityModel objects.
 */
const qualityModelArbitrary: fc.Arbitrary<QualityModel> = fc.record({
	quality: fc.record({
		id: fc.integer({ min: 0, max: 100 }),
		name: fc.string({ minLength: 1, maxLength: 50 }),
		source: fc.string({ minLength: 1, maxLength: 50 }),
		resolution: fc.constantFrom(480, 576, 720, 1080, 2160)
	}),
	revision: fc.record({
		version: fc.integer({ min: 0, max: 100 }),
		real: fc.integer({ min: 0, max: 10 }),
		isRepack: fc.boolean()
	})
});

/**
 * Arbitrary generator for valid CommandResponse objects.
 */
const commandStatusArbitrary: fc.Arbitrary<CommandStatus> = fc.constantFrom(
	'queued',
	'started',
	'completed',
	'failed'
);

/**
 * Date arbitrary constrained to valid date range to avoid Invalid Date errors.
 * Uses timestamps within a reasonable range (2000-2030).
 */
const validDateArbitrary = fc
	.integer({ min: 946684800000, max: 1893456000000 }) // 2000-01-01 to 2030-01-01
	.map((ts) => new Date(ts).toISOString());

const commandResponseArbitrary = fc.record({
	id: fc.integer({ min: 1, max: 100000 }),
	name: fc.string({ minLength: 1, maxLength: 50 }),
	status: commandStatusArbitrary,
	queued: validDateArbitrary,
	started: fc.option(validDateArbitrary, { nil: undefined }),
	ended: fc.option(validDateArbitrary, { nil: undefined }),
	message: fc.option(fc.string({ maxLength: 200 }), { nil: undefined })
});

/**
 * Arbitrary generator for paginated response wrapper.
 */
const paginatedResponseArbitrary = <T>(recordArbitrary: fc.Arbitrary<T>) =>
	fc.record({
		page: fc.integer({ min: 1, max: 100 }),
		pageSize: fc.integer({ min: 1, max: 1000 }),
		sortKey: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
		sortDirection: fc.option(fc.constantFrom('ascending' as const, 'descending' as const), {
			nil: undefined
		}),
		totalRecords: fc.integer({ min: 0, max: 100000 }),
		records: fc.array(recordArbitrary, { minLength: 0, maxLength: 10 })
	});

/**
 * Simple record schema for testing paginated responses
 */
const SimpleRecordSchema = v.object({
	id: v.number(),
	title: v.string()
});

const simpleRecordArbitrary = fc.record({
	id: fc.integer({ min: 1, max: 100000 }),
	title: fc.string({ minLength: 1, maxLength: 100 })
});

describe('API Response Parsers - Property Tests', () => {
	describe('Property 13: API Response Parsing Completeness', () => {
		it('parseQualityModel extracts all required fields from valid input', () => {
			fc.assert(
				fc.property(qualityModelArbitrary, (qualityModel) => {
					const result = parseQualityModel(qualityModel);

					expect(result.success).toBe(true);
					if (result.success) {
						// Verify all required fields are extracted (Req 27.5)
						expect(result.data.quality.id).toBe(qualityModel.quality.id);
						expect(result.data.quality.name).toBe(qualityModel.quality.name);
						expect(result.data.quality.source).toBe(qualityModel.quality.source);
						expect(result.data.quality.resolution).toBe(qualityModel.quality.resolution);
						expect(result.data.revision.version).toBe(qualityModel.revision.version);
						expect(result.data.revision.real).toBe(qualityModel.revision.real);
						expect(result.data.revision.isRepack).toBe(qualityModel.revision.isRepack);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('parseCommandResponse extracts all required fields from valid input', () => {
			fc.assert(
				fc.property(commandResponseArbitrary, (commandResponse) => {
					const result = parseCommandResponse(commandResponse);

					expect(result.success).toBe(true);
					if (result.success) {
						// Verify all required fields are extracted (Req 27.6)
						expect(result.data.id).toBe(commandResponse.id);
						expect(result.data.name).toBe(commandResponse.name);
						expect(result.data.status).toBe(commandResponse.status);
						expect(result.data.queued).toBe(commandResponse.queued);
						// Optional fields should be present if provided
						if (commandResponse.started !== undefined) {
							expect(result.data.started).toBe(commandResponse.started);
						}
						if (commandResponse.ended !== undefined) {
							expect(result.data.ended).toBe(commandResponse.ended);
						}
						if (commandResponse.message !== undefined) {
							expect(result.data.message).toBe(commandResponse.message);
						}
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('parsePaginatedResponse extracts all required fields from valid input', () => {
			fc.assert(
				fc.property(paginatedResponseArbitrary(simpleRecordArbitrary), (paginatedResponse) => {
					const result = parsePaginatedResponse(paginatedResponse, SimpleRecordSchema);

					expect(result.success).toBe(true);
					if (result.success) {
						// Verify all required fields are extracted (Req 27.1)
						expect(result.data.page).toBe(paginatedResponse.page);
						expect(result.data.pageSize).toBe(paginatedResponse.pageSize);
						expect(result.data.totalRecords).toBe(paginatedResponse.totalRecords);
						expect(result.data.records).toHaveLength(paginatedResponse.records.length);

						// Verify records are preserved
						for (let i = 0; i < paginatedResponse.records.length; i++) {
							expect(result.data.records[i]).toEqual(paginatedResponse.records[i]);
						}
					}
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property 14: Parser Robustness to Extra Fields', () => {
		it('parseQualityModel ignores unknown fields', () => {
			fc.assert(
				fc.property(
					qualityModelArbitrary,
					fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.anything()),
					(qualityModel, extraFields) => {
						// Add extra unknown fields to the input
						const inputWithExtras = {
							...qualityModel,
							...extraFields,
							quality: {
								...qualityModel.quality,
								unknownField: 'should be ignored',
								anotherExtra: 12345
							},
							revision: {
								...qualityModel.revision,
								extraRevisionField: true
							}
						};

						const result = parseQualityModel(inputWithExtras);

						// Should still parse successfully (Req 27.7)
						expect(result.success).toBe(true);
						if (result.success) {
							// Original fields should be preserved
							expect(result.data.quality.id).toBe(qualityModel.quality.id);
							expect(result.data.quality.name).toBe(qualityModel.quality.name);
							expect(result.data.quality.source).toBe(qualityModel.quality.source);
							expect(result.data.quality.resolution).toBe(qualityModel.quality.resolution);
						}
					}
				),
				{ numRuns: 100 }
			);
		});

		it('parseCommandResponse ignores unknown fields', () => {
			fc.assert(
				fc.property(commandResponseArbitrary, (commandResponse) => {
					// Add extra unknown fields with safe keys that don't conflict
					const inputWithExtras = {
						...commandResponse,
						unknownTopLevel: 'ignored',
						nestedUnknown: { foo: 'bar' },
						extraNumber: 42,
						extraArray: [1, 2, 3]
					};

					const result = parseCommandResponse(inputWithExtras);

					// Should still parse successfully (Req 27.7)
					expect(result.success).toBe(true);
					if (result.success) {
						expect(result.data.id).toBe(commandResponse.id);
						expect(result.data.name).toBe(commandResponse.name);
						expect(result.data.status).toBe(commandResponse.status);
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('parsePaginatedResponse ignores unknown fields', () => {
			fc.assert(
				fc.property(paginatedResponseArbitrary(simpleRecordArbitrary), (paginatedResponse) => {
					const inputWithExtras = {
						...paginatedResponse,
						unknownPaginationField: 'ignored',
						extraMetadata: { version: '2.0' }
					};

					const result = parsePaginatedResponse(inputWithExtras, SimpleRecordSchema);

					// Should still parse successfully (Req 27.7)
					expect(result.success).toBe(true);
					if (result.success) {
						expect(result.data.page).toBe(paginatedResponse.page);
						expect(result.data.totalRecords).toBe(paginatedResponse.totalRecords);
					}
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property 15: Parser Graceful Degradation', () => {
		it('parseQualityModel returns error for malformed input without throwing', () => {
			const malformedInputs = [
				null,
				undefined,
				'string',
				123,
				[],
				{},
				{ quality: null },
				{ quality: { id: 'not a number' } },
				{ quality: { id: 1, name: 123 } }, // name should be string
				{ quality: { id: 1, name: 'test' } }, // missing source, resolution
				{ quality: { id: 1, name: 'test', source: 'web', resolution: 1080 } } // missing revision
			];

			for (const input of malformedInputs) {
				// Should not throw (Req 27.8)
				expect(() => parseQualityModel(input)).not.toThrow();

				const result = parseQualityModel(input);
				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.error).toBeDefined();
					expect(typeof result.error).toBe('string');
				}
			}
		});

		it('parseCommandResponse returns error for malformed input without throwing', () => {
			const malformedInputs = [
				null,
				undefined,
				'string',
				123,
				[],
				{},
				{ id: 'not a number' },
				{ id: 1, name: 123 }, // name should be string
				{ id: 1, name: 'test' }, // missing status, queued
				{ id: 1, name: 'test', status: 'invalid_status', queued: '2024-01-01' } // invalid status
			];

			for (const input of malformedInputs) {
				// Should not throw (Req 27.8)
				expect(() => parseCommandResponse(input)).not.toThrow();

				const result = parseCommandResponse(input);
				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.error).toBeDefined();
					expect(typeof result.error).toBe('string');
				}
			}
		});

		it('parsePaginatedResponse returns error for malformed input without throwing', () => {
			const malformedInputs = [
				null,
				undefined,
				'string',
				123,
				[],
				{},
				{ page: 'not a number' },
				{ page: 1, pageSize: 10 }, // missing totalRecords, records
				{ page: 1, pageSize: 10, totalRecords: 100, records: 'not an array' }
			];

			for (const input of malformedInputs) {
				// Should not throw (Req 27.8)
				expect(() => parsePaginatedResponse(input, SimpleRecordSchema)).not.toThrow();

				const result = parsePaginatedResponse(input, SimpleRecordSchema);
				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.error).toBeDefined();
					expect(typeof result.error).toBe('string');
				}
			}
		});

		it('parseRecordsWithWarnings filters invalid records without throwing', () => {
			fc.assert(
				fc.property(
					fc.array(simpleRecordArbitrary, { minLength: 1, maxLength: 10 }),
					(validRecords) => {
						// Mix valid records with invalid ones
						const mixedRecords = [
							...validRecords,
							null,
							{ id: 'invalid' },
							{ title: 123 },
							'not an object'
						];

						const warnings: string[] = [];

						// Should not throw
						expect(() =>
							parseRecordsWithWarnings(mixedRecords, SimpleRecordSchema, (_, error) => {
								warnings.push(error);
							})
						).not.toThrow();

						const result = parseRecordsWithWarnings(mixedRecords, SimpleRecordSchema);

						// Should only return valid records
						expect(result).toHaveLength(validRecords.length);
						for (let i = 0; i < validRecords.length; i++) {
							expect(result[i]).toEqual(validRecords[i]);
						}
					}
				),
				{ numRuns: 100 }
			);
		});
	});

	describe('Type Preservation', () => {
		it('parseQualityModel preserves numeric types', () => {
			fc.assert(
				fc.property(qualityModelArbitrary, (qualityModel) => {
					const result = parseQualityModel(qualityModel);

					if (result.success) {
						expect(typeof result.data.quality.id).toBe('number');
						expect(typeof result.data.quality.resolution).toBe('number');
						expect(typeof result.data.revision.version).toBe('number');
						expect(typeof result.data.revision.real).toBe('number');
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('parseQualityModel preserves string types', () => {
			fc.assert(
				fc.property(qualityModelArbitrary, (qualityModel) => {
					const result = parseQualityModel(qualityModel);

					if (result.success) {
						expect(typeof result.data.quality.name).toBe('string');
						expect(typeof result.data.quality.source).toBe('string');
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('parseQualityModel preserves boolean types', () => {
			fc.assert(
				fc.property(qualityModelArbitrary, (qualityModel) => {
					const result = parseQualityModel(qualityModel);

					if (result.success) {
						expect(typeof result.data.revision.isRepack).toBe('boolean');
					}
				}),
				{ numRuns: 100 }
			);
		});

		it('parseCommandResponse preserves status enum values', () => {
			fc.assert(
				fc.property(commandResponseArbitrary, (commandResponse) => {
					const result = parseCommandResponse(commandResponse);

					if (result.success) {
						expect(['queued', 'started', 'completed', 'failed']).toContain(result.data.status);
					}
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property 16: Lenient Paginated Parsing (Req 27.8)', () => {
		/**
		 * Arbitrary for generating invalid records
		 */
		const invalidRecordArbitrary = fc.oneof(
			fc.constant(null),
			fc.constant(undefined),
			fc.string(),
			fc.integer(),
			fc.record({ invalid: fc.string() })
		);

		it('parsePaginatedResponseLenient skipped count matches actual invalid records', () => {
			fc.assert(
				fc.property(
					fc.array(simpleRecordArbitrary, { minLength: 0, maxLength: 5 }),
					fc.array(invalidRecordArbitrary, { minLength: 0, maxLength: 5 }),
					(validRecords, invalidRecords) => {
						// Mix valid and invalid records
						const mixedRecords = [...validRecords, ...invalidRecords];

						const input = {
							page: 1,
							pageSize: 1000,
							totalRecords: mixedRecords.length,
							records: mixedRecords
						};

						const result = parsePaginatedResponseLenient(input, SimpleRecordSchema);

						expect(result.success).toBe(true);
						if (result.success) {
							// Skipped count should match invalid records count
							expect(result.skipped).toBe(invalidRecords.length);
							// Valid records count should match
							expect(result.data.records).toHaveLength(validRecords.length);
						}
					}
				),
				{ numRuns: 100 }
			);
		});

		it('parsePaginatedResponseLenient preserves all valid records', () => {
			fc.assert(
				fc.property(
					fc.array(simpleRecordArbitrary, { minLength: 1, maxLength: 10 }),
					(validRecords) => {
						// Add some invalid records
						const mixedRecords = [
							...validRecords,
							null,
							{ wrong: 'type' },
							'string'
						];

						const input = {
							page: 1,
							pageSize: 1000,
							totalRecords: mixedRecords.length,
							records: mixedRecords
						};

						const result = parsePaginatedResponseLenient(input, SimpleRecordSchema);

						expect(result.success).toBe(true);
						if (result.success) {
							// All valid records should be preserved
							expect(result.data.records).toHaveLength(validRecords.length);
							for (let i = 0; i < validRecords.length; i++) {
								expect(result.data.records[i]).toEqual(validRecords[i]);
							}
						}
					}
				),
				{ numRuns: 100 }
			);
		});

		it('parsePaginatedResponseLenient invokes callback for each invalid record', () => {
			fc.assert(
				fc.property(
					fc.array(simpleRecordArbitrary, { minLength: 1, maxLength: 5 }),
					fc.array(invalidRecordArbitrary, { minLength: 1, maxLength: 5 }),
					(validRecords, invalidRecords) => {
						const mixedRecords = [...validRecords, ...invalidRecords];

						const input = {
							page: 1,
							pageSize: 1000,
							totalRecords: mixedRecords.length,
							records: mixedRecords
						};

						let callbackCount = 0;
						const result = parsePaginatedResponseLenient(
							input,
							SimpleRecordSchema,
							() => {
								callbackCount++;
							}
						);

						expect(result.success).toBe(true);
						// Callback should be invoked for each invalid record
						expect(callbackCount).toBe(invalidRecords.length);
					}
				),
				{ numRuns: 100 }
			);
		});

		it('parsePaginatedResponseLenient never throws for any input', () => {
			fc.assert(
				fc.property(fc.anything(), (input) => {
					// Should never throw, even for completely invalid input
					expect(() =>
						parsePaginatedResponseLenient(input, SimpleRecordSchema)
					).not.toThrow();
				}),
				{ numRuns: 100 }
			);
		});

		it('parsePaginatedResponseLenient returns success for valid pagination structure regardless of record validity', () => {
			fc.assert(
				fc.property(
					paginatedResponseArbitrary(fc.anything()),
					(paginatedResponse) => {
						const result = parsePaginatedResponseLenient(
							paginatedResponse,
							SimpleRecordSchema
						);

						// Should succeed as long as pagination structure is valid
						expect(result.success).toBe(true);
					}
				),
				{ numRuns: 100 }
			);
		});
	});
});
