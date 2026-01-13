/**
 * HMR-safe singleton utilities for Vite development.
 *
 * During Vite's Hot Module Replacement, modules are re-evaluated but external
 * resources (database connections, cron jobs) persist. This causes resource leaks
 * and initialization errors when module-scope state resets.
 *
 * These utilities use globalThis to store singleton instances, which persists
 * across module re-evaluations during HMR.
 */

/**
 * Creates an HMR-safe singleton that persists across Vite module reloads.
 * Uses globalThis to store instances, preventing duplicate creation during HMR.
 *
 * @param key Unique identifier for this singleton (prefixed with __hmr_)
 * @param factory Function that creates the singleton instance
 * @returns The singleton instance (existing or newly created)
 *
 * @example
 * ```typescript
 * const db = getOrCreateSingleton('db-client', () => new SQL({ url: DATABASE_URL }));
 * ```
 */
export function getOrCreateSingleton<T>(key: string, factory: () => T): T {
	const globalKey = `__hmr_${key}` as keyof typeof globalThis;

	if (globalThis[globalKey] === undefined) {
		(globalThis as Record<string, unknown>)[globalKey] = factory();
	}

	return globalThis[globalKey] as T;
}

/**
 * Clears a singleton from globalThis. Useful for testing or graceful shutdown.
 *
 * @param key The same key used when creating the singleton
 */
export function clearSingleton(key: string): void {
	const globalKey = `__hmr_${key}` as keyof typeof globalThis;
	delete (globalThis as Record<string, unknown>)[globalKey];
}

/**
 * Checks if a singleton exists without creating it.
 *
 * @param key The singleton key to check
 * @returns true if the singleton exists
 */
export function hasSingleton(key: string): boolean {
	const globalKey = `__hmr_${key}` as keyof typeof globalThis;
	return globalThis[globalKey] !== undefined;
}
