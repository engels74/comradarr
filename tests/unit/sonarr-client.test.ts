import { describe, expect, it, vi } from 'vitest';
import { SonarrClient } from '../../src/lib/server/connectors/index';
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
	baseUrl: 'http://localhost:8989',
	apiKey: 'test-api-key-12345'
};

const sonarrClientConfig = {
	ClientClass: SonarrClient as unknown as new (config: Record<string, unknown>) => unknown,
	baseUrl: validConfig.baseUrl,
	apiKey: validConfig.apiKey
};

describe('SonarrClient', () => {
	describe('Constructor', () => {
		testConstructorDefaults(sonarrClientConfig);
	});
});

describe('SonarrClient.ping()', () => {
	testPingBehavior({
		ClientClass: SonarrClient,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey
	});
});

describe('SonarrClient.getSystemStatus()', () => {
	testSimpleGetMethod({
		ClientClass: SonarrClient as unknown as new (config: {
			baseUrl: string;
			apiKey: string;
		}) => Record<string, (...args: unknown[]) => Promise<unknown>>,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		methodName: 'getSystemStatus',
		expectedUrl: 'http://localhost:8989/api/v3/system/status',
		mockResponse: {
			appName: 'Sonarr',
			instanceName: 'Sonarr',
			version: '4.0.0.123',
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
			branch: 'main',
			authentication: 'forms',
			sqliteVersion: '3.36.0',
			urlBase: '',
			runtimeVersion: 'bun 1.0.0',
			runtimeName: 'bun',
			startTime: '2024-01-15T10:00:00Z'
		},
		assertions: (result) => {
			const r = result as Record<string, unknown>;
			expect(r.appName).toBe('Sonarr');
			expect(r.version).toBe('4.0.0.123');
			expect(r.isDocker).toBe(true);
		}
	});
});

describe('SonarrClient.getHealth()', () => {
	testSimpleGetMethod({
		ClientClass: SonarrClient as unknown as new (config: {
			baseUrl: string;
			apiKey: string;
		}) => Record<string, (...args: unknown[]) => Promise<unknown>>,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		methodName: 'getHealth',
		expectedUrl: 'http://localhost:8989/api/v3/health',
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

	it('should return empty array when Sonarr is healthy', async () => {
		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse([])));
		const client = new SonarrClient(validConfig);
		const result = await client.getHealth();
		expect(result).toEqual([]);
	});
});

describe('SonarrClient.getSeries()', () => {
	setupFetchMock();

	it('should return array of series from Sonarr', async () => {
		const mockSeries = [
			{
				id: 1,
				title: 'Breaking Bad',
				tvdbId: 81189,
				status: 'ended',
				monitored: true,
				qualityProfileId: 1,
				seasons: [
					{ seasonNumber: 0, monitored: false },
					{ seasonNumber: 1, monitored: true }
				]
			},
			{
				id: 2,
				title: 'Game of Thrones',
				tvdbId: 121361,
				status: 'ended',
				monitored: true,
				qualityProfileId: 2,
				seasons: [{ seasonNumber: 1, monitored: true }]
			}
		];

		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockSeries)));

		const client = new SonarrClient(validConfig);
		const result = await client.getSeries();

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('Breaking Bad');
		expect(result[0]?.tvdbId).toBe(81189);
		expect(result[0]?.seasons).toHaveLength(2);
		expect(result[1]?.title).toBe('Game of Thrones');
	});

	it('should return empty array when no series exist', async () => {
		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse([])));
		const client = new SonarrClient(validConfig);
		const result = await client.getSeries();
		expect(result).toEqual([]);
	});

	it('should call /api/v3/series endpoint', async () => {
		let capturedUrl: string | undefined;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return mockJsonResponse([]);
			})
		);
		const client = new SonarrClient(validConfig);
		await client.getSeries();
		expect(capturedUrl).toBe('http://localhost:8989/api/v3/series');
	});

	it('should skip malformed series records', async () => {
		const mockSeries = [
			{
				id: 1,
				title: 'Valid Series',
				tvdbId: 12345,
				status: 'continuing',
				monitored: true,
				qualityProfileId: 1,
				seasons: []
			},
			{ id: 2, title: 'Missing fields' },
			{
				id: 3,
				title: 'Another Valid Series',
				tvdbId: 67890,
				status: 'ended',
				monitored: false,
				qualityProfileId: 2,
				seasons: []
			}
		];

		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockSeries)));

		const client = new SonarrClient(validConfig);
		const result = await client.getSeries();

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('Valid Series');
		expect(result[1]?.title).toBe('Another Valid Series');
	});
});

