/**
 * Scheduler property tests have been moved to tests/integration/scheduler-health.test.ts
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
 * This file is a placeholder - the actual tests are in tests/integration/.
 */

import { describe, it } from 'vitest';

describe('Scheduler Property Tests', () => {
	describe('Property 19: Unhealthy Connector Exclusion', () => {
		it.skip('tests in tests/integration/scheduler-health.test.ts (requires PostgreSQL)', () => {
			// Integration tests require:
			// - A running PostgreSQL database
			// - Bun runtime (not Node.js/vitest)
			// - DATABASE_URL and SECRET_KEY environment variables
			//
			// Run: uv run --project dev-cli cr-dev --help
		});
	});
});
