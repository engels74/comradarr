import { afterEach, beforeEach, expect, it, type Mock, vi } from 'vitest';

export function createMockFetch(impl: Mock): typeof fetch {
	return impl as unknown as typeof fetch;
}

export interface FetchMockContext {
	originalFetch: typeof fetch;
}

export function setupFetchMock(): FetchMockContext {
	const ctx: FetchMockContext = { originalFetch: globalThis.fetch };

	beforeEach(() => {
		ctx.originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = ctx.originalFetch;
		vi.restoreAllMocks();
	});

	return ctx;
}

export function mockJsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

export function mockFetchCapture() {
	let capturedUrl: string | undefined;
	let capturedHeaders: Headers | undefined;
	let capturedMethod: string | undefined;
	let capturedBody: unknown;

	const mock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
		capturedUrl = url;
		capturedHeaders = new Headers(init?.headers);
		capturedMethod = init?.method;
		capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
		return mockJsonResponse([]);
	});

	return {
		mock,
		get url() {
			return capturedUrl;
		},
		get headers() {
			return capturedHeaders;
		},
		get method() {
			return capturedMethod;
		},
		get body() {
			return capturedBody;
		},
		withResponse(data: unknown, status = 200) {
			mock.mockImplementation(async (url: string, init?: RequestInit) => {
				capturedUrl = url;
				capturedHeaders = new Headers(init?.headers);
				capturedMethod = init?.method;
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return mockJsonResponse(data, status);
			});
			return {
				mock,
				get url() {
					return capturedUrl;
				},
				get headers() {
					return capturedHeaders;
				},
				get method() {
					return capturedMethod;
				},
				get body() {
					return capturedBody;
				}
			};
		}
	};
}

interface PingTestConfig {
	ClientClass: new (config: { baseUrl: string; apiKey: string }) => { ping(): Promise<boolean> };
	baseUrl: string;
	apiKey?: string;
}

export function testPingBehavior({
	ClientClass,
	baseUrl,
	apiKey = 'test-api-key-12345'
}: PingTestConfig) {
	const config = { baseUrl, apiKey };

	setupFetchMock();

	it('should return true when server responds OK', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(new Response('Pong', { status: 200 }))
		);
		const client = new ClientClass(config);
		expect(await client.ping()).toBe(true);
	});

	it('should return false when server returns error', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
		);
		const client = new ClientClass(config);
		expect(await client.ping()).toBe(false);
	});

	it('should return false when network error occurs', async () => {
		globalThis.fetch = createMockFetch(vi.fn().mockRejectedValue(new TypeError('fetch failed')));
		const client = new ClientClass(config);
		expect(await client.ping()).toBe(false);
	});

	it('should call /ping endpoint directly', async () => {
		let capturedUrl: string | undefined;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return new Response('Pong', { status: 200 });
			})
		);
		const client = new ClientClass(config);
		await client.ping();
		expect(capturedUrl).toBe(`${baseUrl}/ping`);
	});

	it('should include X-Api-Key header in ping request', async () => {
		let capturedHeaders: Headers | undefined;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return new Response('Pong', { status: 200 });
			})
		);
		const client = new ClientClass(config);
		await client.ping();
		expect(capturedHeaders?.get('X-Api-Key')).toBe(apiKey);
	});
}

interface ConstructorTestConfig {
	ClientClass: new (config: Record<string, unknown>) => unknown;
	baseUrl: string;
	apiKey?: string;
}

export function testConstructorDefaults({
	ClientClass,
	baseUrl,
	apiKey = 'test-api-key-12345'
}: ConstructorTestConfig) {
	const config = { baseUrl, apiKey };

	it('should create instance with valid config', () => {
		const client = new ClientClass(config);
		expect(client).toBeInstanceOf(ClientClass);
	});

	it('should accept optional timeout parameter', () => {
		const client = new ClientClass({ ...config, timeout: 60000 });
		expect(client).toBeInstanceOf(ClientClass);
	});

	it('should accept optional userAgent parameter', () => {
		const client = new ClientClass({ ...config, userAgent: 'TestAgent/1.0' });
		expect(client).toBeInstanceOf(ClientClass);
	});

	it('should accept optional retry configuration', () => {
		const client = new ClientClass({ ...config, retry: { maxRetries: 5, baseDelay: 500 } });
		expect(client).toBeInstanceOf(ClientClass);
	});
}

