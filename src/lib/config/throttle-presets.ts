export interface ThrottlePreset {
	readonly name: string;
	readonly description: string;
	readonly requestsPerMinute: number;
	readonly dailyBudget: number | null; // null = unlimited
	readonly batchSize: number;
	readonly batchCooldownSeconds: number;
	readonly rateLimitPauseSeconds: number;
}

export const CONSERVATIVE_PRESET: ThrottlePreset = {
	name: 'Conservative',
	description: 'Low rate limits for shared/public indexers',
	requestsPerMinute: 2,
	dailyBudget: 200,
	batchSize: 5,
	batchCooldownSeconds: 120,
	rateLimitPauseSeconds: 600
} as const;

export const MODERATE_PRESET: ThrottlePreset = {
	name: 'Moderate',
	description: 'Balanced rate limits for typical usage',
	requestsPerMinute: 5,
	dailyBudget: 500,
	batchSize: 10,
	batchCooldownSeconds: 60,
	rateLimitPauseSeconds: 300
} as const;

export const AGGRESSIVE_PRESET: ThrottlePreset = {
	name: 'Aggressive',
	description: 'High rate limits for private indexers',
	requestsPerMinute: 15,
	dailyBudget: null, // unlimited
	batchSize: 10,
	batchCooldownSeconds: 30,
	rateLimitPauseSeconds: 120
} as const;

export const PRESETS = {
	conservative: CONSERVATIVE_PRESET,
	moderate: MODERATE_PRESET,
	aggressive: AGGRESSIVE_PRESET
} as const;

export type PresetName = keyof typeof PRESETS;

export const DEFAULT_FALLBACK_PRESET = MODERATE_PRESET;

export function getPresetByName(name: string): ThrottlePreset | undefined {
	const key = name.toLowerCase() as PresetName;
	return PRESETS[key];
}

export function isPresetName(name: string): name is PresetName {
	return name.toLowerCase() in PRESETS;
}
