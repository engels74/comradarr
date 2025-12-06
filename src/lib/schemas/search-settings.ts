/**
 * Validation schemas for search behavior settings forms.
 */

import * as v from 'valibot';

// =============================================================================
// Priority Weights Schema
// =============================================================================

export const PriorityWeightsSchema = v.object({
	contentAge: v.pipe(
		v.number('Content age weight must be a number'),
		v.integer('Content age weight must be a whole number'),
		v.minValue(0, 'Content age weight must be at least 0'),
		v.maxValue(100, 'Content age weight must be at most 100')
	),
	missingDuration: v.pipe(
		v.number('Missing duration weight must be a number'),
		v.integer('Missing duration weight must be a whole number'),
		v.minValue(0, 'Missing duration weight must be at least 0'),
		v.maxValue(100, 'Missing duration weight must be at most 100')
	),
	userPriority: v.pipe(
		v.number('User priority weight must be a number'),
		v.integer('User priority weight must be a whole number'),
		v.minValue(0, 'User priority weight must be at least 0'),
		v.maxValue(100, 'User priority weight must be at most 100')
	),
	failurePenalty: v.pipe(
		v.number('Failure penalty must be a number'),
		v.integer('Failure penalty must be a whole number'),
		v.minValue(0, 'Failure penalty must be at least 0'),
		v.maxValue(100, 'Failure penalty must be at most 100')
	),
	gapBonus: v.pipe(
		v.number('Gap bonus must be a number'),
		v.integer('Gap bonus must be a whole number'),
		v.minValue(0, 'Gap bonus must be at least 0'),
		v.maxValue(100, 'Gap bonus must be at most 100')
	)
});

export type PriorityWeightsInput = v.InferInput<typeof PriorityWeightsSchema>;
export type PriorityWeightsOutput = v.InferOutput<typeof PriorityWeightsSchema>;

// =============================================================================
// Season Pack Thresholds Schema
// =============================================================================

export const SeasonPackThresholdsSchema = v.object({
	minMissingPercent: v.pipe(
		v.number('Minimum missing percent must be a number'),
		v.integer('Minimum missing percent must be a whole number'),
		v.minValue(0, 'Minimum missing percent must be at least 0'),
		v.maxValue(100, 'Minimum missing percent must be at most 100')
	),
	minMissingCount: v.pipe(
		v.number('Minimum missing count must be a number'),
		v.integer('Minimum missing count must be a whole number'),
		v.minValue(1, 'Minimum missing count must be at least 1'),
		v.maxValue(100, 'Minimum missing count must be at most 100')
	)
});

export type SeasonPackThresholdsInput = v.InferInput<typeof SeasonPackThresholdsSchema>;
export type SeasonPackThresholdsOutput = v.InferOutput<typeof SeasonPackThresholdsSchema>;

// =============================================================================
// Cooldown Configuration Schema
// =============================================================================

export const CooldownConfigSchema = v.object({
	baseDelayHours: v.pipe(
		v.number('Base delay must be a number'),
		v.minValue(0.5, 'Base delay must be at least 0.5 hours'),
		v.maxValue(48, 'Base delay must be at most 48 hours')
	),
	maxDelayHours: v.pipe(
		v.number('Max delay must be a number'),
		v.minValue(1, 'Max delay must be at least 1 hour'),
		v.maxValue(168, 'Max delay must be at most 168 hours (7 days)')
	),
	multiplier: v.pipe(
		v.number('Multiplier must be a number'),
		v.minValue(1, 'Multiplier must be at least 1'),
		v.maxValue(5, 'Multiplier must be at most 5')
	),
	jitter: v.boolean('Jitter must be a boolean')
});

export type CooldownConfigInput = v.InferInput<typeof CooldownConfigSchema>;
export type CooldownConfigOutput = v.InferOutput<typeof CooldownConfigSchema>;

// =============================================================================
// Retry Configuration Schema
// =============================================================================

