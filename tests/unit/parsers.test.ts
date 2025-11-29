/**
 * Unit tests for API response parsers
 *
 * Tests cover:
 * - parseQualityModel() valid and invalid inputs
 * - parseCommandResponse() valid and invalid inputs
 * - parsePaginatedResponse() valid and invalid inputs
 * - parseRecordsWithWarnings() filtering behavior
 * - Edge cases for all parsers
 *
 * @requirements 27.1, 27.5, 27.6, 27.7, 27.8
 */

import { describe, it, expect, vi } from 'vitest';
import * as v from 'valibot';
import {
	parseQualityModel,
	parseCommandResponse,
	parsePaginatedResponse,
	parsePaginatedResponseLenient,
	parseRecordsWithWarnings,
	createPaginatedResponseSchema,
	QualityModelSchema,
	CommandResponseSchema
} from '../../src/lib/server/connectors/common/parsers';

describe('parseQualityModel', () => {
	describe('valid inputs', () => {
		it('should parse a valid quality model', () => {
			const input = {
				quality: {
					id: 7,
					name: 'HDTV-1080p',
					source: 'television',
					resolution: 1080
				},
				revision: {
					version: 1,
					real: 0,
					isRepack: false
				}
			};

			const result = parseQualityModel(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.quality.id).toBe(7);
				expect(result.data.quality.name).toBe('HDTV-1080p');
				expect(result.data.quality.source).toBe('television');
				expect(result.data.quality.resolution).toBe(1080);
				expect(result.data.revision.version).toBe(1);
				expect(result.data.revision.real).toBe(0);
				expect(result.data.revision.isRepack).toBe(false);
			}
		});

		it('should parse quality model with repack flag true', () => {
			const input = {
				quality: {
					id: 9,
					name: 'Bluray-1080p',
					source: 'bluray',
					resolution: 1080
				},
				revision: {
					version: 2,
					real: 1,
					isRepack: true
				}
			};

			const result = parseQualityModel(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.revision.isRepack).toBe(true);
			}
		});

		it('should ignore extra unknown fields (Req 27.7)', () => {
			const input = {
				quality: {
					id: 7,
					name: 'HDTV-1080p',
					source: 'television',
					resolution: 1080,
					unknownField: 'should be ignored',
					modifier: { id: 1, name: 'none' } // Extra nested object
				},
				revision: {
					version: 1,
					real: 0,
					isRepack: false,
					extraField: true
				},
				topLevelExtra: 'also ignored'
			};

			const result = parseQualityModel(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.quality.id).toBe(7);
				// Extra fields should not be present in output
				expect('unknownField' in result.data.quality).toBe(false);
			}
		});
	});

	describe('invalid inputs (Req 27.8)', () => {
		it('should return error for null input', () => {
			const result = parseQualityModel(null);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('Invalid quality model');
			}
		});

		it('should return error for undefined input', () => {
			const result = parseQualityModel(undefined);
			expect(result.success).toBe(false);
		});

		it('should return error for missing quality object', () => {
			const result = parseQualityModel({ revision: { version: 1, real: 0, isRepack: false } });
			expect(result.success).toBe(false);
		});

		it('should return error for missing revision object', () => {
			const result = parseQualityModel({
				quality: { id: 1, name: 'test', source: 'web', resolution: 1080 }
			});
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on quality.id', () => {
			const result = parseQualityModel({
				quality: { id: 'not a number', name: 'test', source: 'web', resolution: 1080 },
				revision: { version: 1, real: 0, isRepack: false }
			});
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on quality.name', () => {
			const result = parseQualityModel({
				quality: { id: 1, name: 123, source: 'web', resolution: 1080 },
				revision: { version: 1, real: 0, isRepack: false }
			});
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on revision.isRepack', () => {
			const result = parseQualityModel({
				quality: { id: 1, name: 'test', source: 'web', resolution: 1080 },
				revision: { version: 1, real: 0, isRepack: 'not a boolean' }
			});
			expect(result.success).toBe(false);
		});
	});

	describe('edge cases', () => {
		it('should handle zero values', () => {
			const input = {
				quality: {
					id: 0,
					name: 'Unknown',
					source: 'unknown',
					resolution: 0
				},
				revision: {
					version: 0,
					real: 0,
					isRepack: false
				}
			};

			const result = parseQualityModel(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.quality.id).toBe(0);
				expect(result.data.quality.resolution).toBe(0);
			}
		});

		it('should handle empty strings', () => {
			const input = {
				quality: {
					id: 1,
					name: '',
					source: '',
					resolution: 1080
				},
				revision: {
					version: 1,
					real: 0,
					isRepack: false
				}
			};

			const result = parseQualityModel(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.quality.name).toBe('');
				expect(result.data.quality.source).toBe('');
			}
		});
	});
});

