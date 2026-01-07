/**
 * Unit tests for Sonarr API response parsers
 *
 * Tests cover:
 * - parseSonarrSeries() valid and invalid inputs
 * - parseSonarrEpisode() valid and invalid inputs
 * - parsePaginatedSeries() valid and invalid inputs
 * - parsePaginatedEpisodes() valid and invalid inputs
 * - Edge cases for all parsers
 *

 */

import { describe, expect, it, vi } from 'vitest';
import {
	parsePaginatedEpisodes,
	parsePaginatedEpisodesLenient,
	parsePaginatedSeries,
	parsePaginatedSeriesLenient,
	parseSonarrEpisode,
	parseSonarrSeries,
	SonarrEpisodeSchema,
	SonarrSeriesSchema
} from '../../src/lib/server/connectors/sonarr/parsers';

// =============================================================================
// Test Data Fixtures
// =============================================================================

const validSeason = {
	seasonNumber: 1,
	monitored: true,
	statistics: {
		episodeFileCount: 10,
		episodeCount: 10,
		totalEpisodeCount: 12,
		sizeOnDisk: 5000000000,
		percentOfEpisodes: 83.33
	}
};

const minimalSeason = {
	seasonNumber: 0,
	monitored: false
};

const validSeriesStatistics = {
	seasonCount: 5,
	episodeFileCount: 50,
	episodeCount: 60,
	sizeOnDisk: 50000000000,
	percentOfEpisodes: 83.33
};

const validSeries = {
	id: 123,
	title: 'Breaking Bad',
	tvdbId: 81189,
	status: 'ended',
	monitored: true,
	qualityProfileId: 4,
	seasons: [validSeason, minimalSeason],
	statistics: validSeriesStatistics
};

const minimalSeries = {
	id: 1,
	title: 'Test Series',
	tvdbId: 12345,
	status: 'continuing',
	monitored: true,
	qualityProfileId: 1,
	seasons: []
};

