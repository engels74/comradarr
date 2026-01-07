import type { NotificationEventType } from '$lib/server/db/queries/notifications';
import { getEventColor } from './base-channel';
import type { NotificationField, NotificationPayload } from './types';

export interface SweepStartedData {
	connectorId: number;
	connectorName: string;
	sweepType: 'gap' | 'upgrade' | 'both';
}

export interface SweepCompletedData {
	connectorId: number;
	connectorName: string;
	gapsFound: number;
	upgradesFound?: number;
	itemsQueued: number;
	duration?: number;
}

export interface SearchSuccessData {
	contentTitle: string;
	contentYear?: number;
	quality: string;
	connectorName: string;
	contentType?: 'episode' | 'movie';
	seasonNumber?: number;
	episodeNumber?: number;
}

export interface SearchExhaustedData {
	contentTitle: string;
	contentYear?: number;
	attempts: number;
	connectorName: string;
	contentType?: 'episode' | 'movie';
	seasonNumber?: number;
	episodeNumber?: number;
}

export interface ConnectorHealthChangedData {
	connectorId: number;
	connectorName: string;
	connectorType: string;
	oldStatus: string;
	newStatus: string;
	errorMessage?: string;
}

export interface SyncCompletedData {
	connectorId: number;
	connectorName: string;
	itemsProcessed: number;
	itemsCreated?: number;
	itemsUpdated?: number;
	itemsDeleted?: number;
	duration?: number;
}

export interface SyncFailedData {
	connectorId: number;
	connectorName: string;
	error: string;
	consecutiveFailures?: number;
}

export interface AppStartedData {
	version?: string;
	environment?: string;
}

export interface UpdateAvailableData {
	currentVersion: string;
	newVersion: string;
	releaseUrl?: string;
	releaseNotes?: string;
}

export interface EventDataMap {
	sweep_started: SweepStartedData;
	sweep_completed: SweepCompletedData;
	search_success: SearchSuccessData;
	search_exhausted: SearchExhaustedData;
	connector_health_changed: ConnectorHealthChangedData;
	sync_completed: SyncCompletedData;
	sync_failed: SyncFailedData;
	app_started: AppStartedData;
	update_available: UpdateAvailableData;
}

function buildSweepStartedPayload(data: SweepStartedData): NotificationPayload {
	const sweepTypeLabel =
		data.sweepType === 'both'
			? 'Gaps & Upgrades'
			: data.sweepType === 'gap'
				? 'Content Gaps'
				: 'Quality Upgrades';

	return {
		eventType: 'sweep_started',
		title: 'Sweep Started',
		message: `Starting ${sweepTypeLabel.toLowerCase()} sweep on ${data.connectorName}`,
		fields: [
			{ name: 'Connector', value: data.connectorName, inline: true },
			{ name: 'Sweep Type', value: sweepTypeLabel, inline: true }
		],
		color: getEventColor('sweep_started'),
		timestamp: new Date()
	};
}

function buildSweepCompletedPayload(data: SweepCompletedData): NotificationPayload {
	const fields: NotificationField[] = [
		{ name: 'Connector', value: data.connectorName, inline: true },
		{ name: 'Gaps Found', value: String(data.gapsFound), inline: true }
	];

	if (data.upgradesFound !== undefined) {
		fields.push({ name: 'Upgrades Found', value: String(data.upgradesFound), inline: true });
	}

	fields.push({ name: 'Items Queued', value: String(data.itemsQueued), inline: true });

	if (data.duration !== undefined) {
		fields.push({ name: 'Duration', value: formatDuration(data.duration), inline: true });
	}

	return {
		eventType: 'sweep_completed',
		title: 'Sweep Complete',
		message: `Sweep completed on ${data.connectorName}. Found ${data.gapsFound} gaps and queued ${data.itemsQueued} items.`,
		fields,
		color: getEventColor('sweep_completed'),
		timestamp: new Date()
	};
}