export const RetryConfigSchema = v.object({
	maxAttempts: v.pipe(
		v.number('Max attempts must be a number'),
		v.integer('Max attempts must be a whole number'),
		v.minValue(1, 'Max attempts must be at least 1'),
		v.maxValue(20, 'Max attempts must be at most 20')
	)
});

export type RetryConfigInput = v.InferInput<typeof RetryConfigSchema>;
export type RetryConfigOutput = v.InferOutput<typeof RetryConfigSchema>;

// =============================================================================
// Combined Search Settings Schema
// =============================================================================

export const SearchSettingsSchema = v.object({
	priorityWeights: PriorityWeightsSchema,
	seasonPackThresholds: SeasonPackThresholdsSchema,
	cooldownConfig: CooldownConfigSchema,
	retryConfig: RetryConfigSchema
});

export type SearchSettingsInput = v.InferInput<typeof SearchSettingsSchema>;
export type SearchSettingsOutput = v.InferOutput<typeof SearchSettingsSchema>;

// =============================================================================
// Field Labels for UI
// =============================================================================

export const priorityWeightLabels: Record<keyof PriorityWeightsOutput, string> = {
	contentAge: 'Content Age Weight',
	missingDuration: 'Missing Duration Weight',
	userPriority: 'User Priority Weight',
	failurePenalty: 'Failure Penalty',
	gapBonus: 'Gap Bonus'
};

export const priorityWeightDescriptions: Record<keyof PriorityWeightsOutput, string> = {
	contentAge: 'Higher values prioritize newer content. Range: 0-100.',
	missingDuration: 'Higher values prioritize items missing longer. Range: 0-100.',
	userPriority: 'Weight applied to user-set priority overrides. Range: 0-100.',
	failurePenalty: 'Points subtracted per failed search attempt. Range: 0-100.',
	gapBonus: 'Bonus points for gap searches over upgrades. Range: 0-100.'
};

export const seasonPackLabels: Record<keyof SeasonPackThresholdsOutput, string> = {
	minMissingPercent: 'Minimum Missing Percentage',
	minMissingCount: 'Minimum Missing Episode Count'
};

export const seasonPackDescriptions: Record<keyof SeasonPackThresholdsOutput, string> = {
	minMissingPercent:
		'Only use season pack search when this percentage of episodes are missing (0-100).',
	minMissingCount: 'Minimum number of missing episodes required for season pack search.'
};

export const cooldownLabels: Record<keyof CooldownConfigOutput, string> = {
	baseDelayHours: 'Base Cooldown Delay (hours)',
	maxDelayHours: 'Maximum Cooldown Delay (hours)',
	multiplier: 'Backoff Multiplier',
	jitter: 'Enable Jitter'
};

export const cooldownDescriptions: Record<keyof CooldownConfigOutput, string> = {
	baseDelayHours: 'Initial delay after first failure in hours.',
	maxDelayHours: 'Maximum delay cap regardless of attempt count in hours.',
	multiplier: 'Multiply delay by this factor after each failure.',
	jitter: 'Add randomness to delays to prevent thundering herd.'
};

export const retryLabels: Record<keyof RetryConfigOutput, string> = {
	maxAttempts: 'Maximum Retry Attempts'
};

export const retryDescriptions: Record<keyof RetryConfigOutput, string> = {
	maxAttempts: 'Number of failed attempts before marking item as exhausted.'
};

// =============================================================================
// Default Values
// =============================================================================

export const SEARCH_SETTINGS_DEFAULTS: SearchSettingsOutput = {
	priorityWeights: {
		contentAge: 30,
		missingDuration: 25,
		userPriority: 40,
		failurePenalty: 10,
		gapBonus: 20
	},
	seasonPackThresholds: {
		minMissingPercent: 50,
		minMissingCount: 3
	},
	cooldownConfig: {
		baseDelayHours: 1,
		maxDelayHours: 24,
		multiplier: 2,
		jitter: true
	},
	retryConfig: {
		maxAttempts: 5
	}
};
