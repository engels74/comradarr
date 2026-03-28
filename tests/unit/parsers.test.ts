/**
 * Unit tests for API response parsers
 *
 * Tests cover:
 * - parseCommandResponse() valid and invalid inputs
 * - parsePaginatedResponseLenient() valid and invalid inputs
 * - Edge cases for all parsers
 *

 */

import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import {
	CommandResponseSchema,
	parseCommandResponse,
	parsePaginatedResponseLenient,
	QualityModelSchema
} from '../../src/lib/server/connectors/common/parsers';

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
