/**
 * Aggregate payload builders for notification batching.
 *
 * Combines multiple notification history entries of the same event type
 * into a single digest notification payload.
 *
 * @module services/notifications/aggregators

 */

import type { NotificationEventType } from '$lib/server/db/queries/notifications';
import type { NotificationHistory } from '$lib/server/db/schema';
import { getEventColor } from './base-channel';
import type {
	AppStartedData,
	ConnectorHealthChangedData,
	SearchExhaustedData,
	SearchSuccessData,
	SweepCompletedData,
	SweepStartedData,
	SyncCompletedData,
	SyncFailedData,
	UpdateAvailableData
} from './templates';
import type { NotificationField, NotificationPayload } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Maximum number of items to list in aggregated messages */
const MAX_LIST_ITEMS = 5;

/** Maximum length for truncated content titles */
const MAX_TITLE_LENGTH = 40;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Truncate text to a maximum length with ellipsis.
 */
function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 3)}...`;
}

/**
 * Format a content title with optional year/episode info.
 */
function formatContentTitle(data: SearchSuccessData | SearchExhaustedData): string {
	let title = data.contentTitle;
	if (data.contentYear) {
		title += ` (${data.contentYear})`;
	}
	if (
		data.contentType === 'episode' &&
		data.seasonNumber !== undefined &&
		data.episodeNumber !== undefined
	) {
		title += ` S${String(data.seasonNumber).padStart(2, '0')}E${String(data.episodeNumber).padStart(2, '0')}`;
	}
	return truncateText(title, MAX_TITLE_LENGTH);
}

/**
 * Extract typed event data from notification history entry.
 * Returns null if eventData is missing or invalid.
 */
function extractEventData<T>(entry: NotificationHistory): T | null {
	if (!entry.eventData || typeof entry.eventData !== 'object') {
		return null;
	}
	return entry.eventData as T;
}

/**
 * Create a list of items with "and N more" suffix if truncated.
 */
function formatItemList(items: string[], maxItems: number = MAX_LIST_ITEMS): string {
	if (items.length === 0) return 'none';
	if (items.length === 1) return items[0]!;

	if (items.length <= maxItems) {
		return items.join(', ');
	}

	const displayed = items.slice(0, maxItems);
	const remaining = items.length - maxItems;
	return `${displayed.join(', ')} and ${remaining} more`;
}

// =============================================================================
// Aggregator Functions
// =============================================================================

/**
 * Aggregate multiple search_success events into a single payload.
 */
function aggregateSearchSuccess(entries: NotificationHistory[]): NotificationPayload {
	const items: Array<{ title: string; quality: string; connector: string }> = [];

	for (const entry of entries) {
		const data = extractEventData<SearchSuccessData>(entry);
		if (data) {
			items.push({
				title: formatContentTitle(data),
				quality: data.quality,
				connector: data.connectorName
			});
		}
	}

	const titles = items.map((i) => i.title);
	const connectors = [...new Set(items.map((i) => i.connector))];
	const qualities = [...new Set(items.map((i) => i.quality))];

	const fields: NotificationField[] = [
		{ name: 'Total Items', value: String(items.length), inline: true }
	];

	if (connectors.length === 1 && connectors[0]) {
		fields.push({ name: 'Source', value: connectors[0], inline: true });
	} else if (connectors.length > 1) {
		fields.push({ name: 'Sources', value: formatItemList(connectors, 3), inline: true });
	}

	if (qualities.length === 1 && qualities[0]) {
		fields.push({ name: 'Quality', value: qualities[0], inline: true });
	} else if (qualities.length > 1) {
		fields.push({ name: 'Qualities', value: formatItemList(qualities, 3), inline: true });
	}

	fields.push({ name: 'Items', value: formatItemList(titles), inline: false });

	return {
		eventType: 'search_success',
		title: `${items.length} Items Found`,
		message: `${items.length} item${items.length === 1 ? '' : 's'} found and grabbed: ${formatItemList(titles)}`,
		fields,
		color: getEventColor('search_success'),
		timestamp: new Date(),
		eventData: { individualCount: items.length, items }
	};
}

/**
 * Aggregate multiple search_exhausted events into a single payload.
 */
function aggregateSearchExhausted(entries: NotificationHistory[]): NotificationPayload {
	const items: Array<{ title: string; attempts: number; connector: string }> = [];

	for (const entry of entries) {
		const data = extractEventData<SearchExhaustedData>(entry);
		if (data) {
			items.push({
				title: formatContentTitle(data),
				attempts: data.attempts,
				connector: data.connectorName
			});
		}
	}

	const titles = items.map((i) => `${i.title} (${i.attempts} attempts)`);
	const connectors = [...new Set(items.map((i) => i.connector))];
	const totalAttempts = items.reduce((sum, i) => sum + i.attempts, 0);

	const fields: NotificationField[] = [
		{ name: 'Total Items', value: String(items.length), inline: true },
		{ name: 'Total Attempts', value: String(totalAttempts), inline: true }
	];

	if (connectors.length === 1 && connectors[0]) {
		fields.push({ name: 'Source', value: connectors[0], inline: true });
	}

	fields.push({ name: 'Items', value: formatItemList(titles), inline: false });

	return {
		eventType: 'search_exhausted',
		title: `${items.length} Searches Exhausted`,
		message: `${items.length} item${items.length === 1 ? '' : 's'} could not be found after ${totalAttempts} total attempts`,
		fields,
		color: getEventColor('search_exhausted'),
		timestamp: new Date(),
		eventData: { individualCount: items.length, items }
	};
}

/**
 * Aggregate multiple sweep_started events into a single payload.
 */
function aggregateSweepStarted(entries: NotificationHistory[]): NotificationPayload {
	const connectors: string[] = [];
	const sweepTypes = new Set<string>();

	for (const entry of entries) {
		const data = extractEventData<SweepStartedData>(entry);
		if (data) {
			connectors.push(data.connectorName);
			sweepTypes.add(data.sweepType);
		}
	}

	const uniqueConnectors = [...new Set(connectors)];
	const sweepTypeLabel = sweepTypes.has('both')
		? 'Gaps & Upgrades'
		: sweepTypes.has('gap') && sweepTypes.has('upgrade')
			? 'Gaps & Upgrades'
			: sweepTypes.has('gap')
				? 'Content Gaps'
				: 'Quality Upgrades';

	const fields: NotificationField[] = [
		{ name: 'Sweeps Started', value: String(entries.length), inline: true },
		{ name: 'Sweep Type', value: sweepTypeLabel, inline: true },
		{ name: 'Connectors', value: formatItemList(uniqueConnectors), inline: false }
	];

	return {
		eventType: 'sweep_started',
		title: `${entries.length} Sweeps Started`,
		message: `Starting ${sweepTypeLabel.toLowerCase()} sweeps on ${formatItemList(uniqueConnectors)}`,
		fields,
		color: getEventColor('sweep_started'),
		timestamp: new Date(),
		eventData: { individualCount: entries.length, connectors: uniqueConnectors }
	};
}

/**
 * Aggregate multiple sweep_completed events into a single payload.
 */
function aggregateSweepCompleted(entries: NotificationHistory[]): NotificationPayload {
	let totalGaps = 0;
	let totalUpgrades = 0;
	let totalQueued = 0;
	const connectors: string[] = [];

	for (const entry of entries) {
		const data = extractEventData<SweepCompletedData>(entry);
		if (data) {
			totalGaps += data.gapsFound;
			totalUpgrades += data.upgradesFound ?? 0;
			totalQueued += data.itemsQueued;
			connectors.push(data.connectorName);
		}
	}

	const uniqueConnectors = [...new Set(connectors)];

	const fields: NotificationField[] = [
		{ name: 'Sweeps Completed', value: String(entries.length), inline: true },
		{ name: 'Gaps Found', value: String(totalGaps), inline: true },
		{ name: 'Upgrades Found', value: String(totalUpgrades), inline: true },
		{ name: 'Items Queued', value: String(totalQueued), inline: true },
		{ name: 'Connectors', value: formatItemList(uniqueConnectors), inline: false }
	];

	return {
		eventType: 'sweep_completed',
		title: `${entries.length} Sweeps Complete`,
		message: `${entries.length} sweep${entries.length === 1 ? '' : 's'} completed. Found ${totalGaps} gaps, ${totalUpgrades} upgrades, and queued ${totalQueued} items.`,
		fields,
		color: getEventColor('sweep_completed'),
		timestamp: new Date(),
		eventData: {
			individualCount: entries.length,
			totalGaps,
			totalUpgrades,
			totalQueued,
			connectors: uniqueConnectors
		}
	};
}

/**
 * Aggregate multiple sync_completed events into a single payload.
 */
function aggregateSyncCompleted(entries: NotificationHistory[]): NotificationPayload {
	let totalProcessed = 0;
	let totalCreated = 0;
	let totalUpdated = 0;
	let totalDeleted = 0;
	const connectors: string[] = [];

	for (const entry of entries) {
		const data = extractEventData<SyncCompletedData>(entry);
		if (data) {
			totalProcessed += data.itemsProcessed;
			totalCreated += data.itemsCreated ?? 0;
			totalUpdated += data.itemsUpdated ?? 0;
			totalDeleted += data.itemsDeleted ?? 0;
			connectors.push(data.connectorName);
		}
	}

	const uniqueConnectors = [...new Set(connectors)];

	const fields: NotificationField[] = [
		{ name: 'Syncs Completed', value: String(entries.length), inline: true },
		{ name: 'Items Processed', value: String(totalProcessed), inline: true },
		{ name: 'Created', value: String(totalCreated), inline: true },
		{ name: 'Updated', value: String(totalUpdated), inline: true },
		{ name: 'Deleted', value: String(totalDeleted), inline: true },
		{ name: 'Connectors', value: formatItemList(uniqueConnectors), inline: false }
	];

	return {
		eventType: 'sync_completed',
		title: `${entries.length} Syncs Complete`,
		message: `${entries.length} sync${entries.length === 1 ? '' : 's'} completed. Processed ${totalProcessed} items total.`,
		fields,
		color: getEventColor('sync_completed'),
		timestamp: new Date(),
		eventData: {
			individualCount: entries.length,
			totalProcessed,
			totalCreated,
			totalUpdated,
			totalDeleted,
			connectors: uniqueConnectors
		}
	};
}

/**
 * Aggregate multiple sync_failed events into a single payload.
 */
function aggregateSyncFailed(entries: NotificationHistory[]): NotificationPayload {
	const failures: Array<{ connector: string; error: string }> = [];

	for (const entry of entries) {
		const data = extractEventData<SyncFailedData>(entry);
		if (data) {
			failures.push({
				connector: data.connectorName,
				error: truncateText(data.error, 50)
			});
		}
	}

	const uniqueConnectors = [...new Set(failures.map((f) => f.connector))];
	const failureList = failures.map((f) => `${f.connector}: ${f.error}`);

	const fields: NotificationField[] = [
		{ name: 'Total Failures', value: String(entries.length), inline: true },
		{ name: 'Connectors Affected', value: String(uniqueConnectors.length), inline: true },
		{ name: 'Errors', value: formatItemList(failureList), inline: false }
	];

	return {
		eventType: 'sync_failed',
		title: `${entries.length} Sync Failures`,
		message: `${entries.length} sync${entries.length === 1 ? '' : 's'} failed on ${formatItemList(uniqueConnectors)}`,
		fields,
		color: getEventColor('sync_failed'),
		timestamp: new Date(),
		eventData: { individualCount: entries.length, failures }
	};
}

/**
 * Aggregate multiple connector_health_changed events into a single payload.
 */
function aggregateConnectorHealthChanged(entries: NotificationHistory[]): NotificationPayload {
	const changes: Array<{ connector: string; from: string; to: string }> = [];

	for (const entry of entries) {
		const data = extractEventData<ConnectorHealthChangedData>(entry);
		if (data) {
			changes.push({
				connector: data.connectorName,
				from: data.oldStatus,
				to: data.newStatus
			});
		}
	}

	const changeList = changes.map((c) => `${c.connector}: ${c.from} → ${c.to}`);

	// Determine overall direction
	const improvements = changes.filter((c) => isHealthImprovement(c.from, c.to)).length;
	const degradations = changes.length - improvements;
	const direction =
		improvements > degradations ? 'improved' : improvements < degradations ? 'degraded' : 'changed';

	const fields: NotificationField[] = [
		{ name: 'Total Changes', value: String(entries.length), inline: true },
		{ name: 'Improvements', value: String(improvements), inline: true },
		{ name: 'Degradations', value: String(degradations), inline: true },
		{ name: 'Details', value: formatItemList(changeList), inline: false }
	];

	return {
		eventType: 'connector_health_changed',
		title: `${entries.length} Health Changes`,
		message: `${entries.length} connector${entries.length === 1 ? '' : 's'} ${direction}`,
		fields,
		color: getEventColor('connector_health_changed'),
		timestamp: new Date(),
		eventData: { individualCount: entries.length, changes }
	};
}

/**
 * Check if health change is an improvement.
 */
function isHealthImprovement(oldStatus: string, newStatus: string): boolean {
	const statusOrder: Record<string, number> = {
		offline: 0,
		unhealthy: 1,
		degraded: 2,
		healthy: 3
	};

	const oldOrder = statusOrder[oldStatus.toLowerCase()] ?? 0;
	const newOrder = statusOrder[newStatus.toLowerCase()] ?? 0;

	return newOrder > oldOrder;
}

/**
 * Aggregate app_started events (usually just one, but handle multiple).
 */
function aggregateAppStarted(entries: NotificationHistory[]): NotificationPayload {
	// Usually app_started is a single event, but handle multiples gracefully
	const data = extractEventData<AppStartedData>(entries[0]!);

	const fields: NotificationField[] = [];
	if (data?.version) {
		fields.push({ name: 'Version', value: data.version, inline: true });
	}
	if (entries.length > 1) {
		fields.push({ name: 'Start Events', value: String(entries.length), inline: true });
	}

	const payload: NotificationPayload = {
		eventType: 'app_started',
		title: 'Comradarr Started',
		message: data?.version
			? `Comradarr v${data.version} has started successfully.`
			: 'Comradarr has started successfully.',
		color: getEventColor('app_started'),
		timestamp: new Date(),
		eventData: { individualCount: entries.length }
	};

	// Only add fields if we have any (exactOptionalPropertyTypes compatibility)
	if (fields.length > 0) {
		payload.fields = fields;
	}

	return payload;
}

/**
 * Aggregate update_available events (usually just one, but handle multiples).
 */
function aggregateUpdateAvailable(entries: NotificationHistory[]): NotificationPayload {
	// Usually update_available is a single event, use the latest
	const latestEntry = entries[entries.length - 1]!;
	const data = extractEventData<UpdateAvailableData>(latestEntry);

	const fields: NotificationField[] = [];
	if (data) {
		fields.push({ name: 'Current Version', value: data.currentVersion, inline: true });
		fields.push({ name: 'New Version', value: data.newVersion, inline: true });
		if (data.releaseNotes) {
			fields.push({
				name: 'Release Notes',
				value: truncateText(data.releaseNotes, 200),
				inline: false
			});
		}
	}

	const payload: NotificationPayload = {
		eventType: 'update_available',
		title: 'Update Available',
		message: data
			? `A new version of Comradarr is available: v${data.newVersion}`
			: 'A new version of Comradarr is available',
		color: getEventColor('update_available'),
		timestamp: new Date(),
		eventData: { individualCount: entries.length }
	};

	// Only add fields if we have any (exactOptionalPropertyTypes compatibility)
	if (fields.length > 0) {
		payload.fields = fields;
	}

	// Only add url if provided
	if (data?.releaseUrl) {
		payload.url = data.releaseUrl;
	}

	return payload;
}

// =============================================================================
// Main Builder Function
// =============================================================================

/**
 * Build an aggregate notification payload from multiple history entries.
 *
 * Groups events of the same type and creates a digest notification with
 * summarized information.
 *
 * @param eventType - The type of events to aggregate
 * @param entries - Notification history entries to combine
 * @returns Aggregated notification payload
 *
 * @example
 * ```typescript
 * const entries = await getPendingNotificationsForBatching(channelId, 'search_success', 60);
 * const payload = buildAggregatePayload('search_success', entries);
 * // payload.title = "5 Items Found"
 * // payload.message = "5 items found and grabbed: Title1, Title2, ..."
 * ```
 */
export function buildAggregatePayload(
	eventType: NotificationEventType,
	entries: NotificationHistory[]
): NotificationPayload {
	// Handle empty entries - shouldn't happen, but be defensive
	if (entries.length === 0) {
		return {
			eventType,
			title: 'No Events',
			message: 'No events to aggregate',
			color: getEventColor(eventType),
			timestamp: new Date()
		};
	}

	// For single entry, still use aggregator for consistent format
	switch (eventType) {
		case 'search_success':
			return aggregateSearchSuccess(entries);
		case 'search_exhausted':
			return aggregateSearchExhausted(entries);
		case 'sweep_started':
			return aggregateSweepStarted(entries);
		case 'sweep_completed':
			return aggregateSweepCompleted(entries);
		case 'sync_completed':
			return aggregateSyncCompleted(entries);
		case 'sync_failed':
			return aggregateSyncFailed(entries);
		case 'connector_health_changed':
			return aggregateConnectorHealthChanged(entries);
		case 'app_started':
			return aggregateAppStarted(entries);
		case 'update_available':
			return aggregateUpdateAvailable(entries);
		default: {
			// TypeScript exhaustiveness check
			const _exhaustiveCheck: never = eventType;
			throw new Error(`Unknown event type: ${_exhaustiveCheck}`);
		}
	}
}

// =============================================================================
// Types
// =============================================================================

/**
 * Result metadata included in aggregated payloads.
 */
export interface AggregatedPayloadMetadata {
	individualCount: number;
	[key: string]: unknown;
}