function buildSearchSuccessPayload(data: SearchSuccessData): NotificationPayload {
	let contentDisplay = data.contentTitle;
	if (data.contentYear) {
		contentDisplay += ` (${data.contentYear})`;
	}
	if (
		data.contentType === 'episode' &&
		data.seasonNumber !== undefined &&
		data.episodeNumber !== undefined
	) {
		contentDisplay += ` S${String(data.seasonNumber).padStart(2, '0')}E${String(data.episodeNumber).padStart(2, '0')}`;
	}

	const fields: NotificationField[] = [
		{ name: 'Quality', value: data.quality, inline: true },
		{ name: 'Source', value: data.connectorName, inline: true }
	];

	if (data.contentType) {
		fields.push({
			name: 'Type',
			value: data.contentType === 'episode' ? 'Episode' : 'Movie',
			inline: true
		});
	}

	return {
		eventType: 'search_success',
		title: 'Content Found',
		message: `${contentDisplay} has been found and grabbed!`,
		fields,
		color: getEventColor('search_success'),
		timestamp: new Date()
	};
}

function buildSearchExhaustedPayload(data: SearchExhaustedData): NotificationPayload {
	let contentDisplay = data.contentTitle;
	if (data.contentYear) {
		contentDisplay += ` (${data.contentYear})`;
	}
	if (
		data.contentType === 'episode' &&
		data.seasonNumber !== undefined &&
		data.episodeNumber !== undefined
	) {
		contentDisplay += ` S${String(data.seasonNumber).padStart(2, '0')}E${String(data.episodeNumber).padStart(2, '0')}`;
	}

	const fields: NotificationField[] = [
		{ name: 'Attempts', value: String(data.attempts), inline: true },
		{ name: 'Source', value: data.connectorName, inline: true }
	];

	if (data.contentType) {
		fields.push({
			name: 'Type',
			value: data.contentType === 'episode' ? 'Episode' : 'Movie',
			inline: true
		});
	}

	return {
		eventType: 'search_exhausted',
		title: 'Search Exhausted',
		message: `${contentDisplay} could not be found after ${data.attempts} attempts. Marked as exhausted.`,
		fields,
		color: getEventColor('search_exhausted'),
		timestamp: new Date()
	};
}

function buildConnectorHealthChangedPayload(data: ConnectorHealthChangedData): NotificationPayload {
	const statusEmoji = getHealthStatusEmoji(data.newStatus);
	const isImprovement = isHealthImprovement(data.oldStatus, data.newStatus);

	const fields: NotificationField[] = [
		{ name: 'Connector', value: data.connectorName, inline: true },
		{ name: 'Type', value: capitalizeFirst(data.connectorType), inline: true },
		{ name: 'Previous Status', value: capitalizeFirst(data.oldStatus), inline: true },
		{
			name: 'Current Status',
			value: `${statusEmoji} ${capitalizeFirst(data.newStatus)}`,
			inline: true
		}
	];

	if (data.errorMessage) {
		fields.push({ name: 'Error', value: truncateText(data.errorMessage, 200), inline: false });
	}

	const direction = isImprovement ? 'improved' : 'degraded';

	return {
		eventType: 'connector_health_changed',
		title: `Connector Health ${capitalizeFirst(direction)}`,
		message: `${data.connectorName} health ${direction} from ${data.oldStatus} to ${data.newStatus}`,
		fields,
		color: getEventColor('connector_health_changed'),
		timestamp: new Date()
	};
}

function buildSyncCompletedPayload(data: SyncCompletedData): NotificationPayload {
	const fields: NotificationField[] = [
		{ name: 'Connector', value: data.connectorName, inline: true },
		{ name: 'Items Processed', value: String(data.itemsProcessed), inline: true }
	];

	if (data.itemsCreated !== undefined) {
		fields.push({ name: 'Created', value: String(data.itemsCreated), inline: true });
	}

	if (data.itemsUpdated !== undefined) {
		fields.push({ name: 'Updated', value: String(data.itemsUpdated), inline: true });
	}

	if (data.itemsDeleted !== undefined) {
		fields.push({ name: 'Deleted', value: String(data.itemsDeleted), inline: true });
	}

	if (data.duration !== undefined) {
		fields.push({ name: 'Duration', value: formatDuration(data.duration), inline: true });
	}

	return {
		eventType: 'sync_completed',
		title: 'Sync Complete',
		message: `Library sync completed for ${data.connectorName}. Processed ${data.itemsProcessed} items.`,
		fields,
		color: getEventColor('sync_completed'),
		timestamp: new Date()
	};
}

