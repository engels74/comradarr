/**
 * Unit tests for Prowlarr API response parsers
 *
 * Tests cover:
 * - Valid data parsing
 * - Invalid data rejection with error messages
 * - Nullable field handling
 * - Unknown field tolerance (ignored fields)
 *

 */

import { describe, it, expect } from 'vitest';
import {
	parseProwlarrIndexerStatus,
	parseProwlarrIndexer
} from '../../src/lib/server/services/prowlarr/parsers';

describe('parseProwlarrIndexerStatus', () => {
	describe('valid data', () => {
		it('should parse complete indexer status', () => {
			const data = {
				id: 1,
				indexerId: 10,
				disabledTill: '2025-12-01T00:00:00Z',
				mostRecentFailure: '2025-11-30T12:00:00Z',
				initialFailure: '2025-11-30T10:00:00Z'
			};

			const result = parseProwlarrIndexerStatus(data);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual(data);
			}
		});

		it('should parse status with null disabledTill', () => {
			const data = {
				id: 1,
				indexerId: 10,
				disabledTill: null,
				mostRecentFailure: null,
				initialFailure: null
			};

			const result = parseProwlarrIndexerStatus(data);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.disabledTill).toBeNull();
				expect(result.data.mostRecentFailure).toBeNull();
				expect(result.data.initialFailure).toBeNull();
			}
		});

		it('should parse status with mixed null and non-null fields', () => {
			const data = {
				id: 1,
				indexerId: 10,
				disabledTill: '2025-12-01T00:00:00Z',
				mostRecentFailure: null,
				initialFailure: '2025-11-30T10:00:00Z'
			};

			const result = parseProwlarrIndexerStatus(data);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.disabledTill).toBe('2025-12-01T00:00:00Z');
				expect(result.data.mostRecentFailure).toBeNull();
				expect(result.data.initialFailure).toBe('2025-11-30T10:00:00Z');
			}
		});

		it('should ignore unknown fields', () => {
			const data = {
				id: 1,
				indexerId: 10,
				disabledTill: null,
				mostRecentFailure: null,
				initialFailure: null,
				unknownField: 'should be ignored',
				anotherUnknown: 123
			};

			const result = parseProwlarrIndexerStatus(data);

			expect(result.success).toBe(true);
		});
	});

	describe('invalid data', () => {
		it('should fail when id is missing', () => {
			const data = {
				indexerId: 10,
				disabledTill: null,
				mostRecentFailure: null,
				initialFailure: null
			};

			const result = parseProwlarrIndexerStatus(data);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('Invalid indexer status response');
			}
		});

		it('should fail when indexerId is missing', () => {
			const data = {
				id: 1,
				disabledTill: null,
				mostRecentFailure: null,
				initialFailure: null
			};

			const result = parseProwlarrIndexerStatus(data);

			expect(result.success).toBe(false);
		});

		it('should fail when id is not a number', () => {
			const data = {
				id: 'not-a-number',
				indexerId: 10,
				disabledTill: null,
				mostRecentFailure: null,
				initialFailure: null
			};

			const result = parseProwlarrIndexerStatus(data);

			expect(result.success).toBe(false);
		});

		it('should fail when input is null', () => {
			const result = parseProwlarrIndexerStatus(null);

			expect(result.success).toBe(false);
		});

		it('should fail when input is undefined', () => {
			const result = parseProwlarrIndexerStatus(undefined);

			expect(result.success).toBe(false);
		});

		it('should fail when input is an array', () => {
			const result = parseProwlarrIndexerStatus([]);

			expect(result.success).toBe(false);
		});

		it('should fail when input is a primitive', () => {
			const result = parseProwlarrIndexerStatus('string');

			expect(result.success).toBe(false);
		});
	});
});

describe('parseProwlarrIndexer', () => {
	describe('valid data', () => {
		it('should parse complete indexer definition', () => {
			const data = {
				id: 10,
				name: 'NZBgeek',
				implementation: 'Newznab',
				enable: true,
				protocol: 'usenet',
				priority: 25
			};

			const result = parseProwlarrIndexer(data);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).toEqual(data);
			}
		});

		it('should parse disabled indexer', () => {
			const data = {
				id: 20,
				name: '1337x',
				implementation: 'Torznab',
				enable: false,
				protocol: 'torrent',
				priority: 50
			};

			const result = parseProwlarrIndexer(data);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.enable).toBe(false);
			}
		});

		it('should ignore unknown fields', () => {
			const data = {
				id: 10,
				name: 'NZBgeek',
				implementation: 'Newznab',
				enable: true,
				protocol: 'usenet',
				priority: 25,
				fields: [], // Extra field from API
				categories: [1000, 2000], // Extra field
				configContract: 'NewznabSettings' // Extra field
			};

			const result = parseProwlarrIndexer(data);

			expect(result.success).toBe(true);
		});
	});

	describe('invalid data', () => {
		it('should fail when id is missing', () => {
			const data = {
				name: 'NZBgeek',
				implementation: 'Newznab',
				enable: true,
				protocol: 'usenet',
				priority: 25
			};

			const result = parseProwlarrIndexer(data);

			expect(result.success).toBe(false);
		});

		it('should fail when name is missing', () => {
			const data = {
				id: 10,
				implementation: 'Newznab',
				enable: true,
				protocol: 'usenet',
				priority: 25
			};

			const result = parseProwlarrIndexer(data);

			expect(result.success).toBe(false);
		});

		it('should fail when enable is not a boolean', () => {
			const data = {
				id: 10,
				name: 'NZBgeek',
				implementation: 'Newznab',
				enable: 'yes', // Should be boolean
				protocol: 'usenet',
				priority: 25
			};

			const result = parseProwlarrIndexer(data);

			expect(result.success).toBe(false);
		});

		it('should fail when priority is not a number', () => {
			const data = {
				id: 10,
				name: 'NZBgeek',
				implementation: 'Newznab',
				enable: true,
				protocol: 'usenet',
				priority: 'high' // Should be number
			};

			const result = parseProwlarrIndexer(data);

			expect(result.success).toBe(false);
		});

		it('should fail when input is null', () => {
			const result = parseProwlarrIndexer(null);

			expect(result.success).toBe(false);
		});

		it('should fail when input is an empty object', () => {
			const result = parseProwlarrIndexer({});

			expect(result.success).toBe(false);
		});
	});
});
