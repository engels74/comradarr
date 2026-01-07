/**
 * API endpoint for exporting analytics data as CSV.
 *
 * Query Parameters:
 * - startDate: ISO date string (YYYY-MM-DD) - Start of date range (required)
 * - endDate: ISO date string (YYYY-MM-DD) - End of date range (required)
 *
 * Returns:
 * - CSV file download with analytics data
 */

import { error } from '@sveltejs/kit';
import { requireScope } from '$lib/server/auth';
import { type ExportRow, getDailyStatsForExport } from '$lib/server/db/queries/analytics';
import type { RequestHandler } from './$types';

const CSV_HEADERS = [
	'date',
	'connector',
	'connector_type',
	'gaps_discovered',
	'upgrades_discovered',
	'searches_dispatched',
	'searches_successful',
	'searches_failed',
	'searches_no_results',
	'avg_queue_depth',
	'peak_queue_depth',
	'avg_response_time_ms',
	'error_count',
	'success_rate'
] as const;

function escapeCSVField(value: string | number | null): string {
	if (value === null) {
		return '';
	}

	const stringValue = String(value);

	if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
		return `"${stringValue.replace(/"/g, '""')}"`;
	}

	return stringValue;
}

function toCSV(rows: ExportRow[]): string {
	const lines: string[] = [];
	lines.push(CSV_HEADERS.join(','));

	for (const row of rows) {
		const values = [
			escapeCSVField(row.date),
			escapeCSVField(row.connector),
			escapeCSVField(row.connectorType),
			escapeCSVField(row.gapsDiscovered),
			escapeCSVField(row.upgradesDiscovered),
			escapeCSVField(row.searchesDispatched),
			escapeCSVField(row.searchesSuccessful),
			escapeCSVField(row.searchesFailed),
			escapeCSVField(row.searchesNoResults),
			escapeCSVField(row.avgQueueDepth),
			escapeCSVField(row.peakQueueDepth),
			escapeCSVField(row.avgResponseTimeMs),
			escapeCSVField(row.errorCount),
			escapeCSVField(row.successRate)
		];
		lines.push(values.join(','));
	}

	return lines.join('\n');
}

function parseDate(dateString: string | null, paramName: string): Date {
	if (!dateString) {
		error(400, `Missing required parameter: ${paramName}`);
	}

	const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
	if (!dateRegex.test(dateString)) {
		error(400, `Invalid date format for ${paramName}. Expected YYYY-MM-DD.`);
	}

	const date = new Date(`${dateString}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) {
		error(400, `Invalid date value for ${paramName}.`);
	}

	return date;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	requireScope(locals, 'read');

	const startDateParam = url.searchParams.get('startDate');
	const endDateParam = url.searchParams.get('endDate');

	const startDate = parseDate(startDateParam, 'startDate');
	const endDate = parseDate(endDateParam, 'endDate');

	if (startDate > endDate) {
		error(400, 'startDate must be before or equal to endDate');
	}

	// Max 1 year range to prevent excessive queries
	const maxRangeMs = 365 * 24 * 60 * 60 * 1000;
	if (endDate.getTime() - startDate.getTime() > maxRangeMs) {
		error(400, 'Date range cannot exceed 1 year');
	}

	// End of day for inclusive query
	const endDateInclusive = new Date(endDate);
	endDateInclusive.setUTCHours(23, 59, 59, 999);

	const rows = await getDailyStatsForExport(startDate, endDateInclusive);
	const csv = toCSV(rows);
	const filename = `comradarr-analytics-${startDateParam}-to-${endDateParam}.csv`;

	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-cache'
		}
	});
};
