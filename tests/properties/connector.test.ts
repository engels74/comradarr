/**
 * Connector persistence tests have been moved to tests/integration/connector.test.ts
 *
 * Integration tests require Bun's native SQL driver and a PostgreSQL database.
 *
 * Quick setup (via cr-dev CLI from project root):
 *   1. Install PostgreSQL:       uv run --project dev-cli cr-dev db install
 *   2. Start PostgreSQL:         uv run --project dev-cli cr-dev db start
 *   3. Create test database:     bun run test:db:setup
 *   4. Run integration tests:    bun run test:integration
 *
 * Alternative: Use the interactive TUI menu:
 *   uv run --project dev-cli cr-dev menu
 *
 * This file is a placeholder - the actual tests are in tests/integration/connector.test.ts.
 */

import { describe, it } from 'vitest';

describe('Connector Data Persistence', () => {
	it.skip('tests moved to tests/integration/ (see comment above for setup instructions)', () => {
		// Integration tests require:
		// - A running PostgreSQL database
		// - Bun runtime (not Node.js/vitest)
		// - DATABASE_URL and SECRET_KEY environment variables
		//
		// Run: uv run --project dev-cli cr-dev --help
	});
});
