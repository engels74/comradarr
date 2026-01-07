import * as v from 'valibot';

export const connectorTypes = ['sonarr', 'radarr', 'whisparr'] as const;
export type ConnectorType = (typeof connectorTypes)[number];

export const ConnectorSchema = v.object({
	name: v.pipe(
		v.string('Name is required'),
		v.trim(),
		v.minLength(1, 'Name is required'),
		v.maxLength(100, 'Name must be 100 characters or less')
	),
	type: v.pipe(v.string('Type is required'), v.picklist(connectorTypes, 'Invalid connector type')),
	url: v.pipe(
		v.string('URL is required'),
		v.trim(),
		v.minLength(1, 'URL is required'),
		v.url('Please enter a valid URL')
	),
	apiKey: v.pipe(v.string('API Key is required'), v.minLength(1, 'API Key is required'))
});

export type ConnectorInput = v.InferInput<typeof ConnectorSchema>;
export type ConnectorOutput = v.InferOutput<typeof ConnectorSchema>;

// Type is auto-detected from the *arr application when not provided
export const TestConnectionSchema = v.object({
	url: v.pipe(
		v.string('URL is required'),
		v.trim(),
		v.minLength(1, 'URL is required'),
		v.url('Please enter a valid URL')
	),
	apiKey: v.pipe(v.string('API Key is required'), v.minLength(1, 'API Key is required')),
	type: v.optional(v.pipe(v.string(), v.picklist(connectorTypes, 'Invalid connector type')))
});

export type TestConnectionInput = v.InferInput<typeof TestConnectionSchema>;
export type TestConnectionOutput = v.InferOutput<typeof TestConnectionSchema>;

// API key is optional on update - leave blank to keep existing
export const ConnectorUpdateSchema = v.object({
	name: v.pipe(
		v.string('Name is required'),
		v.trim(),
		v.minLength(1, 'Name is required'),
		v.maxLength(100, 'Name must be 100 characters or less')
	),
	type: v.pipe(v.string('Type is required'), v.picklist(connectorTypes, 'Invalid connector type')),
	url: v.pipe(
		v.string('URL is required'),
		v.trim(),
		v.minLength(1, 'URL is required'),
		v.url('Please enter a valid URL')
	),
	apiKey: v.optional(v.pipe(v.string(), v.minLength(1, 'API Key must not be empty if provided'))),
	enabled: v.optional(v.boolean())
});

export type ConnectorUpdateInput = v.InferInput<typeof ConnectorUpdateSchema>;
export type ConnectorUpdateOutput = v.InferOutput<typeof ConnectorUpdateSchema>;
