/**
 * Discovery service for identifying content gaps and upgrade candidates.
 *
 * This module exports functions for discovering:
 * - Content gaps: monitored items without files (hasFile=false)
 * - Upgrade candidates: items below quality cutoff (qualityCutoffNotMet=true)
 *
 * Also handles cleanup of resolved registries:
 * - Gap registries cleaned when hasFile becomes true (Requirement 3.4)
 * - Upgrade registries cleaned when qualityCutoffNotMet becomes false (Requirement 4.4)
 *
 * @module services/discovery

 */

// Gap detection
export { discoverGaps, getGapStats } from './gap-detector';
// Types
export type {
	ContentGap,
	DiscoveryOptions,
	DiscoveryStats,
	GapDiscoveryResult,
	UpgradeDiscoveryResult
} from './types';

// Upgrade detection
export { discoverUpgrades, getUpgradeStats } from './upgrade-detector';
