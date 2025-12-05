/**
 * API endpoint for exporting analytics data as CSV.
 *
 * Query Parameters:
 * - startDate: ISO date string (YYYY-MM-DD) - Start of date range (required)
 * - endDate: ISO date string (YYYY-MM-DD) - End of date range (required)
 *
 * Returns:
 * - CSV file download with analytics data
 *
 * Requirements: 12.4, 20.4
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDailyStatsForExport, type ExportRow } from '$lib/server/db/queries/analytics';

/**
 * CSV column headers.
 */
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

/**
 * Escapes a CSV field value.
 * Wraps in quotes if contains comma, quote, or newline.
 */
function escapeCSVField(value: string | number | null): string {
	if (value === null) {
		return '';
	}

	const stringValue = String(value);

	// Check if escaping is needed
	if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
		// Escape double quotes by doubling them
		return `"${stringValue.replace(/"/g, '""')}"`;
	}

	return stringValue;
}

/**
 * Converts export rows to CSV string.
 */
function toCSV(rows: ExportRow[]): string {
	const lines: string[] = [];

	// Add header row
	lines.push(CSV_HEADERS.join(','));

	// Add data rows
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

/**
 * Validates a date string in YYYY-MM-DD format.
 */
function parseDate(dateString: string | null, paramName: string): Date {
	if (!dateString) {
		error(400, `Missing required parameter: ${paramName}`);
	}

	// Validate format
	const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
	if (!dateRegex.test(dateString)) {
		error(400, `Invalid date format for ${paramName}. Expected YYYY-MM-DD.`);
	}

	const date = new Date(dateString + 'T00:00:00Z');
	if (isNaN(date.getTime())) {
		error(400, `Invalid date value for ${paramName}.`);
	}

	return date;
}

export const GET: RequestHandler = async ({ url }) => {
	// Parse and validate date parameters
	const startDateParam = url.searchParams.get('startDate');
	const endDateParam = url.searchParams.get('endDate');

	const startDate = parseDate(startDateParam, 'startDate');
	const endDate = parseDate(endDateParam, 'endDate');

	// Validate date range
	if (startDate > endDate) {
		error(400, 'startDate must be before or equal to endDate');
	}

	// Limit date range to prevent excessive queries (max 1 year)
	const maxRangeMs = 365 * 24 * 60 * 60 * 1000;
	if (endDate.getTime() - startDate.getTime() > maxRangeMs) {
		error(400, 'Date range cannot exceed 1 year');
	}

	// Set end date to end of day for inclusive query
	const endDateInclusive = new Date(endDate);
	endDateInclusive.setUTCHours(23, 59, 59, 999);

	// Fetch data
	const rows = await getDailyStatsForExport(startDate, endDateInclusive);

	// Generate CSV
	const csv = toCSV(rows);

	// Generate filename
	const filename = `comradarr-analytics-${startDateParam}-to-${endDateParam}.csv`;

	// Return CSV file
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${filename}"`,
			'Cache-Control': 'no-cache'
		}
	});
};
