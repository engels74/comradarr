/**
 * Series detail page server load.
 *
 * Requirement 17.3: Display metadata, quality status per episode,
 * gap and upgrade status, and search history.
 */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	getSeriesDetail,
	getSeriesSeasonsWithEpisodes,
	getSeriesSearchHistory
} from '$lib/server/db/queries/content';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);

	if (isNaN(id)) {
		error(400, 'Invalid series ID');
	}

	const seriesDetail = await getSeriesDetail(id);

	if (!seriesDetail) {
		error(404, 'Series not found');
	}

	// Load seasons/episodes and search history in parallel
	const [seasonsWithEpisodes, searchHistory] = await Promise.all([
		getSeriesSeasonsWithEpisodes(id),
		getSeriesSearchHistory(id, 20)
	]);

	// Compute aggregate stats
	const totalMissing = seasonsWithEpisodes.reduce((sum, s) => sum + s.missingCount, 0);
	const totalUpgrades = seasonsWithEpisodes.reduce((sum, s) => sum + s.upgradeCount, 0);
	const totalEpisodes = seasonsWithEpisodes.reduce((sum, s) => sum + s.episodes.length, 0);
	const downloadedEpisodes = seasonsWithEpisodes.reduce(
		(sum, s) => sum + s.episodes.filter((e) => e.hasFile).length,
		0
	);

	return {
		series: seriesDetail,
		seasons: seasonsWithEpisodes,
		searchHistory,
		stats: {
			totalMissing,
			totalUpgrades,
			totalEpisodes,
			downloadedEpisodes
		}
	};
};