function buildSyncFailedPayload(data: SyncFailedData): NotificationPayload {
	const fields: NotificationField[] = [
		{ name: 'Connector', value: data.connectorName, inline: true },
		{ name: 'Error', value: truncateText(data.error, 200), inline: false }
	];

	if (data.consecutiveFailures !== undefined && data.consecutiveFailures > 1) {
		fields.push({
			name: 'Consecutive Failures',
			value: String(data.consecutiveFailures),
			inline: true
		});
	}

	return {
		eventType: 'sync_failed',
		title: 'Sync Failed',
		message: `Library sync failed for ${data.connectorName}`,
		fields,
		color: getEventColor('sync_failed'),
		timestamp: new Date()
	};
}

function buildAppStartedPayload(data: AppStartedData): NotificationPayload {
	const fields: NotificationField[] = [];

	if (data.version) {
		fields.push({ name: 'Version', value: data.version, inline: true });
	}

	if (data.environment) {
		fields.push({ name: 'Environment', value: capitalizeFirst(data.environment), inline: true });
	}

	const payload: NotificationPayload = {
		eventType: 'app_started',
		title: 'Comradarr Started',
		message: data.version
			? `Comradarr v${data.version} has started successfully.`
			: 'Comradarr has started successfully.',
		color: getEventColor('app_started'),
		timestamp: new Date()
	};

	// Only include fields if we have any
	if (fields.length > 0) {
		payload.fields = fields;
	}

	return payload;
}

function buildUpdateAvailablePayload(data: UpdateAvailableData): NotificationPayload {
	const fields: NotificationField[] = [
		{ name: 'Current Version', value: data.currentVersion, inline: true },
		{ name: 'New Version', value: data.newVersion, inline: true }
	];

	if (data.releaseNotes) {
		fields.push({
			name: 'Release Notes',
			value: truncateText(data.releaseNotes, 500),
			inline: false
		});
	}

	const payload: NotificationPayload = {
		eventType: 'update_available',
		title: 'Update Available',
		message: `A new version of Comradarr is available: v${data.newVersion}`,
		fields,
		color: getEventColor('update_available'),
		timestamp: new Date()
	};

	// Only include url if provided
	if (data.releaseUrl) {
		payload.url = data.releaseUrl;
	}

	return payload;
}

export function buildPayload<T extends NotificationEventType>(
	eventType: T,
	data: EventDataMap[T]
): NotificationPayload {
	switch (eventType) {
		case 'sweep_started':
			return buildSweepStartedPayload(data as SweepStartedData);
		case 'sweep_completed':
			return buildSweepCompletedPayload(data as SweepCompletedData);
		case 'search_success':
			return buildSearchSuccessPayload(data as SearchSuccessData);
		case 'search_exhausted':
			return buildSearchExhaustedPayload(data as SearchExhaustedData);
		case 'connector_health_changed':
			return buildConnectorHealthChangedPayload(data as ConnectorHealthChangedData);
		case 'sync_completed':
			return buildSyncCompletedPayload(data as SyncCompletedData);
		case 'sync_failed':
			return buildSyncFailedPayload(data as SyncFailedData);
		case 'app_started':
			return buildAppStartedPayload(data as AppStartedData);
		case 'update_available':
			return buildUpdateAvailablePayload(data as UpdateAvailableData);
		default: {
			// TypeScript exhaustiveness check
			const _exhaustiveCheck: never = eventType;
			throw new Error(`Unknown event type: ${_exhaustiveCheck}`);
		}
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	if (minutes < 60) {
		return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function capitalizeFirst(str: string): string {
	if (!str) return str;
	return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength - 3)}...`;
}

function getHealthStatusEmoji(status: string): string {
	switch (status.toLowerCase()) {
		case 'healthy':
			return '🟢';
		case 'degraded':
			return '🟡';
		case 'unhealthy':
			return '🔴';
		case 'offline':
			return '⚫';
		default:
			return '⚪';
	}
}

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
