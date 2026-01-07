import type { ConnectorType, SystemStatus } from './types.js';

const DETECTION_TIMEOUT = 5000;
const API_VERSION = 'v3';
const USER_AGENT = 'Comradarr/1.0';

const APP_NAME_MAP: Record<string, ConnectorType> = {
	radarr: 'radarr',
	sonarr: 'sonarr',
	whisparr: 'whisparr'
};

export type DetectionResult =
	| {
			success: true;
			type: ConnectorType;
			appName: string;
			version: string;
	  }
	| {
			success: false;
			error: string;
	  };

export async function detectConnectorType(
	baseUrl: string,
	apiKey: string
): Promise<DetectionResult> {
	// Normalize URL by removing trailing slashes
	const normalizedUrl = baseUrl.replace(/\/+$/, '');
	const url = `${normalizedUrl}/api/${API_VERSION}/system/status`;

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				'X-Api-Key': apiKey,
				'Content-Type': 'application/json',
				'User-Agent': USER_AGENT,
				Accept: 'application/json'
			},
			signal: AbortSignal.timeout(DETECTION_TIMEOUT)
		});

		if (!response.ok) {
			return handleErrorResponse(response);
		}

		const status = (await response.json()) as SystemStatus;

		// Validate appName exists
		if (!status.appName) {
			return {
				success: false,
				error: 'Invalid response: missing application name'
			};
		}

		// Map appName to connector type (case-insensitive)
		const appNameLower = status.appName.toLowerCase();
		const connectorType = APP_NAME_MAP[appNameLower];

		if (!connectorType) {
			return {
				success: false,
				error: `Unknown application type: ${status.appName}. Supported types: Sonarr, Radarr, Whisparr`
			};
		}

		return {
			success: true,
			type: connectorType,
			appName: status.appName,
			version: status.version
		};
	} catch (error) {
		return categorizeError(error);
	}
}

function handleErrorResponse(response: Response): DetectionResult {
	switch (response.status) {
		case 401:
			return {
				success: false,
				error: 'Invalid API key. Check your API key in the *arr application settings.'
			};
		case 404:
			return {
				success: false,
				error: 'Could not find system status endpoint. Check the URL is correct.'
			};
		default:
			return {
				success: false,
				error: `Server returned error ${response.status}: ${response.statusText || 'Unknown error'}`
			};
	}
}

function categorizeError(error: unknown): DetectionResult {
	// Timeout error
	if (error instanceof DOMException && error.name === 'AbortError') {
		return {
			success: false,
			error: 'Connection timed out. The server may be slow or unreachable.'
		};
	}

	// Also handle TimeoutError from AbortSignal.timeout
	if (error instanceof Error && error.name === 'TimeoutError') {
		return {
			success: false,
			error: 'Connection timed out. The server may be slow or unreachable.'
		};
	}

	// Network errors (TypeError from fetch)
	if (error instanceof TypeError) {
		const message = error.message.toLowerCase();

		// SSL certificate errors
		if (
			message.includes('ssl') ||
			message.includes('certificate') ||
			message.includes('cert_') ||
			message.includes('self signed') ||
			message.includes('self-signed')
		) {
			return {
				success: false,
				error: 'SSL certificate error. Check your SSL configuration.'
			};
		}

		// Connection refused
		if (message.includes('fetch failed') || message.includes('econnrefused')) {
			return {
				success: false,
				error: 'Connection refused. Check the URL and ensure the application is running.'
			};
		}

		// DNS failure
		if (
			message.includes('getaddrinfo') ||
			message.includes('dns') ||
			message.includes('enotfound')
		) {
			return {
				success: false,
				error: 'Could not resolve hostname. Check the URL is correct.'
			};
		}
	}

	// Generic error fallback
	if (error instanceof Error) {
		return {
			success: false,
			error: `Connection failed: ${error.message}`
		};
	}

	return {
		success: false,
		error: 'An unexpected error occurred while detecting connector type.'
	};
}