const validQualityModel = {
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

const validEpisodeFile = {
	id: 456,
	quality: validQualityModel,
	size: 1500000000,
	relativePath: 'Breaking Bad/Season 1/Breaking.Bad.S01E01.1080p.HDTV.mkv'
};

const validEpisode = {
	id: 789,
	seriesId: 123,
	seasonNumber: 1,
	episodeNumber: 1,
	title: 'Pilot',
	airDateUtc: '2008-01-20T02:00:00Z',
	hasFile: true,
	monitored: true,
	qualityCutoffNotMet: false,
	episodeFileId: 456,
	episodeFile: validEpisodeFile
};

const minimalEpisode = {
	id: 1,
	seriesId: 1,
	seasonNumber: 1,
	episodeNumber: 1,
	hasFile: false,
	monitored: true,
	qualityCutoffNotMet: true
};

// =============================================================================
// parseSonarrSeries Tests
// =============================================================================

describe('parseSonarrSeries', () => {
	describe('valid inputs', () => {
		it('should parse a complete valid series (Req 27.2)', () => {
			const result = parseSonarrSeries(validSeries);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(123);
				expect(result.data.title).toBe('Breaking Bad');
				expect(result.data.tvdbId).toBe(81189);
				expect(result.data.status).toBe('ended');
				expect(result.data.monitored).toBe(true);
				expect(result.data.qualityProfileId).toBe(4);
				expect(result.data.seasons).toHaveLength(2);
				expect(result.data.statistics).toBeDefined();
				expect(result.data.statistics?.seasonCount).toBe(5);
			}
		});

		it('should parse a minimal series without statistics', () => {
			const result = parseSonarrSeries(minimalSeries);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(1);
				expect(result.data.title).toBe('Test Series');
				expect(result.data.seasons).toHaveLength(0);
				expect(result.data.statistics).toBeUndefined();
			}
		});

		it('should parse seasons with and without statistics', () => {
			const result = parseSonarrSeries(validSeries);

			expect(result.success).toBe(true);
			if (result.success) {
				// First season has statistics
				expect(result.data.seasons[0]?.statistics).toBeDefined();
				expect(result.data.seasons[0]?.statistics?.episodeFileCount).toBe(10);

				// Second season (specials) has no statistics
				expect(result.data.seasons[1]?.seasonNumber).toBe(0);
				expect(result.data.seasons[1]?.statistics).toBeUndefined();
			}
		});

		it('should ignore extra unknown fields (Req 27.7)', () => {
			const input = {
				...validSeries,
				unknownField: 'should be ignored',
				nestedUnknown: { foo: 'bar' },
				path: '/tv/Breaking Bad',
				rootFolderPath: '/tv'
			};

			const result = parseSonarrSeries(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(123);
				expect('unknownField' in result.data).toBe(false);
				expect('path' in result.data).toBe(false);
			}
		});

		it('should handle various status values', () => {
			const statuses = ['continuing', 'ended', 'upcoming', 'deleted'];

			for (const status of statuses) {
				const input = { ...minimalSeries, status };
				const result = parseSonarrSeries(input);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.status).toBe(status);
				}
			}
		});
	});

	describe('invalid inputs (Req 27.8)', () => {
		it('should return error for null input', () => {
			const result = parseSonarrSeries(null);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('Invalid Sonarr series response');
			}
		});

		it('should return error for undefined input', () => {
			const result = parseSonarrSeries(undefined);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required id field', () => {
			const { id: _id, ...withoutId } = validSeries;
			const result = parseSonarrSeries(withoutId);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required title field', () => {
			const { title: _title, ...withoutTitle } = validSeries;
			const result = parseSonarrSeries(withoutTitle);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required tvdbId field', () => {
			const { tvdbId: _tvdbId, ...withoutTvdbId } = validSeries;
			const result = parseSonarrSeries(withoutTvdbId);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required seasons array', () => {
			const { seasons: _seasons, ...withoutSeasons } = validSeries;
			const result = parseSonarrSeries(withoutSeasons);
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on id', () => {
			const result = parseSonarrSeries({ ...validSeries, id: 'not a number' });
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on tvdbId', () => {
			const result = parseSonarrSeries({ ...validSeries, tvdbId: 'not a number' });
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on monitored', () => {
			const result = parseSonarrSeries({ ...validSeries, monitored: 'yes' });
			expect(result.success).toBe(false);
		});

		it('should return error for non-array seasons', () => {
			const result = parseSonarrSeries({ ...validSeries, seasons: 'not an array' });
			expect(result.success).toBe(false);
		});

		it('should return error for invalid season in array', () => {
			const result = parseSonarrSeries({
				...validSeries,
				seasons: [{ seasonNumber: 'not a number', monitored: true }]
			});
			expect(result.success).toBe(false);
		});
	});

	describe('edge cases', () => {
		it('should handle zero values', () => {
			const input = {
				id: 0,
				title: 'Zero ID Series',
				tvdbId: 0,
				status: 'upcoming',
				monitored: false,
				qualityProfileId: 0,
				seasons: [{ seasonNumber: 0, monitored: false }]
			};

			const result = parseSonarrSeries(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(0);
				expect(result.data.tvdbId).toBe(0);
			}
		});

		it('should handle empty strings', () => {
			const input = {
				...minimalSeries,
				title: '',
				status: ''
			};

			const result = parseSonarrSeries(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.title).toBe('');
				expect(result.data.status).toBe('');
			}
		});

		it('should handle large numbers in statistics', () => {
			const input = {
				...minimalSeries,
				statistics: {
					seasonCount: 100,
					episodeFileCount: 10000,
					episodeCount: 10000,
					sizeOnDisk: 999999999999999,
					percentOfEpisodes: 100
				}
			};

			const result = parseSonarrSeries(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.statistics?.sizeOnDisk).toBe(999999999999999);
			}
		});
	});
});

// =============================================================================
// parseSonarrEpisode Tests
// =============================================================================

