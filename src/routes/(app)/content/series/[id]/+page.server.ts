import { error } from '@sveltejs/kit';
import {
	getSeasonSummaries,
	getSeriesDetail,
	getSeriesSearchHistory
} from '$lib/server/db/queries/content';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);

	if (Number.isNaN(id)) {
		error(400, 'Invalid series ID');
	}

	const seriesDetail = await getSeriesDetail(id);

	if (!seriesDetail) {
		error(404, 'Series not found');
	}

	const [seasonSummaries, searchHistory] = await Promise.all([
		getSeasonSummaries(id),
		getSeriesSearchHistory(id, 20)
	]);

	const totalMissing = seasonSummaries.reduce((sum, s) => sum + s.missingCount, 0);
	const totalUpgrades = seasonSummaries.reduce((sum, s) => sum + s.upgradeCount, 0);
	const totalEpisodes = seasonSummaries.reduce((sum, s) => sum + s.totalEpisodes, 0);
	const downloadedEpisodes = seasonSummaries.reduce((sum, s) => sum + s.downloadedEpisodes, 0);

	return {
		series: seriesDetail,
		seasons: seasonSummaries,
		searchHistory,
		stats: {
			totalMissing,
			totalUpgrades,
			totalEpisodes,
			downloadedEpisodes
		}
	};
};