describe('SonarrClient.getEpisodes()', () => {
	setupFetchMock();

	it('should return array of episodes for a series', async () => {
		const mockEpisodes = [
			{
				id: 101,
				seriesId: 1,
				seasonNumber: 1,
				episodeNumber: 1,
				title: 'Pilot',
				airDateUtc: '2008-01-20T00:00:00Z',
				hasFile: true,
				monitored: true,
				qualityCutoffNotMet: false
			},
			{
				id: 102,
				seriesId: 1,
				seasonNumber: 1,
				episodeNumber: 2,
				title: 'Cat in the Bag',
				airDateUtc: '2008-01-27T00:00:00Z',
				hasFile: true,
				monitored: true,
				qualityCutoffNotMet: true
			}
		];

		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockEpisodes)));

		const client = new SonarrClient(validConfig);
		const result = await client.getEpisodes(1);

		expect(result).toHaveLength(2);
		expect(result[0]?.title).toBe('Pilot');
		expect(result[0]?.seasonNumber).toBe(1);
		expect(result[0]?.episodeNumber).toBe(1);
		expect(result[0]?.hasFile).toBe(true);
		expect(result[1]?.qualityCutoffNotMet).toBe(true);
	});

	it('should return empty array when series has no episodes', async () => {
		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse([])));
		const client = new SonarrClient(validConfig);
		const result = await client.getEpisodes(999);
		expect(result).toEqual([]);
	});

	it('should call /api/v3/episode with seriesId query parameter', async () => {
		let capturedUrl: string | undefined;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return mockJsonResponse([]);
			})
		);
		const client = new SonarrClient(validConfig);
		await client.getEpisodes(123);
		expect(capturedUrl).toBe('http://localhost:8989/api/v3/episode?seriesId=123');
	});

	it('should skip malformed episode records', async () => {
		const mockEpisodes = [
			{
				id: 101,
				seriesId: 1,
				seasonNumber: 1,
				episodeNumber: 1,
				hasFile: true,
				monitored: true,
				qualityCutoffNotMet: false
			},
			{ id: 102, seriesId: 1 },
			{
				id: 103,
				seriesId: 1,
				seasonNumber: 1,
				episodeNumber: 3,
				hasFile: false,
				monitored: true,
				qualityCutoffNotMet: false
			}
		];

		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockEpisodes)));

		const client = new SonarrClient(validConfig);
		const result = await client.getEpisodes(1);

		expect(result).toHaveLength(2);
		expect(result[0]?.episodeNumber).toBe(1);
		expect(result[1]?.episodeNumber).toBe(3);
	});

	it('should handle episodes with optional fields', async () => {
		const mockEpisodes = [
			{
				id: 101,
				seriesId: 1,
				seasonNumber: 1,
				episodeNumber: 1,
				hasFile: false,
				monitored: true,
				qualityCutoffNotMet: false
			}
		];

		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockEpisodes)));

		const client = new SonarrClient(validConfig);
		const result = await client.getEpisodes(1);

		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe(101);
		expect(result[0]?.title).toBeUndefined();
		expect(result[0]?.airDateUtc).toBeUndefined();
	});
});

function buildSonarrEpisodeRecord(id: number) {
	return {
		id,
		seriesId: 1,
		seasonNumber: 1,
		episodeNumber: id,
		hasFile: false,
		monitored: true,
		qualityCutoffNotMet: false
	};
}

function buildSonarrCutoffRecord(id: number) {
	return {
		id,
		seriesId: 1,
		seasonNumber: 1,
		episodeNumber: id,
		hasFile: true,
		monitored: true,
		qualityCutoffNotMet: true
	};
}

const sonarrPaginatedClient = SonarrClient as unknown as new (config: {
	baseUrl: string;
	apiKey: string;
}) => Record<string, (...args: unknown[]) => Promise<unknown[]>>;