describe('parseCommandResponse', () => {
	describe('valid inputs', () => {
		it('should parse a minimal valid command response', () => {
			const input = {
				id: 123,
				name: 'EpisodeSearch',
				status: 'completed',
				queued: '2024-01-15T10:30:00Z'
			};

			const result = parseCommandResponse(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(123);
				expect(result.data.name).toBe('EpisodeSearch');
				expect(result.data.status).toBe('completed');
				expect(result.data.queued).toBe('2024-01-15T10:30:00Z');
			}
		});

		it('should parse a full command response with all optional fields', () => {
			const input = {
				id: 456,
				name: 'MoviesSearch',
				commandName: 'MoviesSearch',
				message: 'Searching for 5 movies',
				body: { movieIds: [1, 2, 3, 4, 5] },
				priority: 'high',
				status: 'started',
				queued: '2024-01-15T10:30:00Z',
				started: '2024-01-15T10:30:05Z',
				ended: '2024-01-15T10:32:00Z',
				duration: '00:01:55',
				trigger: 'scheduled',
				stateChangeTime: '2024-01-15T10:32:00Z',
				sendUpdatesToClient: true,
				updateScheduledTask: false,
				lastExecutionTime: '2024-01-14T10:30:00Z'
			};

			const result = parseCommandResponse(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(456);
				expect(result.data.message).toBe('Searching for 5 movies');
				expect(result.data.started).toBe('2024-01-15T10:30:05Z');
				expect(result.data.ended).toBe('2024-01-15T10:32:00Z');
			}
		});

		it('should parse all valid status values', () => {
			const statuses = ['queued', 'started', 'completed', 'failed'] as const;

			for (const status of statuses) {
				const input = {
					id: 1,
					name: 'TestCommand',
					status,
					queued: '2024-01-15T10:30:00Z'
				};

				const result = parseCommandResponse(input);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.status).toBe(status);
				}
			}
		});

		it('should ignore extra unknown fields (Req 27.7)', () => {
			const input = {
				id: 789,
				name: 'SeasonSearch',
				status: 'queued',
				queued: '2024-01-15T10:30:00Z',
				unknownField: 'ignored',
				nestedUnknown: { foo: 'bar' },
				arrayUnknown: [1, 2, 3]
			};

			const result = parseCommandResponse(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(789);
				expect('unknownField' in result.data).toBe(false);
			}
		});
	});

	describe('invalid inputs (Req 27.8)', () => {
		it('should return error for null input', () => {
			const result = parseCommandResponse(null);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required fields', () => {
			const result = parseCommandResponse({ id: 1, name: 'Test' });
			expect(result.success).toBe(false);
		});

		it('should return error for invalid status value', () => {
			const result = parseCommandResponse({
				id: 1,
				name: 'Test',
				status: 'invalid_status',
				queued: '2024-01-15T10:30:00Z'
			});
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on id', () => {
			const result = parseCommandResponse({
				id: 'not a number',
				name: 'Test',
				status: 'queued',
				queued: '2024-01-15T10:30:00Z'
			});
			expect(result.success).toBe(false);
		});
	});

	describe('default values', () => {
		it('should set default values for optional fields', () => {
			const input = {
				id: 1,
				name: 'TestCommand',
				status: 'completed',
				queued: '2024-01-15T10:30:00Z'
			};

			const result = parseCommandResponse(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.commandName).toBe('TestCommand'); // Defaults to name
				expect(result.data.body).toEqual({}); // Defaults to empty object
				expect(result.data.priority).toBe('normal'); // Defaults to 'normal'
				expect(result.data.trigger).toBe('manual'); // Defaults to 'manual'
				expect(result.data.sendUpdatesToClient).toBe(false);
				expect(result.data.updateScheduledTask).toBe(false);
			}
		});
	});
});

