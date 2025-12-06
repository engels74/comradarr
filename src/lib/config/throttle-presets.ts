/**
 * Throttle profile preset constants.
 *
 * These constants define the three standard throttle profiles and match
 * the values seeded in the database migration. They serve as:
 * 1. Documentation of expected preset values
 * 2. Fallback when no database profile is available
 * 3. Reference for profile resolution logic
 *
 */

/**
 * Throttle preset configuration structure.
 * Matches the throttle_profiles table schema.
 */
export interface ThrottlePreset {
	readonly name: string;
	readonly description: string;
	readonly requestsPerMinute: number;
	readonly dailyBudget: number | null; // null = unlimited
	readonly batchSize: number;
	readonly batchCooldownSeconds: number;
	readonly rateLimitPauseSeconds: number;
}

/**
 * Conservative throttle preset.
 * Low rate limits for shared/public indexers that have strict rate limiting.
 *
 * - 2 requests per minute
 * - 200 requests daily budget
 * - 5 items per batch
 * - 120s cooldown between batches
 * - 600s pause on rate limit (HTTP 429)
 */
export const CONSERVATIVE_PRESET: ThrottlePreset = {
	name: 'Conservative',
	description: 'Low rate limits for shared/public indexers',
	requestsPerMinute: 2,
	dailyBudget: 200,
	batchSize: 5,
	batchCooldownSeconds: 120,
	rateLimitPauseSeconds: 600
} as const;

/**
 * Moderate throttle preset.
 * Balanced rate limits for typical usage with most indexers.
 * This is the default preset.
 *
 * - 5 requests per minute
 * - 500 requests daily budget
 * - 10 items per batch
 * - 60s cooldown between batches
 * - 300s pause on rate limit (HTTP 429)
 */
export const MODERATE_PRESET: ThrottlePreset = {
	name: 'Moderate',
	description: 'Balanced rate limits for typical usage',
	requestsPerMinute: 5,
	dailyBudget: 500,
	batchSize: 10,
	batchCooldownSeconds: 60,
	rateLimitPauseSeconds: 300
} as const;

/**
 * Aggressive throttle preset.
 * High rate limits for private indexers with generous allowances.
 *
 * - 15 requests per minute
 * - Unlimited daily budget
 * - 10 items per batch
 * - 30s cooldown between batches
 * - 120s pause on rate limit (HTTP 429)
 */
export const AGGRESSIVE_PRESET: ThrottlePreset = {
	name: 'Aggressive',
	description: 'High rate limits for private indexers',
	requestsPerMinute: 15,
	dailyBudget: null, // unlimited
	batchSize: 10,
	batchCooldownSeconds: 30,
	rateLimitPauseSeconds: 120
} as const;

/**
 * Map of all preset profiles by lowercase key.
 */
export const PRESETS = {
	conservative: CONSERVATIVE_PRESET,
	moderate: MODERATE_PRESET,
	aggressive: AGGRESSIVE_PRESET
} as const;

/**
 * Preset name type for type-safe preset lookups.
 */
export type PresetName = keyof typeof PRESETS;

/**
 * Default fallback preset when no profile is configured.
 * Used as the final fallback in profile resolution:
 * 1. Connector-specific profile
 * 2. Default profile (is_default=true)
 * 3. This fallback constant
 */
export const DEFAULT_FALLBACK_PRESET = MODERATE_PRESET;

/**
 * Gets a preset by name (case-insensitive).
 *
 * @param name - Preset name to look up
 * @returns The preset if found, undefined otherwise
 */
export function getPresetByName(name: string): ThrottlePreset | undefined {
	const key = name.toLowerCase() as PresetName;
	return PRESETS[key];
}

/**
 * Checks if a value matches a preset name.
 *
 * @param name - Name to check
 * @returns true if the name matches a preset
 */
export function isPresetName(name: string): name is PresetName {
	return name.toLowerCase() in PRESETS;
}
