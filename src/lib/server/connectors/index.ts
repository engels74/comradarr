export { type DetectionResult, detectConnectorType } from './common/detect.js';
export {
	ArrClientError,
	AuthenticationError,
	isArrClientError,
	NetworkError,
	NotFoundError,
	RateLimitError,
	ServerError,
	SSLError,
	TimeoutError
} from './common/errors.js';
export type { CommandResponse } from './common/types.js';
export { createConnectorClient } from './factory.js';
export { RadarrClient } from './radarr/client.js';
export type { RadarrMovie } from './radarr/types.js';
export { SonarrClient } from './sonarr/client.js';
export type { SonarrEpisode, SonarrSeason, SonarrSeries } from './sonarr/types.js';
export { WhisparrClient } from './whisparr/client.js';
export type { WhisparrEpisode, WhisparrSeries } from './whisparr/types.js';