describe('parsePaginatedResponse', () => {
	const SimpleRecordSchema = v.object({
		id: v.number(),
		title: v.string()
	});

	describe('valid inputs', () => {
		it('should parse a valid paginated response with records', () => {
			const input = {
				page: 1,
				pageSize: 10,
				sortKey: 'title',
				sortDirection: 'ascending',
				totalRecords: 25,
				records: [
					{ id: 1, title: 'First' },
					{ id: 2, title: 'Second' }
				]
			};

			const result = parsePaginatedResponse(input, SimpleRecordSchema);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.page).toBe(1);
				expect(result.data.pageSize).toBe(10);
				expect(result.data.totalRecords).toBe(25);
				expect(result.data.records).toHaveLength(2);
				expect(result.data.records[0]?.id).toBe(1);
				expect(result.data.records[0]?.title).toBe('First');
			}
		});

		it('should parse an empty records array', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 0,
				records: []
			};

			const result = parsePaginatedResponse(input, SimpleRecordSchema);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(0);
				expect(result.data.totalRecords).toBe(0);
			}
		});

		it('should handle both sort directions', () => {
			for (const sortDirection of ['ascending', 'descending'] as const) {
				const input = {
					page: 1,
					pageSize: 10,
					sortDirection,
					totalRecords: 5,
					records: [{ id: 1, title: 'Test' }]
				};

				const result = parsePaginatedResponse(input, SimpleRecordSchema);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.sortDirection).toBe(sortDirection);
				}
			}
		});

		it('should use default values for optional fields', () => {
			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 100,
				records: []
			};

			const result = parsePaginatedResponse(input, SimpleRecordSchema);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.sortKey).toBe('');
				expect(result.data.sortDirection).toBe('ascending');
			}
		});

		it('should ignore extra unknown fields (Req 27.7)', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 1,
				records: [{ id: 1, title: 'Test' }],
				extraField: 'ignored',
				metadata: { version: '2.0' }
			};

			const result = parsePaginatedResponse(input, SimpleRecordSchema);

			expect(result.success).toBe(true);
		});
	});

	describe('invalid inputs (Req 27.8)', () => {
		it('should return error for null input', () => {
			const result = parsePaginatedResponse(null, SimpleRecordSchema);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required fields', () => {
			const result = parsePaginatedResponse(
				{ page: 1, pageSize: 10 }, // missing totalRecords, records
				SimpleRecordSchema
			);
			expect(result.success).toBe(false);
		});

		it('should return error for non-array records', () => {
			const result = parsePaginatedResponse(
				{
					page: 1,
					pageSize: 10,
					totalRecords: 1,
					records: 'not an array'
				},
				SimpleRecordSchema
			);
			expect(result.success).toBe(false);
		});

		it('should return error for invalid records in array', () => {
			const result = parsePaginatedResponse(
				{
					page: 1,
					pageSize: 10,
					totalRecords: 1,
					records: [{ id: 'not a number', title: 123 }] // Both wrong types
				},
				SimpleRecordSchema
			);
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on page', () => {
			const result = parsePaginatedResponse(
				{
					page: 'one',
					pageSize: 10,
					totalRecords: 0,
					records: []
				},
				SimpleRecordSchema
			);
			expect(result.success).toBe(false);
		});
	});

	describe('large page sizes (Req 29.1)', () => {
		it('should handle pageSize of 1000 (standard pagination size)', () => {
			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 5000,
				records: []
			};

			const result = parsePaginatedResponse(input, SimpleRecordSchema);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.pageSize).toBe(1000);
			}
		});
	});
});

describe('parseRecordsWithWarnings', () => {
	const SimpleRecordSchema = v.object({
		id: v.number(),
		name: v.string()
	});

	it('should return all valid records', () => {
		const records = [
			{ id: 1, name: 'First' },
			{ id: 2, name: 'Second' },
			{ id: 3, name: 'Third' }
		];

		const result = parseRecordsWithWarnings(records, SimpleRecordSchema);

		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({ id: 1, name: 'First' });
	});

	it('should filter out invalid records', () => {
		const records = [
			{ id: 1, name: 'Valid' },
			{ id: 'invalid', name: 'Invalid ID' }, // Invalid
			{ id: 2, name: 'Also Valid' },
			null, // Invalid
			{ id: 3 } // Missing name
		];

		const result = parseRecordsWithWarnings(records, SimpleRecordSchema);

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ id: 1, name: 'Valid' });
		expect(result[1]).toEqual({ id: 2, name: 'Also Valid' });
	});

	it('should call onInvalid callback for invalid records', () => {
		const records = [
			{ id: 1, name: 'Valid' },
			{ id: 'invalid', name: 'Bad' },
			null
		];

		const onInvalid = vi.fn();

		parseRecordsWithWarnings(records, SimpleRecordSchema, onInvalid);

		expect(onInvalid).toHaveBeenCalledTimes(2);
		expect(onInvalid).toHaveBeenCalledWith({ id: 'invalid', name: 'Bad' }, expect.any(String));
		expect(onInvalid).toHaveBeenCalledWith(null, expect.any(String));
	});

	it('should return empty array for all invalid records', () => {
		const records = [null, undefined, 'string', 123, { invalid: true }];

		const result = parseRecordsWithWarnings(records, SimpleRecordSchema);

		expect(result).toHaveLength(0);
	});

	it('should handle empty input array', () => {
		const result = parseRecordsWithWarnings([], SimpleRecordSchema);
		expect(result).toHaveLength(0);
	});
});

