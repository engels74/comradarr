/**
 * Unit tests for Radarr API response parsers
 *
 * Tests cover:
 * - parseRadarrMovie() valid and invalid inputs
 * - parsePaginatedMovies() valid and invalid inputs
 * - Edge cases for all parsers
 *

 */

import { describe, it, expect, vi } from 'vitest';
import {
	parseRadarrMovie,
	parsePaginatedMovies,
	parsePaginatedMoviesLenient,
	RadarrMovieSchema
} from '../../src/lib/server/connectors/radarr/parsers';

// =============================================================================
// Test Data Fixtures
// =============================================================================

const validQualityModel = {
	quality: {
		id: 7,
		name: 'Bluray-1080p',
		source: 'bluray',
		resolution: 1080
	},
	revision: {
		version: 1,
		real: 0,
		isRepack: false
	}
};

const validMovieFile = {
	id: 456,
	quality: validQualityModel,
	size: 8500000000,
	relativePath: 'The Matrix (1999)/The.Matrix.1999.1080p.BluRay.mkv'
};

const validMovie = {
	id: 123,
	title: 'The Matrix',
	tmdbId: 603,
	imdbId: 'tt0133093',
	year: 1999,
	hasFile: true,
	monitored: true,
	qualityCutoffNotMet: false,
	movieFileId: 456,
	movieFile: validMovieFile,
	status: 'released'
};

const minimalMovie = {
	id: 1,
	title: 'Test Movie',
	tmdbId: 12345,
	year: 2024,
	hasFile: false,
	monitored: true,
	qualityCutoffNotMet: true
};

// =============================================================================
// parseRadarrMovie Tests
// =============================================================================

