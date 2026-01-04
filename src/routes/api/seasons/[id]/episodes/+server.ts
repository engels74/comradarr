/**
 * API endpoint for fetching episodes of a specific season.
 * Used for lazy loading episodes on the series detail page.
 *

 */

import { error, json } from '@sveltejs/kit';
import { requireScope } from '$lib/server/auth';
import { getSeasonEpisodes } from '$lib/server/db/queries/content';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	// Require read scope for read operations (Requirement 34.2)
	requireScope(locals, 'read');

	const seasonId = Number(params.id);

	if (Number.isNaN(seasonId) || seasonId <= 0) {
		error(400, 'Invalid season ID');
	}

	const episodes = await getSeasonEpisodes(seasonId);

	return json({ episodes });
};
