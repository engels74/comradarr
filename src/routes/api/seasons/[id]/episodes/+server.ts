/**
 * API endpoint for fetching episodes of a specific season.
 * Used for lazy loading episodes on the series detail page.
 *

 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSeasonEpisodes } from '$lib/server/db/queries/content';
import { requireScope } from '$lib/server/auth';

export const GET: RequestHandler = async ({ params, locals }) => {
	// Require read scope for read operations (Requirement 34.2)
	requireScope(locals, 'read');

	const seasonId = Number(params.id);

	if (isNaN(seasonId) || seasonId <= 0) {
		error(400, 'Invalid season ID');
	}

	const episodes = await getSeasonEpisodes(seasonId);

	return json({ episodes });
};
