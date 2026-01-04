/**
 * Property-based tests for quality model serialization round trip.
 *
 * Validates requirements:
 * - 14.4: Serialize QualityModel structure including quality name, source, resolution, and revision
 * - 14.5: Deserialize and reconstruct QualityModel structure accurately from stored data
 */

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	deserializeQuality,
	type QualityModel,
	serializeQuality
} from '../../src/lib/utils/quality';

/**
 * Arbitrary generator for QualityModel objects.
 * Generates valid quality models matching the *arr API structure.
 */
const qualityModelArbitrary: fc.Arbitrary<QualityModel> = fc.record({
	quality: fc.record({
		id: fc.integer({ min: 0, max: 100 }),
		name: fc.string({ minLength: 1, maxLength: 50 }),
		source: fc.string({ minLength: 1, maxLength: 50 }),
		resolution: fc.constantFrom(480, 576, 720, 1080, 2160)
	}),
	revision: fc.record({
		version: fc.integer({ min: 0, max: 100 }),
		real: fc.integer({ min: 0, max: 10 }),
		isRepack: fc.boolean()
	})
});

describe('Quality Model Serialization', () => {
	describe('Property: Round Trip Preservation', () => {
		it('should preserve all fields through serialize/deserialize round trip', () => {
			fc.assert(
				fc.property(qualityModelArbitrary, (qualityModel) => {
					const serialized = serializeQuality(qualityModel);
					const deserialized = deserializeQuality(serialized);

					// Verify all fields are preserved exactly
					expect(deserialized).toEqual(qualityModel);
				}),
				{ numRuns: 100 }
			);
		});

		it('should produce valid JSON when serializing', () => {
			fc.assert(
				fc.property(qualityModelArbitrary, (qualityModel) => {
					const serialized = serializeQuality(qualityModel);

					// Should be valid JSON that can be parsed
					expect(() => JSON.parse(serialized)).not.toThrow();
				}),
				{ numRuns: 100 }
			);
		});

		it('should be idempotent: serialize(deserialize(serialize(x))) === serialize(x)', () => {
			fc.assert(
				fc.property(qualityModelArbitrary, (qualityModel) => {
					const serialized1 = serializeQuality(qualityModel);
					const deserialized = deserializeQuality(serialized1);
					const serialized2 = serializeQuality(deserialized);

					expect(serialized2).toBe(serialized1);
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Type Preservation', () => {
		it('should preserve number types for id, resolution, version, real', () => {
			fc.assert(
				fc.property(qualityModelArbitrary, (qualityModel) => {
					const serialized = serializeQuality(qualityModel);
					const deserialized = deserializeQuality(serialized);

					expect(typeof deserialized.quality.id).toBe('number');
					expect(typeof deserialized.quality.resolution).toBe('number');
					expect(typeof deserialized.revision.version).toBe('number');
					expect(typeof deserialized.revision.real).toBe('number');
				}),
				{ numRuns: 100 }
			);
		});

		it('should preserve string types for name and source', () => {
			fc.assert(
				fc.property(qualityModelArbitrary, (qualityModel) => {
					const serialized = serializeQuality(qualityModel);
					const deserialized = deserializeQuality(serialized);

					expect(typeof deserialized.quality.name).toBe('string');
					expect(typeof deserialized.quality.source).toBe('string');
				}),
				{ numRuns: 100 }
			);
		});

		it('should preserve boolean type for isRepack', () => {
			fc.assert(
				fc.property(qualityModelArbitrary, (qualityModel) => {
					const serialized = serializeQuality(qualityModel);
					const deserialized = deserializeQuality(serialized);

					expect(typeof deserialized.revision.isRepack).toBe('boolean');
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Property: Structure Preservation', () => {
		it('should preserve nested object structure', () => {
			fc.assert(
				fc.property(qualityModelArbitrary, (qualityModel) => {
					const serialized = serializeQuality(qualityModel);
					const deserialized = deserializeQuality(serialized);

					// Verify structure exists
					expect(deserialized).toHaveProperty('quality');
					expect(deserialized).toHaveProperty('revision');
					expect(deserialized.quality).toHaveProperty('id');
					expect(deserialized.quality).toHaveProperty('name');
					expect(deserialized.quality).toHaveProperty('source');
					expect(deserialized.quality).toHaveProperty('resolution');
					expect(deserialized.revision).toHaveProperty('version');
					expect(deserialized.revision).toHaveProperty('real');
					expect(deserialized.revision).toHaveProperty('isRepack');
				}),
				{ numRuns: 100 }
			);
		});
	});

	describe('Edge Cases', () => {
		it('should handle quality names with special characters', () => {
			// Test with specific special character patterns that JSON must handle
			const specialNames = [
				'HDTV-1080p',
				'Bluray "Director\'s Cut"',
				'WEB-DL\tTabbed',
				'New\nLine',
				'Backslash\\Test',
				'Unicode: \u00e9\u00e8\u00ea',
				'Emoji: \ud83c\udf89',
				'<script>test</script>',
				'{"nested": true}'
			];

			for (const name of specialNames) {
				const qualityModel: QualityModel = {
					quality: {
						id: 1,
						name,
						source: 'webdl',
						resolution: 1080
					},
					revision: {
						version: 1,
						real: 0,
						isRepack: false
					}
				};

				const serialized = serializeQuality(qualityModel);
				const deserialized = deserializeQuality(serialized);
				expect(deserialized).toEqual(qualityModel);
			}
		});

		it('should handle extreme numeric values within valid ranges', () => {
			const extremeArbitrary: fc.Arbitrary<QualityModel> = fc.record({
				quality: fc.record({
					id: fc.constantFrom(0, Number.MAX_SAFE_INTEGER),
					name: fc.string({ minLength: 1, maxLength: 50 }),
					source: fc.string({ minLength: 1, maxLength: 50 }),
					resolution: fc.constantFrom(0, 4320, 8640)
				}),
				revision: fc.record({
					version: fc.constantFrom(0, Number.MAX_SAFE_INTEGER),
					real: fc.constantFrom(0, Number.MAX_SAFE_INTEGER),
					isRepack: fc.boolean()
				})
			});

			fc.assert(
				fc.property(extremeArbitrary, (qualityModel) => {
					const serialized = serializeQuality(qualityModel);
					const deserialized = deserializeQuality(serialized);
					expect(deserialized).toEqual(qualityModel);
				}),
				{ numRuns: 100 }
			);
		});
	});
});
