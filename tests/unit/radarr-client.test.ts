import { describe, expect, it, vi } from 'vitest';
import { RadarrClient } from '../../src/lib/server/connectors/index';
import {
	createMockFetch,
	mockJsonResponse,
	setupFetchMock,
	testCommandExecution,
	testCommandStatus,
	testConstructorDefaults,
	testPaginatedMethod,
	testPingBehavior,
	testSimpleGetMethod
} from './helpers/client-test-utils';

const validConfig = {
	baseUrl: 'http://localhost:7878',
	apiKey: 'test-api-key-12345'
};

const radarrClientConfig = {
	ClientClass: RadarrClient as unknown as new (config: Record<string, unknown>) => unknown,
	baseUrl: validConfig.baseUrl,
	apiKey: validConfig.apiKey
};

describe('RadarrClient', () => {
	describe('Constructor', () => {
		testConstructorDefaults(radarrClientConfig);
	});
});

describe('RadarrClient.ping()', () => {
	testPingBehavior({
		ClientClass: RadarrClient,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey
	});
});

describe('RadarrClient.getSystemStatus()', () => {
	testSimpleGetMethod({
		ClientClass: RadarrClient as unknown as new (config: {
			baseUrl: string;
			apiKey: string;
		}) => Record<string, (...args: unknown[]) => Promise<unknown>>,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		methodName: 'getSystemStatus',
		expectedUrl: 'http://localhost:7878/api/v3/system/status',
		mockResponse: {
			appName: 'Radarr',
			instanceName: 'Radarr',
			version: '5.2.0.8171',
			buildTime: '2024-01-15T00:00:00Z',
			isDebug: false,
			isProduction: true,
			isAdmin: false,
			isUserInteractive: false,
			startupPath: '/app',
			appData: '/config',
			osName: 'Linux',
			osVersion: '5.15.0',
			isDocker: true,
			isMono: false,
			isLinux: true,
			isOsx: false,
			isWindows: false,
			branch: 'master',
			authentication: 'forms',
			sqliteVersion: '3.36.0',
			urlBase: '',
			runtimeVersion: 'bun 1.0.0',
			runtimeName: 'bun',
			startTime: '2024-01-15T10:00:00Z'
		},
		assertions: (result) => {
			const r = result as Record<string, unknown>;
			expect(r.appName).toBe('Radarr');
			expect(r.version).toBe('5.2.0.8171');
			expect(r.isDocker).toBe(true);
		}
	});
});

describe('RadarrClient.getHealth()', () => {
	testSimpleGetMethod({
		ClientClass: RadarrClient as unknown as new (config: {
			baseUrl: string;
			apiKey: string;
		}) => Record<string, (...args: unknown[]) => Promise<unknown>>,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		methodName: 'getHealth',
		expectedUrl: 'http://localhost:7878/api/v3/health',
		mockResponse: [
			{
				source: 'IndexerStatusCheck',
				type: 'warning',
				message: 'Indexers unavailable due to failures',
				wikiUrl: 'https://wiki.servarr.com'
			},
			{ source: 'DownloadClientCheck', type: 'ok', message: '' }
		],
		assertions: (result) => {
			const r = result as Record<string, unknown>[];
			expect(r).toHaveLength(2);
			expect(r[0]?.source).toBe('IndexerStatusCheck');
			expect(r[0]?.type).toBe('warning');
			expect(r[1]?.type).toBe('ok');
		}
	});

	setupFetchMock();

	it('should return empty array when Radarr is healthy', async () => {
		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse([])));
		const client = new RadarrClient(validConfig);
		const result = await client.getHealth();
		expect(result).toEqual([]);
	});
});