describe('createPaginatedResponseSchema', () => {
	it('should create a schema that validates against the record schema', () => {
		const RecordSchema = v.object({
			id: v.number(),
			title: v.string(),
			year: v.number()
		});

		const PaginatedSchema = createPaginatedResponseSchema(RecordSchema);

		const validInput = {
			page: 1,
			pageSize: 10,
			totalRecords: 1,
			records: [{ id: 1, title: 'Test Movie', year: 2024 }]
		};

		const result = v.safeParse(PaginatedSchema, validInput);
		expect(result.success).toBe(true);
	});

	it('should fail validation when records do not match schema', () => {
		const RecordSchema = v.object({
			id: v.number(),
			title: v.string()
		});

		const PaginatedSchema = createPaginatedResponseSchema(RecordSchema);

		const invalidInput = {
			page: 1,
			pageSize: 10,
			totalRecords: 1,
			records: [{ id: 'wrong type', title: 123 }] // Both wrong types
		};

		const result = v.safeParse(PaginatedSchema, invalidInput);
		expect(result.success).toBe(false);
	});
});

describe('Schema exports', () => {
	it('QualityModelSchema should be a valid valibot schema', () => {
		expect(QualityModelSchema).toBeDefined();
		expect(typeof QualityModelSchema).toBe('object');
	});

	it('CommandResponseSchema should be a valid valibot schema', () => {
		expect(CommandResponseSchema).toBeDefined();
		expect(typeof CommandResponseSchema).toBe('object');
	});
});

describe('parsePaginatedResponseLenient', () => {
	const SimpleRecordSchema = v.object({
		id: v.number(),
		title: v.string()
	});

	describe('valid inputs', () => {
		it('should parse a valid paginated response with all valid records', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 2,
				records: [
					{ id: 1, title: 'First' },
					{ id: 2, title: 'Second' }
				]
			};

			const result = parsePaginatedResponseLenient(input, SimpleRecordSchema);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.page).toBe(1);
				expect(result.data.records).toHaveLength(2);
				expect(result.skipped).toBe(0);
			}
		});

		it('should skip malformed records and continue (Req 27.8)', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 5,
				records: [
					{ id: 1, title: 'Valid' },
					{ id: 'invalid', title: 'Bad ID' }, // Invalid - id should be number
					{ id: 2, title: 'Also Valid' },
					null, // Invalid - not an object
					{ id: 3, title: 'Third Valid' }
				]
			};

			const result = parsePaginatedResponseLenient(input, SimpleRecordSchema);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(3);
				expect(result.skipped).toBe(2);
				expect(result.data.records[0]).toEqual({ id: 1, title: 'Valid' });
				expect(result.data.records[1]).toEqual({ id: 2, title: 'Also Valid' });
				expect(result.data.records[2]).toEqual({ id: 3, title: 'Third Valid' });
			}
		});

		it('should call onInvalid callback for each malformed record (Req 27.8)', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 3,
				records: [
					{ id: 1, title: 'Valid' },
					{ id: 'invalid', title: 'Bad' },
					{ title: 'Missing ID' }
				]
			};

			const onInvalid = vi.fn();
			const result = parsePaginatedResponseLenient(input, SimpleRecordSchema, onInvalid);

			expect(result.success).toBe(true);
			expect(onInvalid).toHaveBeenCalledTimes(2);
			expect(onInvalid).toHaveBeenCalledWith({ id: 'invalid', title: 'Bad' }, expect.any(String));
			expect(onInvalid).toHaveBeenCalledWith({ title: 'Missing ID' }, expect.any(String));
		});

		it('should return all skipped if all records are invalid', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 3,
				records: [null, undefined, { wrong: 'type' }]
			};

			const result = parsePaginatedResponseLenient(input, SimpleRecordSchema);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(0);
				expect(result.skipped).toBe(3);
			}
		});

		it('should ignore extra unknown fields in records (Req 27.7)', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 1,
				records: [{ id: 1, title: 'Test', extraField: 'ignored', nested: { foo: 'bar' } }]
			};

			const result = parsePaginatedResponseLenient(input, SimpleRecordSchema);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(1);
				expect(result.skipped).toBe(0);
				expect(result.data.records[0]).toEqual({ id: 1, title: 'Test' });
			}
		});

		it('should handle empty records array', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 0,
				records: []
			};

			const result = parsePaginatedResponseLenient(input, SimpleRecordSchema);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(0);
				expect(result.skipped).toBe(0);
			}
		});
	});

	describe('invalid pagination structure', () => {
		it('should return error for null input', () => {
			const result = parsePaginatedResponseLenient(null, SimpleRecordSchema);
			expect(result.success).toBe(false);
		});

		it('should return error for missing pagination fields', () => {
			const result = parsePaginatedResponseLenient(
				{ page: 1, pageSize: 10 }, // missing totalRecords, records
				SimpleRecordSchema
			);
			expect(result.success).toBe(false);
		});

		it('should return error for non-array records field', () => {
			const result = parsePaginatedResponseLenient(
				{ page: 1, pageSize: 10, totalRecords: 1, records: 'not an array' },
				SimpleRecordSchema
			);
			expect(result.success).toBe(false);
		});
	});
});
