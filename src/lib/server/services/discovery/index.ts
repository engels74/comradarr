/**
 * Discovery service for identifying content gaps and upgrade candidates.
 *
 * This module exports functions for discovering:
 * - Content gaps: monitored items without files (hasFile=false)
 * - Upgrade candidates: items below quality cutoff (qualityCutoffNotMet=true)
 *
 * @module services/discovery
 * @requirements 3.1, 3.2, 3.3, 4.1, 4.2, 4.3
 */

// Types
export type {
	GapDiscoveryResult,
	UpgradeDiscoveryResult,
	DiscoveryOptions,
	ContentGap,
	DiscoveryStats
} from './types';

// Gap detection
export { discoverGaps, getGapStats } from './gap-detector';
