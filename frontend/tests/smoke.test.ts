import { expect, test } from 'bun:test';

// Smoke test ensures `bun test` always finds at least one test
// (Bun exits non-zero with no tests collected — see plan §5
// "Smoke test rationale (MUST-FIX-3)"). Will be replaced by real
// suites in later phases.
test('smoke', () => {
	expect(true).toBe(true);
});
