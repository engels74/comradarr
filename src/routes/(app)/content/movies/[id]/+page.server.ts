/**
 * Movie detail page server load.
 *
 * Requirement 17.4: Display metadata, current quality,
 * search history, and lastSearchTime.
 */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getMovieDetail, getMovieSearchHistory } from '$lib/server/db/queries/content';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);

	if (isNaN(id)) {
		error(400, 'Invalid movie ID');
	}

	const movieDetail = await getMovieDetail(id);

	if (!movieDetail) {
		error(404, 'Movie not found');
	}

	// Load search history
	const searchHistory = await getMovieSearchHistory(id, 20);

	return {
		movie: movieDetail,
		searchHistory
	};
};