interface SimpleMethodTestConfig {
	ClientClass: new (config: {
		baseUrl: string;
		apiKey: string;
	}) => Record<string, (...args: unknown[]) => Promise<unknown>>;
	baseUrl: string;
	apiKey?: string;
	methodName: string;
	expectedUrl: string;
	mockResponse: unknown;
	assertions: (result: unknown) => void;
}

export function testSimpleGetMethod({
	ClientClass,
	baseUrl,
	apiKey = 'test-api-key-12345',
	methodName,
	expectedUrl,
	mockResponse,
	assertions
}: SimpleMethodTestConfig) {
	const config = { baseUrl, apiKey };

	setupFetchMock();

	it(`should return data from ${methodName}`, async () => {
		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockResponse)));
		const client = new ClientClass(config);
		const result = await client[methodName]!();
		assertions(result);
	});

	it(`should call ${expectedUrl}`, async () => {
		let capturedUrl: string | undefined;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return mockJsonResponse(mockResponse);
			})
		);
		const client = new ClientClass(config);
		await client[methodName]!();
		expect(capturedUrl).toBe(expectedUrl);
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return mockJsonResponse(mockResponse);
			})
		);
		const client = new ClientClass(config);
		await client[methodName]!();
		expect(capturedHeaders?.get('X-Api-Key')).toBe(apiKey);
	});
}

interface PaginatedMethodTestConfig {
	ClientClass: new (config: {
		baseUrl: string;
		apiKey: string;
	}) => Record<string, (...args: unknown[]) => Promise<unknown[]>>;
	baseUrl: string;
	apiKey?: string;
	methodName: string;
	expectedUrlContains: string;
	buildRecord: (id: number) => Record<string, unknown>;
	sortKey: string;
	customOptions: Record<string, unknown>;
	expectedCustomParams: Record<string, string>;
	buildInvalidRecord: () => Record<string, unknown>;
}

export function testPaginatedMethod({
	ClientClass,
	baseUrl,
	apiKey = 'test-api-key-12345',
	methodName,
	expectedUrlContains,
	buildRecord,
	sortKey,
	customOptions,
	expectedCustomParams,
	buildInvalidRecord
}: PaginatedMethodTestConfig) {
	const config = { baseUrl, apiKey };

	setupFetchMock();

	it('should return records from first page', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey,
			sortDirection: 'descending',
			totalRecords: 2,
			records: [buildRecord(1), buildRecord(2)]
		};
		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockResponse)));
		const client = new ClientClass(config);
		const result = await client[methodName]!();
		expect(result).toHaveLength(2);
	});

	it('should return empty array when no records exist', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey,
			sortDirection: 'descending',
			totalRecords: 0,
			records: []
		};
		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockResponse)));
		const client = new ClientClass(config);
		const result = await client[methodName]!();
		expect(result).toEqual([]);
	});

	it('should call correct endpoint with default query parameters', async () => {
		let capturedUrl: string | undefined;
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey,
			sortDirection: 'descending',
			totalRecords: 0,
			records: []
		};
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return mockJsonResponse(mockResponse);
			})
		);
		const client = new ClientClass(config);
		await client[methodName]!();
		expect(capturedUrl).toContain(expectedUrlContains);
		expect(capturedUrl).toContain('page=1');
		expect(capturedUrl).toContain('pageSize=1000');
		expect(capturedUrl).toContain('monitored=true');
	});

	it('should use custom options when provided', async () => {
		let capturedUrl: string | undefined;
		const mockResponse = {
			page: 1,
			pageSize: 50,
			sortKey,
			sortDirection: 'ascending',
			totalRecords: 0,
			records: []
		};
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return mockJsonResponse(mockResponse);
			})
		);
		const client = new ClientClass(config);
		await client[methodName]!(customOptions);
		for (const [_key, value] of Object.entries(expectedCustomParams)) {
			expect(capturedUrl).toContain(value);
		}
	});

	it('should handle pagination across multiple pages', async () => {
		let callCount = 0;
		const page1 = {
			page: 1,
			pageSize: 2,
			sortKey,
			sortDirection: 'descending',
			totalRecords: 5,
			records: [buildRecord(1), buildRecord(2)]
		};
		const page2 = {
			page: 2,
			pageSize: 2,
			sortKey,
			sortDirection: 'descending',
			totalRecords: 5,
			records: [buildRecord(3), buildRecord(4)]
		};
		const page3 = {
			page: 3,
			pageSize: 2,
			sortKey,
			sortDirection: 'descending',
			totalRecords: 5,
			records: [buildRecord(5)]
		};

		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async () => {
				callCount++;
				const response = callCount === 1 ? page1 : callCount === 2 ? page2 : page3;
				return mockJsonResponse(response);
			})
		);
		const client = new ClientClass(config);
		const result = await client[methodName]!({ pageSize: 2 });
		expect(callCount).toBe(3);
		expect(result).toHaveLength(5);
	});

	it('should skip malformed records', async () => {
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey,
			sortDirection: 'descending',
			totalRecords: 3,
			records: [buildRecord(1), buildInvalidRecord(), buildRecord(3)]
		};
		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(mockResponse)));
		const client = new ClientClass(config);
		const result = await client[methodName]!();
		expect(result).toHaveLength(2);
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;
		const mockResponse = {
			page: 1,
			pageSize: 1000,
			sortKey,
			sortDirection: 'descending',
			totalRecords: 0,
			records: []
		};
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return mockJsonResponse(mockResponse);
			})
		);
		const client = new ClientClass(config);
		await client[methodName]!();
		expect(capturedHeaders?.get('X-Api-Key')).toBe(apiKey);
	});
}