describe('SonarrClient.getWantedMissing()', () => {
	testPaginatedMethod({
		ClientClass: sonarrPaginatedClient,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		methodName: 'getWantedMissing',
		expectedUrlContains: '/api/v3/wanted/missing',
		buildRecord: buildSonarrEpisodeRecord,
		sortKey: 'airDateUtc',
		customOptions: {
			page: 2,
			pageSize: 50,
			sortKey: 'seriesTitle',
			sortDirection: 'ascending',
			monitored: false
		},
		expectedCustomParams: {
			page: 'page=2',
			pageSize: 'pageSize=50',
			sortKey: 'sortKey=seriesTitle',
			sortDirection: 'sortDirection=ascending',
			monitored: 'monitored=false'
		},
		buildInvalidRecord: () => ({ id: 2, seriesId: 1 })
	});
});

describe('SonarrClient.getWantedCutoff()', () => {
	testPaginatedMethod({
		ClientClass: sonarrPaginatedClient,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		methodName: 'getWantedCutoff',
		expectedUrlContains: '/api/v3/wanted/cutoff',
		buildRecord: buildSonarrCutoffRecord,
		sortKey: 'airDateUtc',
		customOptions: {
			pageSize: 25,
			sortKey: 'seriesTitle',
			sortDirection: 'ascending'
		},
		expectedCustomParams: {
			pageSize: 'pageSize=25',
			sortKey: 'sortKey=seriesTitle',
			sortDirection: 'sortDirection=ascending'
		},
		buildInvalidRecord: () => ({ id: 2, badRecord: true })
	});
});

const sonarrCommandClient = SonarrClient as unknown as new (config: {
	baseUrl: string;
	apiKey: string;
}) => Record<string, (...args: unknown[]) => Promise<unknown>>;

describe('SonarrClient.sendEpisodeSearch()', () => {
	testCommandExecution({
		ClientClass: sonarrCommandClient,
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		methodName: 'sendEpisodeSearch',
		commandName: 'EpisodeSearch',
		idsKey: 'episodeIds',
		testIds: [101, 102, 103]
	});
});

describe('SonarrClient.sendSeasonSearch()', () => {
	setupFetchMock();

	it('should POST to /api/v3/command with SeasonSearch name, seriesId, and seasonNumber', async () => {
		let capturedUrl: string | undefined;
		let capturedBody: unknown;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
				capturedUrl = url;
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return mockJsonResponse({
					id: 12346,
					name: 'SeasonSearch',
					status: 'queued',
					queued: '2024-01-15T12:00:00Z'
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendSeasonSearch(123, 2);

		expect(capturedUrl).toBe('http://localhost:8989/api/v3/command');
		expect(capturedBody).toEqual({
			name: 'SeasonSearch',
			seriesId: 123,
			seasonNumber: 2
		});
	});

	it('should return parsed CommandResponse with queued status', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				mockJsonResponse({
					id: 12346,
					name: 'SeasonSearch',
					status: 'queued',
					queued: '2024-01-15T12:00:00Z',
					trigger: 'manual'
				})
			)
		);

		const client = new SonarrClient(validConfig);
		const result = await client.sendSeasonSearch(123, 1);

		expect(result.id).toBe(12346);
		expect(result.name).toBe('SeasonSearch');
		expect(result.status).toBe('queued');
	});

	it('should use POST method', async () => {
		let capturedMethod: string | undefined;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedMethod = init?.method;
				return mockJsonResponse({
					id: 12346,
					name: 'SeasonSearch',
					status: 'queued',
					queued: '2024-01-15T12:00:00Z'
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendSeasonSearch(123, 1);

		expect(capturedMethod).toBe('POST');
	});

	it('should handle season 0 (specials)', async () => {
		let capturedBody: unknown;

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return mockJsonResponse({
					id: 12346,
					name: 'SeasonSearch',
					status: 'queued',
					queued: '2024-01-15T12:00:00Z'
				});
			})
		);

		const client = new SonarrClient(validConfig);
		await client.sendSeasonSearch(123, 0);

		expect(capturedBody).toEqual({
			name: 'SeasonSearch',
			seriesId: 123,
			seasonNumber: 0
		});
	});
});

describe('SonarrClient.getCommandStatus()', () => {
	testCommandStatus({
		ClientClass: SonarrClient as unknown as new (config: {
			baseUrl: string;
			apiKey: string;
		}) => { getCommandStatus(id: number): Promise<Record<string, unknown>> },
		baseUrl: validConfig.baseUrl,
		apiKey: validConfig.apiKey,
		commandName: 'EpisodeSearch'
	});
});
