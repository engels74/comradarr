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