interface CommandTestConfig {
	ClientClass: new (config: {
		baseUrl: string;
		apiKey: string;
	}) => Record<string, (...args: unknown[]) => Promise<unknown>>;
	baseUrl: string;
	apiKey?: string;
	methodName: string;
	commandName: string;
	idsKey: string;
	testIds: number[];
}

export function testCommandExecution({
	ClientClass,
	baseUrl,
	apiKey = 'test-api-key-12345',
	methodName,
	commandName,
	idsKey,
	testIds
}: CommandTestConfig) {
	const config = { baseUrl, apiKey };
	const mockCommandResponse = {
		id: 12345,
		name: commandName,
		status: 'queued',
		queued: '2024-01-15T12:00:00Z'
	};

	setupFetchMock();

	it(`should POST to /api/v3/command with ${commandName} and ${idsKey}`, async () => {
		let capturedUrl: string | undefined;
		let capturedBody: unknown;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
				capturedUrl = url;
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return mockJsonResponse(mockCommandResponse);
			})
		);
		const client = new ClientClass(config);
		await client[methodName]!(testIds);
		expect(capturedUrl).toBe(`${baseUrl}/api/v3/command`);
		expect(capturedBody).toEqual({ name: commandName, [idsKey]: testIds });
	});

	it('should return parsed CommandResponse with queued status', async () => {
		const fullResponse = { ...mockCommandResponse, trigger: 'manual' };
		globalThis.fetch = createMockFetch(vi.fn().mockResolvedValue(mockJsonResponse(fullResponse)));
		const client = new ClientClass(config);
		const result = (await client[methodName]!([testIds[0]])) as Record<string, unknown>;
		expect(result.id).toBe(12345);
		expect(result.name).toBe(commandName);
		expect(result.status).toBe('queued');
	});

	it('should use POST method', async () => {
		let capturedMethod: string | undefined;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedMethod = init?.method;
				return mockJsonResponse(mockCommandResponse);
			})
		);
		const client = new ClientClass(config);
		await client[methodName]!([testIds[0]]);
		expect(capturedMethod).toBe('POST');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return mockJsonResponse(mockCommandResponse);
			})
		);
		const client = new ClientClass(config);
		await client[methodName]!([testIds[0]]);
		expect(capturedHeaders?.get('X-Api-Key')).toBe(apiKey);
	});

	it('should handle single ID', async () => {
		let capturedBody: unknown;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return mockJsonResponse(mockCommandResponse);
			})
		);
		const client = new ClientClass(config);
		await client[methodName]!([999]);
		expect(capturedBody).toEqual({ name: commandName, [idsKey]: [999] });
	});

	it('should handle empty IDs array', async () => {
		let capturedBody: unknown;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedBody = init?.body ? JSON.parse(init.body as string) : undefined;
				return mockJsonResponse(mockCommandResponse);
			})
		);
		const client = new ClientClass(config);
		await client[methodName]!([]);
		expect(capturedBody).toEqual({ name: commandName, [idsKey]: [] });
	});
}

