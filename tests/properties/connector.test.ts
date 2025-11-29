/**
 * Connector persistence tests have been moved to tests/integration/connector.test.ts
 *
 * Integration tests require Bun's native SQL driver and a PostgreSQL database.
 *
 * Quick setup:
 *   1. Install PostgreSQL (WSL): ./scripts/test-db.sh install
 *   2. Start PostgreSQL:         ./scripts/test-db.sh start
 *   3. Create test database:     bun run test:db:setup
 *   4. Run integration tests:    eval "$(./scripts/test-db.sh env)" && bun test tests/integration/
 *
 * See scripts/test-db.sh for detailed usage and cleanup commands.
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
		// Run: ./scripts/test-db.sh help
	});
});
