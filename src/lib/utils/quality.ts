/**
 * Quality model serialization utilities for storing *arr API quality data
 * in PostgreSQL jsonb columns.
 *
 * Matches the QualityModel structure from Sonarr/Radarr/Whisparr APIs.
 */

/**
 * Quality information from *arr API responses.
 * Represents the quality of a media file including codec, resolution, and revision info.
 */
export interface QualityModel {
	quality: {
		id: number;
		name: string;
		source: string;
		resolution: number;
	};
	revision: {
		version: number;
		real: number;
		isRepack: boolean;
	};
}

export function serializeQuality(quality: QualityModel): string {
	return JSON.stringify(quality);
}

export function deserializeQuality(json: string): QualityModel {
	return JSON.parse(json) as QualityModel;
}
