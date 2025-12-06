/**
 * Unit tests for connector client factory
 *
 * Tests cover:
 * - Creating correct client type based on connector type
 * - Error handling for unknown connector types
 * - Configuration passthrough
 *

 */

import { describe, it, expect } from 'vitest';
import { createConnectorClient } from '../../src/lib/server/connectors/factory';
import { SonarrClient } from '../../src/lib/server/connectors/sonarr/client';
import { RadarrClient } from '../../src/lib/server/connectors/radarr/client';
import { WhisparrClient } from '../../src/lib/server/connectors/whisparr/client';
import type { Connector } from '../../src/lib/server/db/schema';

// Helper to create a mock connector
function createMockConnector(type: string): Connector {
	return {
		id: 1,
		type,
		name: `Test ${type}`,
		url: 'http://localhost:8989',
		apiKeyEncrypted: 'encrypted-key',
		enabled: true,
		healthStatus: 'unknown',
		lastSync: null,
		queuePaused: false,
		throttleProfileId: null,
		createdAt: new Date(),
		updatedAt: new Date()
	} as Connector;
}

describe('createConnectorClient', () => {
	describe('client type selection', () => {
		it('should return SonarrClient for sonarr type', () => {
			const connector = createMockConnector('sonarr');
			const client = createConnectorClient(connector, 'test-api-key');

			expect(client).toBeInstanceOf(SonarrClient);
		});

		it('should return RadarrClient for radarr type', () => {
			const connector = createMockConnector('radarr');
			const client = createConnectorClient(connector, 'test-api-key');

			expect(client).toBeInstanceOf(RadarrClient);
		});

		it('should return WhisparrClient for whisparr type', () => {
			const connector = createMockConnector('whisparr');
			const client = createConnectorClient(connector, 'test-api-key');

			expect(client).toBeInstanceOf(WhisparrClient);
		});
	});

	describe('error handling', () => {
		it('should throw error for unknown connector type', () => {
			const connector = createMockConnector('unknown');

			expect(() => createConnectorClient(connector, 'test-api-key')).toThrow(
				'Unknown connector type: unknown'
			);
		});

		it('should throw error for empty connector type', () => {
			const connector = createMockConnector('');

			expect(() => createConnectorClient(connector, 'test-api-key')).toThrow(
				'Unknown connector type: '
			);
		});
	});

	describe('timeout configuration', () => {
		it('should use default timeout of 15000ms when not specified', () => {
			const connector = createMockConnector('sonarr');
			const client = createConnectorClient(connector, 'test-api-key');

			// Access the protected timeout via type assertion
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((client as any).timeout).toBe(15000);
		});

		it('should use custom timeout when specified', () => {
			const connector = createMockConnector('sonarr');
			const client = createConnectorClient(connector, 'test-api-key', 30000);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((client as any).timeout).toBe(30000);
		});
	});

	describe('URL configuration', () => {
		it('should pass connector URL to client', () => {
			const connector = createMockConnector('sonarr');
			connector.url = 'http://sonarr.local:8989';
			const client = createConnectorClient(connector, 'test-api-key');

			// Access the protected baseUrl via type assertion
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((client as any).baseUrl).toBe('http://sonarr.local:8989');
		});

		it('should pass API key to client', () => {
			const connector = createMockConnector('sonarr');
			const client = createConnectorClient(connector, 'my-secret-api-key');

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect((client as any).apiKey).toBe('my-secret-api-key');
		});
	});
});
