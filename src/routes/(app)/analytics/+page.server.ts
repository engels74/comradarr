/**
 * Analytics dashboard server load function.
 *
 * Provides:
 * - Time series metrics (discovery, search volume, queue depth)
 * - Connector comparison statistics
 * - Content analysis (most searched, hardest to find, quality distribution)
 * - Summary statistics
 */

import {
	getAnalyticsSummary,
	getConnectorComparison,
	getDiscoveryMetrics,
	getHardestToFindItems,
	getMostSearchedItems,
	getQualityDistribution,
	getQueueMetrics,
	getSearchMetrics,
	type TimePeriod
} from '$lib/server/db/queries/analytics';
import type { PageServerLoad } from './$types';

/**
 * Serializes time series data points (converts Date to ISO string).
 */
function serializeTimeSeries(data: Array<{ timestamp: Date; value: number }>) {
	return data.map((point) => ({
		timestamp: point.timestamp.toISOString(),
		value: point.value
	}));
}

export const load: PageServerLoad = async ({ url, depends }) => {
	// Register dependency for selective invalidation
	depends('app:analytics');

	// Parse and validate period from URL
	let period = (url.searchParams.get('period') as TimePeriod) || '7d';
	if (!['24h', '7d', '30d'].includes(period)) {
		period = '7d';
	}

	// Fetch all analytics data in parallel
	const [
		discoveryMetrics,
		searchMetrics,
		queueMetrics,
		connectorStats,
		mostSearched,
		hardestToFind,
		qualityDistribution,
		summary
	] = await Promise.all([
		getDiscoveryMetrics(period),
		getSearchMetrics(period),
		getQueueMetrics(period),
		getConnectorComparison(period),
		getMostSearchedItems(10),
		getHardestToFindItems(10),
		getQualityDistribution(),
		getAnalyticsSummary(period)
	]);

	// Serialize discovery metrics
	const serializedDiscoveryMetrics = discoveryMetrics.map((m) => ({
		connectorId: m.connectorId,
		connectorName: m.connectorName,
		connectorType: m.connectorType,
		gapsDiscovered: serializeTimeSeries(m.gapsDiscovered),
		upgradesDiscovered: serializeTimeSeries(m.upgradesDiscovered)
	}));

	// Serialize search metrics
	const serializedSearchMetrics = searchMetrics.map((m) => ({
		connectorId: m.connectorId,
		connectorName: m.connectorName,
		connectorType: m.connectorType,
		searchesDispatched: serializeTimeSeries(m.searchesDispatched),
		searchesSuccessful: serializeTimeSeries(m.searchesSuccessful),
		searchesFailed: serializeTimeSeries(m.searchesFailed),
		searchesNoResults: serializeTimeSeries(m.searchesNoResults)
	}));

	// Serialize queue metrics
	const serializedQueueMetrics = queueMetrics.map((m) => ({
		connectorId: m.connectorId,
		connectorName: m.connectorName,
		connectorType: m.connectorType,
		avgQueueDepth: serializeTimeSeries(m.avgQueueDepth),
		peakQueueDepth: serializeTimeSeries(m.peakQueueDepth)
	}));

	// Serialize most searched items
	const serializedMostSearched = mostSearched.map((item) => ({
		...item,
		lastSearched: item.lastSearched.toISOString()
	}));

	return {
		period,
		discoveryMetrics: serializedDiscoveryMetrics,
		searchMetrics: serializedSearchMetrics,
		queueMetrics: serializedQueueMetrics,
		connectorStats,
		mostSearched: serializedMostSearched,
		hardestToFind,
		qualityDistribution,
		summary
	};
};
