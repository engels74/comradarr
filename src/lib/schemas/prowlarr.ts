import * as v from 'valibot';

export const ProwlarrInstanceSchema = v.object({
	name: v.pipe(
		v.string('Name is required'),
		v.trim(),
		v.minLength(1, 'Name is required'),
		v.maxLength(100, 'Name must be 100 characters or less')
	),
	url: v.pipe(
		v.string('URL is required'),
		v.trim(),
		v.minLength(1, 'URL is required'),
		v.url('Please enter a valid URL')
	),
	apiKey: v.pipe(v.string('API Key is required'), v.minLength(1, 'API Key is required'))
});

export type ProwlarrInstanceInput = v.InferInput<typeof ProwlarrInstanceSchema>;
export type ProwlarrInstanceOutput = v.InferOutput<typeof ProwlarrInstanceSchema>;

// API key is optional on update - leave blank to keep existing
export const ProwlarrInstanceUpdateSchema = v.object({
	name: v.pipe(
		v.string('Name is required'),
		v.trim(),
		v.minLength(1, 'Name is required'),
		v.maxLength(100, 'Name must be 100 characters or less')
	),
	url: v.pipe(
		v.string('URL is required'),
		v.trim(),
		v.minLength(1, 'URL is required'),
		v.url('Please enter a valid URL')
	),
	apiKey: v.optional(v.pipe(v.string(), v.minLength(1, 'API Key must not be empty if provided'))),
	enabled: v.optional(v.boolean())
});

export type ProwlarrInstanceUpdateInput = v.InferInput<typeof ProwlarrInstanceUpdateSchema>;
export type ProwlarrInstanceUpdateOutput = v.InferOutput<typeof ProwlarrInstanceUpdateSchema>;
