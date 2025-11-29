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

/**
 * Serializes a QualityModel to JSON string for database storage.
 * Used when storing quality data in episodes.quality and movies.quality jsonb columns.
 *
 * @param quality - The QualityModel object to serialize
 * @returns JSON string representation of the quality model
 */
export function serializeQuality(quality: QualityModel): string {
	return JSON.stringify(quality);
}

/**
 * Deserializes a JSON string back to a QualityModel object.
 * Used when reading quality data from episodes.quality and movies.quality jsonb columns.
 *
 * @param json - JSON string from database
 * @returns Reconstructed QualityModel object
 */
export function deserializeQuality(json: string): QualityModel {
	return JSON.parse(json) as QualityModel;
}