describe('parseSonarrEpisode', () => {
	describe('valid inputs', () => {
		it('should parse a complete valid episode (Req 27.3)', () => {
			const result = parseSonarrEpisode(validEpisode);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(789);
				expect(result.data.seriesId).toBe(123);
				expect(result.data.seasonNumber).toBe(1);
				expect(result.data.episodeNumber).toBe(1);
				expect(result.data.title).toBe('Pilot');
				expect(result.data.airDateUtc).toBe('2008-01-20T02:00:00Z');
				expect(result.data.hasFile).toBe(true);
				expect(result.data.monitored).toBe(true);
				expect(result.data.qualityCutoffNotMet).toBe(false);
				expect(result.data.episodeFileId).toBe(456);
				expect(result.data.episodeFile).toBeDefined();
			}
		});

		it('should parse a minimal episode without optional fields', () => {
			const result = parseSonarrEpisode(minimalEpisode);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(1);
				expect(result.data.seriesId).toBe(1);
				expect(result.data.hasFile).toBe(false);
				expect(result.data.qualityCutoffNotMet).toBe(true);
				expect(result.data.title).toBeUndefined();
				expect(result.data.airDateUtc).toBeUndefined();
				expect(result.data.episodeFileId).toBeUndefined();
				expect(result.data.episodeFile).toBeUndefined();
			}
		});

		it('should parse episode file with quality model', () => {
			const result = parseSonarrEpisode(validEpisode);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.episodeFile).toBeDefined();
				expect(result.data.episodeFile?.quality.quality.name).toBe('HDTV-1080p');
				expect(result.data.episodeFile?.quality.quality.resolution).toBe(1080);
				expect(result.data.episodeFile?.quality.revision.isRepack).toBe(false);
			}
		});

		it('should ignore extra unknown fields (Req 27.7)', () => {
			const input = {
				...validEpisode,
				unknownField: 'should be ignored',
				series: { id: 123, title: 'Breaking Bad' },
				absoluteEpisodeNumber: 1,
				sceneSeasonNumber: 1
			};

			const result = parseSonarrEpisode(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(789);
				expect('unknownField' in result.data).toBe(false);
				expect('series' in result.data).toBe(false);
			}
		});

		it('should handle upgrade candidate flag correctly', () => {
			const upgradeCandidate = { ...validEpisode, qualityCutoffNotMet: true };
			const result = parseSonarrEpisode(upgradeCandidate);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.qualityCutoffNotMet).toBe(true);
			}
		});
	});

	describe('invalid inputs (Req 27.8)', () => {
		it('should return error for null input', () => {
			const result = parseSonarrEpisode(null);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('Invalid Sonarr episode response');
			}
		});

		it('should return error for undefined input', () => {
			const result = parseSonarrEpisode(undefined);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required id field', () => {
			const { id: _id, ...withoutId } = validEpisode;
			const result = parseSonarrEpisode(withoutId);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required seriesId field', () => {
			const { seriesId: _seriesId, ...withoutSeriesId } = validEpisode;
			const result = parseSonarrEpisode(withoutSeriesId);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required hasFile field', () => {
			const { hasFile: _hasFile, ...withoutHasFile } = validEpisode;
			const result = parseSonarrEpisode(withoutHasFile);
			expect(result.success).toBe(false);
		});

		it('should succeed with null qualityCutoffNotMet when field is missing', () => {
			// qualityCutoffNotMet is optional because Sonarr omits it when episode has no file
			const { qualityCutoffNotMet: _qcnm, ...withoutQCNM } = validEpisode;
			const result = parseSonarrEpisode(withoutQCNM);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.qualityCutoffNotMet).toBe(null);
			}
		});

		it('should return error for wrong type on seasonNumber', () => {
			const result = parseSonarrEpisode({ ...validEpisode, seasonNumber: 'one' });
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on episodeNumber', () => {
			const result = parseSonarrEpisode({ ...validEpisode, episodeNumber: 'one' });
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on hasFile', () => {
			const result = parseSonarrEpisode({ ...validEpisode, hasFile: 'yes' });
			expect(result.success).toBe(false);
		});

		it('should return error for invalid episodeFile quality', () => {
			const result = parseSonarrEpisode({
				...validEpisode,
				episodeFile: {
					id: 1,
					quality: { invalid: 'structure' },
					size: 1000
				}
			});
			expect(result.success).toBe(false);
		});
	});

	describe('edge cases', () => {
		it('should handle specials (season 0)', () => {
			const special = { ...minimalEpisode, seasonNumber: 0, episodeNumber: 1 };
			const result = parseSonarrEpisode(special);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.seasonNumber).toBe(0);
			}
		});

		it('should handle zero episode number', () => {
			const input = { ...minimalEpisode, episodeNumber: 0 };
			const result = parseSonarrEpisode(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.episodeNumber).toBe(0);
			}
		});

		it('should handle empty title', () => {
			const input = { ...minimalEpisode, title: '' };
			const result = parseSonarrEpisode(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.title).toBe('');
			}
		});

		it('should handle future air dates', () => {
			const input = { ...minimalEpisode, airDateUtc: '2099-12-31T23:59:59Z' };
			const result = parseSonarrEpisode(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.airDateUtc).toBe('2099-12-31T23:59:59Z');
			}
		});
	});
});

// =============================================================================
// parsePaginatedSeries Tests
// =============================================================================

