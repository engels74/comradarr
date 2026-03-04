import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db/queries/analytics', () => ({
	getDailyStatsForExport: vi.fn()
}));

vi.mock('$lib/server/auth', () => ({
	requireScope: vi.fn()
}));

import type { ExportRow } from '$lib/server/db/queries/analytics';
import { escapeCSVField, toCSV } from './+server';

function makeRow(overrides: Partial<ExportRow> = {}): ExportRow {
	return {
		date: '2024-01-15',
		connector: 'Test Sonarr',
		connectorType: 'sonarr',
		gapsDiscovered: 5,
		upgradesDiscovered: 2,
		searchesDispatched: 10,
		searchesSuccessful: 8,
		searchesFailed: 1,
		searchesNoResults: 1,
		avgQueueDepth: 3,
		peakQueueDepth: 7,
		avgResponseTimeMs: 150,
		errorCount: 0,
		successRate: 80,
		...overrides
	};
}

describe('escapeCSVField', () => {
	describe('formula prefix neutralization', () => {
		it('should prefix = with single quote', () => {
			expect(escapeCSVField('=CMD()')).toBe("'=CMD()");
		});

		it('should prefix + with single quote', () => {
			expect(escapeCSVField('+1+1')).toBe("'+1+1");
		});

		it('should prefix - with single quote', () => {
			expect(escapeCSVField('-1+1')).toBe("'-1+1");
		});

		it('should prefix @ with single quote', () => {
			expect(escapeCSVField('@SUM(A1)')).toBe("'@SUM(A1)");
		});

		it('should prefix tab character with single quote', () => {
			expect(escapeCSVField('\tmalicious')).toBe("'\tmalicious");
		});

		it('should prefix carriage return with single quote and quote the field', () => {
			expect(escapeCSVField('\rmalicious')).toBe('"\'\rmalicious"');
		});

		it('should prefix line feed with single quote and quote the field', () => {
			expect(escapeCSVField('\nmalicious')).toBe('"\'\nmalicious"');
		});

		it('should prefix full-width ＝ with single quote', () => {
			expect(escapeCSVField('＝CMD()')).toBe("'＝CMD()");
		});

		it('should prefix full-width ＋ with single quote', () => {
			expect(escapeCSVField('＋1+1')).toBe("'＋1+1");
		});

		it('should prefix full-width － with single quote', () => {
			expect(escapeCSVField('－1+1')).toBe("'－1+1");
		});

		it('should prefix full-width ＠ with single quote', () => {
			expect(escapeCSVField('＠SUM(A1)')).toBe("'＠SUM(A1)");
		});
	});

	describe('normal strings', () => {
		it('should pass through regular text unchanged', () => {
			expect(escapeCSVField('hello world')).toBe('hello world');
		});

		it('should pass through empty string unchanged', () => {
			expect(escapeCSVField('')).toBe('');
		});

		it('should pass through single word unchanged', () => {
			expect(escapeCSVField('sonarr')).toBe('sonarr');
		});
	});

	describe('numbers', () => {
		it('should pass through positive integers as-is', () => {
			expect(escapeCSVField(42)).toBe('42');
		});

		it('should pass through zero as-is', () => {
			expect(escapeCSVField(0)).toBe('0');
		});

		it('should pass through negative numbers without quote prefix', () => {
			expect(escapeCSVField(-5)).toBe('-5');
		});

		it('should pass through decimals as-is', () => {
			expect(escapeCSVField(3.14)).toBe('3.14');
		});
	});

	describe('null/undefined handling', () => {
		it('should return empty string for null', () => {
			expect(escapeCSVField(null)).toBe('');
		});
	});

	describe('RFC 4180 quoting', () => {
		it('should quote fields containing commas', () => {
			expect(escapeCSVField('hello, world')).toBe('"hello, world"');
		});

		it('should quote and escape fields containing double quotes', () => {
			expect(escapeCSVField('say "hello"')).toBe('"say ""hello"""');
		});

		it('should quote fields containing newlines', () => {
			expect(escapeCSVField('line1\nline2')).toBe('"line1\nline2"');
		});

		it('should handle fields with both commas and quotes', () => {
			expect(escapeCSVField('a "b", c')).toBe('"a ""b"", c"');
		});
	});

	describe('combined cases', () => {
		it('should sanitize formula prefix and quote for comma', () => {
			expect(escapeCSVField('=SUM(A1),evil')).toBe('"\'=SUM(A1),evil"');
		});

		it('should sanitize formula prefix and quote for newline', () => {
			expect(escapeCSVField('+cmd\nevil')).toBe('"\'+cmd\nevil"');
		});

		it('should sanitize formula prefix and escape double quotes', () => {
			expect(escapeCSVField('@"inject"')).toBe('"\'@""inject"""');
		});
	});
});

describe('toCSV', () => {
	it('should produce header row as first line', () => {
		const result = toCSV([]);
		const lines = result.split('\n');
		expect(lines).toHaveLength(1);
		expect(lines[0]).toBe(
			'date,connector,connector_type,gaps_discovered,upgrades_discovered,' +
				'searches_dispatched,searches_successful,searches_failed,searches_no_results,' +
				'avg_queue_depth,peak_queue_depth,avg_response_time_ms,error_count,success_rate'
		);
	});

	it('should produce correct CSV with one row', () => {
		const rows = [makeRow()];
		const result = toCSV(rows);
		const lines = result.split('\n');
		expect(lines).toHaveLength(2);
		expect(lines[1]).toBe('2024-01-15,Test Sonarr,sonarr,5,2,10,8,1,1,3,7,150,0,80');
	});

	it('should handle null avgResponseTimeMs', () => {
		const rows = [makeRow({ avgResponseTimeMs: null })];
		const result = toCSV(rows);
		const lines = result.split('\n');
		const fields = lines[1]!.split(',');
		expect(fields[11]).toBe('');
	});

	it('should sanitize formula characters in connector names', () => {
		const rows = [makeRow({ connector: '=EVIL()' })];
		const result = toCSV(rows);
		const lines = result.split('\n');
		expect(lines[1]).toContain("'=EVIL()");
	});

	it('should quote connector names containing commas', () => {
		const rows = [makeRow({ connector: 'Sonarr, Main' })];
		const result = toCSV(rows);
		const lines = result.split('\n');
		expect(lines[1]).toContain('"Sonarr, Main"');
	});

	it('should produce correct number of rows', () => {
		const rows = [makeRow(), makeRow({ date: '2024-01-16' }), makeRow({ date: '2024-01-17' })];
		const result = toCSV(rows);
		const lines = result.split('\n');
		expect(lines).toHaveLength(4);
	});
});