describe('RadarrClient.getMovies()', () => {
	setupFetchMock();

	it('should return array of movies from Radarr', async () => {
		const mockMovies = [
			{
				id: 1,
				title: 'The Matrix',
				tmdbId: 603,
				imdbId: 'tt0133093',
				year: 1999,
				hasFile: true,
				monitored: true,
				qualityCutoffNotMet: false,
				status: 'released'
			},
			{
				id: 2,
				title: 'Inception',
				tmdbId: 27205,
				imdbId: 'tt1375666',
				year: 2010,
				hasFile: false,
				monitored: true,
				qualityCutoffNotMet: true,
				status: 'released'
			}
		];

		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockMovies)));

		const client = new RadarrClient(validConfig);
		const result = await client.getMovies();

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('The Matrix');
		expect(result[0]?.tmdbId).toBe(603);
		expect(result[0]?.year).toBe(1999);
		expect(result[0]?.hasFile).toBe(true);
		expect(result[1]?.title).toBe('Inception');
		expect(result[1]?.hasFile).toBe(false);
		expect(result[1]?.qualityCutoffNotMet).toBe(true);
	});

	it('should return empty array when no movies exist', async () => {
		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse([])));
		const client = new RadarrClient(validConfig);
		const result = await client.getMovies();
		expect(result).toEqual([]);
	});

	it('should call /api/v3/movie endpoint', async () => {
		let capturedUrl: string | undefined;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return mockJsonResponse([]);
			})
		);
		const client = new RadarrClient(validConfig);
		await client.getMovies();
		expect(capturedUrl).toBe('http://localhost:7878/api/v3/movie');
	});

	it('should skip malformed movie records', async () => {
		const mockMovies = [
			{
				id: 1,
				title: 'Valid Movie',
				tmdbId: 12345,
				year: 2020,
				hasFile: true,
				monitored: true,
				qualityCutoffNotMet: false
			},
			{ id: 2, title: 'Missing fields' },
			{
				id: 3,
				title: 'Another Valid Movie',
				tmdbId: 67890,
				year: 2021,
				hasFile: false,
				monitored: true,
				qualityCutoffNotMet: true
			}
		];

		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockMovies)));

		const client = new RadarrClient(validConfig);
		const result = await client.getMovies();

		expect(result).toHaveLength(2);
		expect(result[0]?.id).toBe(1);
		expect(result[0]?.title).toBe('Valid Movie');
		expect(result[1]?.id).toBe(3);
		expect(result[1]?.title).toBe('Another Valid Movie');
	});

	it('should handle movies with minimal required fields', async () => {
		const mockMovies = [
			{
				id: 1,
				title: 'Minimal Movie',
				tmdbId: 99999,
				year: 2023,
				hasFile: false,
				monitored: false,
				qualityCutoffNotMet: false
			}
		];

		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockMovies)));

		const client = new RadarrClient(validConfig);
		const result = await client.getMovies();

		expect(result).toHaveLength(1);
		expect(result[0]?.title).toBe('Minimal Movie');
		expect(result[0]?.imdbId).toBeUndefined();
		expect(result[0]?.movieFileId).toBeUndefined();
		expect(result[0]?.status).toBeUndefined();
	});
});

function buildRadarrMovieRecord(id: number) {
	return {
		id,
		title: `Movie ${id}`,
		tmdbId: id,
		year: 2020,
		hasFile: false,
		monitored: true,
		qualityCutoffNotMet: false
	};
}

function buildRadarrCutoffRecord(id: number) {
	return {
		id,
		title: `Movie ${id}`,
		tmdbId: id,
		year: 2020,
		hasFile: true,
		monitored: true,
		qualityCutoffNotMet: true
	};
}

const radarrPaginatedClient = RadarrClient as unknown as new (config: {
	baseUrl: string;
	apiKey: string;
}) => Record<string, (...args: unknown[]) => Promise<unknown[]>>;

describe('RadarrClient.getWantedMissing()', () => {
	testPaginatedMethod({
		ClientClass: radarrPaginatedClient,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		methodName: 'getWantedMissing',
		expectedUrlContains: '/api/v3/wanted/missing',
		buildRecord: buildRadarrMovieRecord,
		sortKey: 'title',
		customOptions: {
			page: 2,
			pageSize: 50,
			sortKey: 'year',
			sortDirection: 'ascending',
			monitored: false
		},
		expectedCustomParams: {
			page: 'page=2',
			pageSize: 'pageSize=50',
			sortKey: 'sortKey=year',
			sortDirection: 'sortDirection=ascending',
			monitored: 'monitored=false'
		},
		buildInvalidRecord: () => ({ id: 2, title: 'Invalid Movie' })
	});
});

describe('RadarrClient.getWantedCutoff()', () => {
	testPaginatedMethod({
		ClientClass: radarrPaginatedClient,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		methodName: 'getWantedCutoff',
		expectedUrlContains: '/api/v3/wanted/cutoff',
		buildRecord: buildRadarrCutoffRecord,
		sortKey: 'title',
		customOptions: {
			page: 2,
			pageSize: 50,
			sortKey: 'year',
			sortDirection: 'ascending',
			monitored: false
		},
		expectedCustomParams: {
			page: 'page=2',
			pageSize: 'pageSize=50',
			sortKey: 'sortKey=year',
			sortDirection: 'sortDirection=ascending',
			monitored: 'monitored=false'
		},
		buildInvalidRecord: () => ({ id: 2, title: 'Invalid Movie' })
	});
});

const radarrCommandClient = RadarrClient as unknown as new (config: {
	baseUrl: string;
	apiKey: string;
}) => Record<string, (...args: unknown[]) => Promise<unknown>>;

describe('RadarrClient.sendMoviesSearch()', () => {
	testCommandExecution({
		ClientClass: radarrCommandClient,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		methodName: 'sendMoviesSearch',
		commandName: 'MoviesSearch',
		idsKey: 'movieIds',
		testIds: [1, 2, 3]
	});

	setupFetchMock();

	it('should handle multiple movie IDs (batch)', async () => {
		let capturedBody: unknown;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return mockJsonResponse({
					id: 12345,
					name: 'MoviesSearch',
					status: 'queued',
					queued: '2024-01-15T12:00:00Z'
				});
			})
		);
		const client = new RadarrClient(validConfig);
		await client.sendMoviesSearch([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(capturedBody).toEqual({
			name: 'MoviesSearch',
			movieIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
		});
	});
});

describe('RadarrClient.getCommandStatus()', () => {
	testCommandStatus({
		ClientClass: RadarrClient as unknown as new (config: {
			baseUrl: string;
			apiKey: string;
		}) => { getCommandStatus(id: number): Promise<Record<string, unknown>> },
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		commandName: 'MoviesSearch'
	});
});