describe('parsePaginatedSeries', () => {
	describe('valid inputs', () => {
		it('should parse a valid paginated series response', () => {
			const input = {
				page: 1,
				pageSize: 10,
				sortKey: 'title',
				sortDirection: 'ascending',
				totalRecords: 25,
				records: [validSeries, minimalSeries]
			};

			const result = parsePaginatedSeries(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.page).toBe(1);
				expect(result.data.pageSize).toBe(10);
				expect(result.data.totalRecords).toBe(25);
				expect(result.data.records).toHaveLength(2);
				expect(result.data.records[0]?.title).toBe('Breaking Bad');
			}
		});

		it('should parse an empty records array', () => {
			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 0,
				records: []
			};

			const result = parsePaginatedSeries(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(0);
				expect(result.data.totalRecords).toBe(0);
			}
		});

		it('should use default values for optional pagination fields', () => {
			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 100,
				records: []
			};

			const result = parsePaginatedSeries(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.sortKey).toBe('');
				expect(result.data.sortDirection).toBe('ascending');
			}
		});
	});

	describe('invalid inputs (Req 27.8)', () => {
		it('should return error for null input', () => {
			const result = parsePaginatedSeries(null);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required fields', () => {
			const result = parsePaginatedSeries({ page: 1, pageSize: 10 });
			expect(result.success).toBe(false);
		});

		it('should return error for invalid series in array', () => {
			const result = parsePaginatedSeries({
				page: 1,
				pageSize: 10,
				totalRecords: 1,
				records: [{ id: 'invalid', title: 123 }]
			});
			expect(result.success).toBe(false);
		});
	});

	describe('large datasets (Req 29.1)', () => {
		it('should handle pageSize of 1000', () => {
			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 5000,
				records: []
			};

			const result = parsePaginatedSeries(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.pageSize).toBe(1000);
			}
		});
	});
});

// =============================================================================
// parsePaginatedEpisodes Tests
// =============================================================================

describe('parsePaginatedEpisodes', () => {
	describe('valid inputs', () => {
		it('should parse a valid paginated episodes response', () => {
			const input = {
				page: 1,
				pageSize: 10,
				sortKey: 'airDateUtc',
				sortDirection: 'descending',
				totalRecords: 100,
				records: [validEpisode, minimalEpisode]
			};

			const result = parsePaginatedEpisodes(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.page).toBe(1);
				expect(result.data.pageSize).toBe(10);
				expect(result.data.totalRecords).toBe(100);
				expect(result.data.records).toHaveLength(2);
				expect(result.data.records[0]?.title).toBe('Pilot');
				expect(result.data.records[1]?.hasFile).toBe(false);
			}
		});

		it('should parse wanted/missing response (empty episodes)', () => {
			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 0,
				records: []
			};

			const result = parsePaginatedEpisodes(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(0);
			}
		});

		it('should handle both sort directions', () => {
			for (const sortDirection of ['ascending', 'descending'] as const) {
				const input = {
					page: 1,
					pageSize: 10,
					sortDirection,
					totalRecords: 1,
					records: [minimalEpisode]
				};

				const result = parsePaginatedEpisodes(input);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.sortDirection).toBe(sortDirection);
				}
			}
		});
	});

	describe('invalid inputs (Req 27.8)', () => {
		it('should return error for null input', () => {
			const result = parsePaginatedEpisodes(null);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required fields', () => {
			const result = parsePaginatedEpisodes({ page: 1, pageSize: 10 });
			expect(result.success).toBe(false);
		});

		it('should return error for invalid episode in array', () => {
			const result = parsePaginatedEpisodes({
				page: 1,
				pageSize: 10,
				totalRecords: 1,
				records: [{ id: 'invalid', seriesId: 'invalid' }]
			});
			expect(result.success).toBe(false);
		});
	});

	describe('wanted endpoints simulation', () => {
		it('should parse missing episodes (hasFile=false)', () => {
			const missingEpisodes = [
				{ ...minimalEpisode, id: 1 },
				{ ...minimalEpisode, id: 2 },
				{ ...minimalEpisode, id: 3 }
			];

			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 3,
				records: missingEpisodes
			};

			const result = parsePaginatedEpisodes(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(3);
				expect(result.data.records.every((e) => e.hasFile === false)).toBe(true);
			}
		});

		it('should parse cutoff unmet episodes (qualityCutoffNotMet=true)', () => {
			const cutoffEpisodes = [
				{ ...validEpisode, id: 1, qualityCutoffNotMet: true },
				{ ...validEpisode, id: 2, qualityCutoffNotMet: true }
			];

			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 2,
				records: cutoffEpisodes
			};

			const result = parsePaginatedEpisodes(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(2);
				expect(result.data.records.every((e) => e.qualityCutoffNotMet === true)).toBe(true);
			}
		});
	});
});

// =============================================================================
// Schema Export Tests
// =============================================================================