describe('parseRadarrMovie', () => {
	describe('valid inputs', () => {
		it('should parse a complete valid movie (Req 27.4)', () => {
			const result = parseRadarrMovie(validMovie);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(123);
				expect(result.data.title).toBe('The Matrix');
				expect(result.data.tmdbId).toBe(603);
				expect(result.data.imdbId).toBe('tt0133093');
				expect(result.data.year).toBe(1999);
				expect(result.data.hasFile).toBe(true);
				expect(result.data.monitored).toBe(true);
				expect(result.data.qualityCutoffNotMet).toBe(false);
				expect(result.data.movieFileId).toBe(456);
				expect(result.data.movieFile).toBeDefined();
				expect(result.data.status).toBe('released');
			}
		});

		it('should parse a minimal movie without optional fields', () => {
			const result = parseRadarrMovie(minimalMovie);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(1);
				expect(result.data.title).toBe('Test Movie');
				expect(result.data.tmdbId).toBe(12345);
				expect(result.data.year).toBe(2024);
				expect(result.data.hasFile).toBe(false);
				expect(result.data.qualityCutoffNotMet).toBe(true);
				expect(result.data.imdbId).toBeUndefined();
				expect(result.data.movieFileId).toBeUndefined();
				expect(result.data.movieFile).toBeUndefined();
				expect(result.data.status).toBeUndefined();
			}
		});

		it('should parse movie file with quality model', () => {
			const result = parseRadarrMovie(validMovie);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.movieFile).toBeDefined();
				expect(result.data.movieFile?.quality.quality.name).toBe('Bluray-1080p');
				expect(result.data.movieFile?.quality.quality.resolution).toBe(1080);
				expect(result.data.movieFile?.quality.revision.isRepack).toBe(false);
			}
		});

		it('should ignore extra unknown fields (Req 27.7)', () => {
			const input = {
				...validMovie,
				unknownField: 'should be ignored',
				nestedUnknown: { foo: 'bar' },
				path: '/movies/The Matrix (1999)',
				rootFolderPath: '/movies',
				overview: 'A computer hacker learns from mysterious rebels...',
				ratings: { imdb: { value: 8.7 } }
			};

			const result = parseRadarrMovie(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(123);
				expect('unknownField' in result.data).toBe(false);
				expect('path' in result.data).toBe(false);
				expect('overview' in result.data).toBe(false);
			}
		});

		it('should handle various status values', () => {
			const statuses = ['released', 'inCinemas', 'announced', 'deleted'];

			for (const status of statuses) {
				const input = { ...minimalMovie, status };
				const result = parseRadarrMovie(input);

				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.status).toBe(status);
				}
			}
		});

		it('should handle movie without imdbId (common for non-English films)', () => {
			const input = { ...minimalMovie, title: '君の名は。' };
			const result = parseRadarrMovie(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.imdbId).toBeUndefined();
			}
		});

		it('should handle upgrade candidate flag correctly', () => {
			const upgradeCandidate = { ...validMovie, qualityCutoffNotMet: true };
			const result = parseRadarrMovie(upgradeCandidate);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.qualityCutoffNotMet).toBe(true);
			}
		});
	});

	describe('invalid inputs (Req 27.8)', () => {
		it('should return error for null input', () => {
			const result = parseRadarrMovie(null);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toContain('Invalid Radarr movie response');
			}
		});

		it('should return error for undefined input', () => {
			const result = parseRadarrMovie(undefined);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required id field', () => {
			const { id: _id, ...withoutId } = validMovie;
			const result = parseRadarrMovie(withoutId);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required title field', () => {
			const { title: _title, ...withoutTitle } = validMovie;
			const result = parseRadarrMovie(withoutTitle);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required tmdbId field', () => {
			const { tmdbId: _tmdbId, ...withoutTmdbId } = validMovie;
			const result = parseRadarrMovie(withoutTmdbId);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required year field', () => {
			const { year: _year, ...withoutYear } = validMovie;
			const result = parseRadarrMovie(withoutYear);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required hasFile field', () => {
			const { hasFile: _hasFile, ...withoutHasFile } = validMovie;
			const result = parseRadarrMovie(withoutHasFile);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required monitored field', () => {
			const { monitored: _monitored, ...withoutMonitored } = validMovie;
			const result = parseRadarrMovie(withoutMonitored);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required qualityCutoffNotMet field', () => {
			const { qualityCutoffNotMet: _qcnm, ...withoutQCNM } = validMovie;
			const result = parseRadarrMovie(withoutQCNM);
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on id', () => {
			const result = parseRadarrMovie({ ...validMovie, id: 'not a number' });
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on tmdbId', () => {
			const result = parseRadarrMovie({ ...validMovie, tmdbId: 'not a number' });
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on year', () => {
			const result = parseRadarrMovie({ ...validMovie, year: '1999' });
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on hasFile', () => {
			const result = parseRadarrMovie({ ...validMovie, hasFile: 'yes' });
			expect(result.success).toBe(false);
		});

		it('should return error for wrong type on monitored', () => {
			const result = parseRadarrMovie({ ...validMovie, monitored: 'true' });
			expect(result.success).toBe(false);
		});

		it('should return error for invalid movieFile quality', () => {
			const result = parseRadarrMovie({
				...validMovie,
				movieFile: {
					id: 1,
					quality: { invalid: 'structure' },
					size: 1000
				}
			});
			expect(result.success).toBe(false);
		});
	});

	describe('edge cases', () => {
		it('should handle zero values', () => {
			const input = {
				id: 0,
				title: 'Zero ID Movie',
				tmdbId: 0,
				year: 0,
				hasFile: false,
				monitored: false,
				qualityCutoffNotMet: false
			};

			const result = parseRadarrMovie(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.id).toBe(0);
				expect(result.data.tmdbId).toBe(0);
				expect(result.data.year).toBe(0);
			}
		});

		it('should handle empty strings', () => {
			const input = {
				...minimalMovie,
				title: '',
				imdbId: ''
			};

			const result = parseRadarrMovie(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.title).toBe('');
				expect(result.data.imdbId).toBe('');
			}
		});

		it('should handle future years', () => {
			const input = { ...minimalMovie, year: 2099 };
			const result = parseRadarrMovie(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.year).toBe(2099);
			}
		});

		it('should handle large file sizes', () => {
			const input = {
				...validMovie,
				movieFile: {
					...validMovieFile,
					size: 999999999999999
				}
			};

			const result = parseRadarrMovie(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.movieFile?.size).toBe(999999999999999);
			}
		});

		it('should handle old movies (historical years)', () => {
			const input = {
				...minimalMovie,
				title: 'A Trip to the Moon',
				year: 1902
			};

			const result = parseRadarrMovie(input);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.year).toBe(1902);
			}
		});
	});
});

// =============================================================================
// parsePaginatedMovies Tests
// =============================================================================