interface CommandStatusTestConfig {
	ClientClass: new (config: {
		baseUrl: string;
		apiKey: string;
	}) => { getCommandStatus(id: number): Promise<Record<string, unknown>> };
	baseUrl: string;
	apiKey?: string;
	commandName: string;
}

export function testCommandStatus({
	ClientClass,
	baseUrl,
	apiKey = 'test-api-key-12345',
	commandName
}: CommandStatusTestConfig) {
	const config = { baseUrl, apiKey };

	setupFetchMock();

	it('should GET from /api/v3/command/{id}', async () => {
		let capturedUrl: string | undefined;
		const mockResponse = {
			id: 12345,
			name: commandName,
			status: 'completed',
			queued: '2024-01-15T12:00:00Z',
			started: '2024-01-15T12:00:01Z',
			ended: '2024-01-15T12:00:10Z'
		};
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (url: string) => {
				capturedUrl = url;
				return mockJsonResponse(mockResponse);
			})
		);
		const client = new ClientClass(config);
		await client.getCommandStatus(12345);
		expect(capturedUrl).toBe(`${baseUrl}/api/v3/command/12345`);
	});

	it('should return parsed CommandResponse with queued status', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				mockJsonResponse({
					id: 12345,
					name: commandName,
					status: 'queued',
					queued: '2024-01-15T12:00:00Z'
				})
			)
		);
		const client = new ClientClass(config);
		const result = await client.getCommandStatus(12345);
		expect(result.id).toBe(12345);
		expect(result.status).toBe('queued');
	});

	it('should return parsed CommandResponse with started status', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				mockJsonResponse({
					id: 12345,
					name: commandName,
					status: 'started',
					queued: '2024-01-15T12:00:00Z',
					started: '2024-01-15T12:00:01Z'
				})
			)
		);
		const client = new ClientClass(config);
		const result = await client.getCommandStatus(12345);
		expect(result.status).toBe('started');
		expect(result.started).toBe('2024-01-15T12:00:01Z');
	});

	it('should return parsed CommandResponse with completed status', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				mockJsonResponse({
					id: 12345,
					name: commandName,
					status: 'completed',
					queued: '2024-01-15T12:00:00Z',
					started: '2024-01-15T12:00:01Z',
					ended: '2024-01-15T12:00:10Z',
					duration: '00:00:09.0000000'
				})
			)
		);
		const client = new ClientClass(config);
		const result = await client.getCommandStatus(12345);
		expect(result.status).toBe('completed');
		expect(result.ended).toBe('2024-01-15T12:00:10Z');
	});

	it('should return parsed CommandResponse with failed status', async () => {
		globalThis.fetch = createMockFetch(
			vi.fn().mockResolvedValue(
				mockJsonResponse({
					id: 12345,
					name: commandName,
					status: 'failed',
					queued: '2024-01-15T12:00:00Z',
					started: '2024-01-15T12:00:01Z',
					ended: '2024-01-15T12:00:05Z',
					message: 'No indexers available'
				})
			)
		);
		const client = new ClientClass(config);
		const result = await client.getCommandStatus(12345);
		expect(result.status).toBe('failed');
		expect(result.message).toBe('No indexers available');
	});

	it('should include X-Api-Key header', async () => {
		let capturedHeaders: Headers | undefined;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedHeaders = new Headers(init?.headers);
				return mockJsonResponse({
					id: 12345,
					name: commandName,
					status: 'completed',
					queued: '2024-01-15T12:00:00Z'
				});
			})
		);
		const client = new ClientClass(config);
		await client.getCommandStatus(12345);
		expect(capturedHeaders?.get('X-Api-Key')).toBe(apiKey);
	});

	it('should use GET method (default)', async () => {
		let capturedMethod: string | undefined;
		globalThis.fetch = createMockFetch(
			vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
				capturedMethod = init?.method;
				return mockJsonResponse({
					id: 12345,
					name: commandName,
					status: 'completed',
					queued: '2024-01-15T12:00:00Z'
				});
			})
		);
		const client = new ClientClass(config);
		await client.getCommandStatus(12345);
		expect(capturedMethod).toBe('GET');
	});
}