describe('Schema exports', () => {
	it('SonarrSeriesSchema should be a valid valibot schema', () => {
		expect(SonarrSeriesSchema).toBeDefined();
		expect(typeof SonarrSeriesSchema).toBe('object');
	});

	it('SonarrEpisodeSchema should be a valid valibot schema', () => {
		expect(SonarrEpisodeSchema).toBeDefined();
		expect(typeof SonarrEpisodeSchema).toBe('object');
	});
});

// =============================================================================
// Lenient Parser Tests (Requirement 27.8)
// =============================================================================

describe('parsePaginatedSeriesLenient', () => {
	describe('valid inputs with mixed records', () => {
		it('should parse valid records and skip malformed ones (Req 27.8)', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 4,
				records: [
					validSeries,
					{ id: 'invalid', title: 123 }, // Invalid - wrong types
					minimalSeries,
					null // Invalid - not an object
				]
			};

			const result = parsePaginatedSeriesLenient(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(2);
				expect(result.skipped).toBe(2);
				expect(result.data.records[0]?.title).toBe('Breaking Bad');
				expect(result.data.records[1]?.title).toBe('Test Series');
			}
		});

		it('should call onInvalid callback for malformed series (Req 27.8)', () => {
			const invalidSeries = { id: 'not a number', title: 123 };
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 2,
				records: [validSeries, invalidSeries]
			};

			const onInvalid = vi.fn();
			const result = parsePaginatedSeriesLenient(input, onInvalid);

			expect(result.success).toBe(true);
			expect(onInvalid).toHaveBeenCalledTimes(1);
			expect(onInvalid).toHaveBeenCalledWith(invalidSeries, expect.any(String));
		});

		it('should return all valid when no malformed records', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 2,
				records: [validSeries, minimalSeries]
			};

			const result = parsePaginatedSeriesLenient(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(2);
				expect(result.skipped).toBe(0);
			}
		});

		it('should return empty array when all records are malformed', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 2,
				records: [null, { invalid: 'record' }]
			};

			const result = parsePaginatedSeriesLenient(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(0);
				expect(result.skipped).toBe(2);
			}
		});
	});

	describe('invalid pagination structure', () => {
		it('should return error for null input', () => {
			const result = parsePaginatedSeriesLenient(null);
			expect(result.success).toBe(false);
		});

		it('should return error for missing pagination fields', () => {
			const result = parsePaginatedSeriesLenient({ page: 1, pageSize: 10 });
			expect(result.success).toBe(false);
		});
	});
});

describe('parsePaginatedEpisodesLenient', () => {
	describe('valid inputs with mixed records', () => {
		it('should parse valid records and skip malformed ones (Req 27.8)', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 4,
				records: [
					validEpisode,
					{ id: 'invalid', seriesId: 'invalid' }, // Invalid - wrong types
					minimalEpisode,
					{ notAnEpisode: true } // Invalid - missing required fields
				]
			};

			const result = parsePaginatedEpisodesLenient(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(2);
				expect(result.skipped).toBe(2);
				expect(result.data.records[0]?.title).toBe('Pilot');
				expect(result.data.records[1]?.id).toBe(1);
			}
		});

		it('should call onInvalid callback for malformed episodes (Req 27.8)', () => {
			const invalidEpisode = { id: 'not a number', seriesId: 'invalid' };
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 2,
				records: [validEpisode, invalidEpisode]
			};

			const onInvalid = vi.fn();
			const result = parsePaginatedEpisodesLenient(input, onInvalid);

			expect(result.success).toBe(true);
			expect(onInvalid).toHaveBeenCalledTimes(1);
			expect(onInvalid).toHaveBeenCalledWith(invalidEpisode, expect.any(String));
		});

		it('should return all valid when no malformed records', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 2,
				records: [validEpisode, minimalEpisode]
			};

			const result = parsePaginatedEpisodesLenient(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(2);
				expect(result.skipped).toBe(0);
			}
		});

		it('should handle wanted/missing with some malformed episodes', () => {
			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 3,
				records: [
					{ ...minimalEpisode, id: 1 },
					null, // Malformed
					{ ...minimalEpisode, id: 2 }
				]
			};

			const result = parsePaginatedEpisodesLenient(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(2);
				expect(result.skipped).toBe(1);
				expect(result.data.records.every((e) => e.hasFile === false)).toBe(true);
			}
		});
	});

	describe('invalid pagination structure', () => {
		it('should return error for null input', () => {
			const result = parsePaginatedEpisodesLenient(null);
			expect(result.success).toBe(false);
		});

		it('should return error for missing pagination fields', () => {
			const result = parsePaginatedEpisodesLenient({ page: 1, pageSize: 10 });
			expect(result.success).toBe(false);
		});
	});
});