describe('parsePaginatedMovies', () => {
	describe('valid inputs', () => {
		it('should parse a valid paginated movies response', () => {
			const input = {
				page: 1,
				pageSize: 10,
				sortKey: 'title',
				sortDirection: 'ascending',
				totalRecords: 25,
				records: [validMovie, minimalMovie]
			};

			const result = parsePaginatedMovies(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.page).toBe(1);
				expect(result.data.pageSize).toBe(10);
				expect(result.data.totalRecords).toBe(25);
				expect(result.data.records).toHaveLength(2);
				expect(result.data.records[0]?.title).toBe('The Matrix');
			}
		});

		it('should parse an empty records array', () => {
			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 0,
				records: []
			};

			const result = parsePaginatedMovies(input);

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

			const result = parsePaginatedMovies(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.sortKey).toBe('');
				expect(result.data.sortDirection).toBe('ascending');
			}
		});

		it('should handle both sort directions', () => {
			for (const sortDirection of ['ascending', 'descending'] as const) {
				const input = {
					page: 1,
					pageSize: 10,
					sortDirection,
					totalRecords: 1,
					records: [minimalMovie]
				};

				const result = parsePaginatedMovies(input);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.sortDirection).toBe(sortDirection);
				}
			}
		});
	});

	describe('invalid inputs (Req 27.8)', () => {
		it('should return error for null input', () => {
			const result = parsePaginatedMovies(null);
			expect(result.success).toBe(false);
		});

		it('should return error for undefined input', () => {
			const result = parsePaginatedMovies(undefined);
			expect(result.success).toBe(false);
		});

		it('should return error for missing required fields', () => {
			const result = parsePaginatedMovies({ page: 1, pageSize: 10 });
			expect(result.success).toBe(false);
		});

		it('should return error for invalid movie in array', () => {
			const result = parsePaginatedMovies({
				page: 1,
				pageSize: 10,
				totalRecords: 1,
				records: [{ id: 'invalid', title: 123 }]
			});
			expect(result.success).toBe(false);
		});
	});

	describe('wanted endpoints simulation', () => {
		it('should parse missing movies (hasFile=false)', () => {
			const missingMovies = [
				{ ...minimalMovie, id: 1 },
				{ ...minimalMovie, id: 2 },
				{ ...minimalMovie, id: 3 }
			];

			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 3,
				records: missingMovies
			};

			const result = parsePaginatedMovies(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(3);
				expect(result.data.records.every((m) => m.hasFile === false)).toBe(true);
			}
		});

		it('should parse cutoff unmet movies (qualityCutoffNotMet=true)', () => {
			const cutoffMovies = [
				{ ...validMovie, id: 1, qualityCutoffNotMet: true },
				{ ...validMovie, id: 2, qualityCutoffNotMet: true }
			];

			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 2,
				records: cutoffMovies
			};

			const result = parsePaginatedMovies(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(2);
				expect(result.data.records.every((m) => m.qualityCutoffNotMet === true)).toBe(true);
			}
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

			const result = parsePaginatedMovies(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.pageSize).toBe(1000);
			}
		});
	});
});

// =============================================================================
// Schema Export Tests
// =============================================================================

describe('Schema exports', () => {
	it('RadarrMovieSchema should be a valid valibot schema', () => {
		expect(RadarrMovieSchema).toBeDefined();
		expect(typeof RadarrMovieSchema).toBe('object');
	});
});

// =============================================================================
// Lenient Parser Tests (Requirement 27.8)
// =============================================================================

describe('parsePaginatedMoviesLenient', () => {
	describe('valid inputs with mixed records', () => {
		it('should parse valid records and skip malformed ones (Req 27.8)', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 4,
				records: [
					validMovie,
					{ id: 'invalid', title: 123 }, // Invalid - wrong types
					minimalMovie,
					null // Invalid - not an object
				]
			};

			const result = parsePaginatedMoviesLenient(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(2);
				expect(result.skipped).toBe(2);
				expect(result.data.records[0]?.title).toBe('The Matrix');
				expect(result.data.records[1]?.title).toBe('Test Movie');
			}
		});

		it('should call onInvalid callback for malformed movies (Req 27.8)', () => {
			const invalidMovieRecord = { id: 'not a number', title: 123 };
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 2,
				records: [validMovie, invalidMovieRecord]
			};

			const onInvalid = vi.fn();
			const result = parsePaginatedMoviesLenient(input, onInvalid);

			expect(result.success).toBe(true);
			expect(onInvalid).toHaveBeenCalledTimes(1);
			expect(onInvalid).toHaveBeenCalledWith(invalidMovieRecord, expect.any(String));
		});

		it('should return all valid when no malformed records', () => {
			const input = {
				page: 1,
				pageSize: 10,
				totalRecords: 2,
				records: [validMovie, minimalMovie]
			};

			const result = parsePaginatedMoviesLenient(input);

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

			const result = parsePaginatedMoviesLenient(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(0);
				expect(result.skipped).toBe(2);
			}
		});

		it('should handle wanted/missing with some malformed movies', () => {
			const input = {
				page: 1,
				pageSize: 1000,
				totalRecords: 3,
				records: [
					{ ...minimalMovie, id: 1 },
					null, // Malformed
					{ ...minimalMovie, id: 2 }
				]
			};

			const result = parsePaginatedMoviesLenient(input);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.records).toHaveLength(2);
				expect(result.skipped).toBe(1);
				expect(result.data.records.every((m) => m.hasFile === false)).toBe(true);
			}
		});
	});

	describe('invalid pagination structure', () => {
		it('should return error for null input', () => {
			const result = parsePaginatedMoviesLenient(null);
			expect(result.success).toBe(false);
		});

		it('should return error for missing pagination fields', () => {
			const result = parsePaginatedMoviesLenient({ page: 1, pageSize: 10 });
			expect(result.success).toBe(false);
		});
	});
});
