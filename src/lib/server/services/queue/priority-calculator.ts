// Deterministic priority scoring: newer content, longer missing, fewer failures = higher priority

import { DEFAULT_PRIORITY_WEIGHTS, getPriorityWeights, PRIORITY_CONSTANTS } from './config';
import type { PriorityBreakdown, PriorityInput, PriorityResult, PriorityWeights } from './types';

export function calculatePriority(
	input: PriorityInput,
	weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
	now: Date = new Date()
): PriorityResult {
	const contentAgeRaw = calculateContentAgeScore(input.contentDate, now);
	const missingDurationRaw = calculateMissingDurationScore(input.discoveredAt, now);
	const searchTypeBonus = input.searchType === 'gap' ? weights.gapBonus : 0;

	const contentAgeScore = contentAgeRaw * (weights.contentAge / PRIORITY_CONSTANTS.WEIGHT_SCALE);
	const missingDurationScore =
		missingDurationRaw * (weights.missingDuration / PRIORITY_CONSTANTS.WEIGHT_SCALE);
	const userPriorityScore =
		input.userPriorityOverride * (weights.userPriority / PRIORITY_CONSTANTS.WEIGHT_SCALE);
	const failurePenalty = input.attemptCount * weights.failurePenalty;

	// Season 0 (specials) penalty - only applies to episodes
	const specialsPenalty = input.seasonNumber === 0 ? weights.specialsPenalty : 0;

	// File lost bonus - higher priority for re-acquiring content that was previously downloaded
	const fileLostBonus = calculateFileLostBonus(
		input.wasDownloaded ?? false,
		input.fileLostAt ?? null,
		weights.fileLostBonus,
		now
	);

	const rawScore =
		PRIORITY_CONSTANTS.BASE_SCORE +
		contentAgeScore +
		missingDurationScore +
		userPriorityScore -
		failurePenalty +
		searchTypeBonus -
		specialsPenalty +
		fileLostBonus;

	const score = Math.round(rawScore);

	const breakdown: PriorityBreakdown = {
		contentAgeScore,
		missingDurationScore,
		userPriorityScore,
		failurePenalty,
		searchTypeBonus,
		specialsPenalty,
		fileLostBonus
	};

	return { score, breakdown };
}

// Newer content scores higher; unknown date gets neutral score
function calculateContentAgeScore(contentDate: Date | null, now: Date): number {
	if (contentDate === null) {
		return PRIORITY_CONSTANTS.FACTOR_SCALE * 0.5;
	}

	const ageDays = Math.max(0, (now.getTime() - contentDate.getTime()) / (1000 * 60 * 60 * 24));
	const normalizedAge = Math.min(ageDays / PRIORITY_CONSTANTS.MAX_CONTENT_AGE_DAYS, 1);
	return PRIORITY_CONSTANTS.FACTOR_SCALE * (1 - normalizedAge);
}

// Items missing longer score higher
function calculateMissingDurationScore(discoveredAt: Date, now: Date): number {
	const durationDays = Math.max(
		0,
		(now.getTime() - discoveredAt.getTime()) / (1000 * 60 * 60 * 24)
	);
	const normalizedDuration = Math.min(
		durationDays / PRIORITY_CONSTANTS.MAX_MISSING_DURATION_DAYS,
		1
	);
	return PRIORITY_CONSTANTS.FACTOR_SCALE * normalizedDuration;
}

// Content that was previously downloaded gets a priority boost that decays over time
function calculateFileLostBonus(
	wasDownloaded: boolean,
	fileLostAt: Date | null,
	bonusWeight: number,
	now: Date
): number {
	// No bonus if content was never downloaded
	if (!wasDownloaded || fileLostAt === null) {
		return 0;
	}

	const daysSinceLost = Math.max(0, (now.getTime() - fileLostAt.getTime()) / (1000 * 60 * 60 * 24));

	// Decay to zero over FILE_LOST_DECAY_DAYS
	const decayFactor = Math.max(0, 1 - daysSinceLost / PRIORITY_CONSTANTS.FILE_LOST_DECAY_DAYS);

	return bonusWeight * decayFactor;
}

// Higher score = higher priority = comes first
export function comparePriority(a: PriorityResult, b: PriorityResult): number {
	return b.score - a.score;
}

export async function calculatePriorityWithConfig(
	input: PriorityInput,
	now: Date = new Date()
): Promise<PriorityResult> {
	const weights = await getPriorityWeights();
	return calculatePriority(input, weights, now);
}
