/**
 * Movie detail page server load.
 *
 * Requirement 17.4: Display metadata, current quality,
 * search history, and lastSearchTime.
 */

import { error } from '@sveltejs/kit';
import { getMovieDetail, getMovieSearchHistory } from '$lib/server/db/queries/content';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);

	if (Number.isNaN(id)) {
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
