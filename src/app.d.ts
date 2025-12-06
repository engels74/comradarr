// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			message: string;
			code?: string;
		}
		interface Locals {
			user: {
				id: number;
				username: string;
				displayName: string | null;
				role: string;
			} | null;
			correlationId: string;
			/** Current session ID (if authenticated via session) */
			sessionId?: string;
			/** True when auth is bypassed for local network access (Req 10.3) */
			isLocalBypass?: boolean;
			/** True when authenticated via API key (Req 34.2) */
			isApiKey?: boolean;
			/** API key scope when authenticated via API key (Req 34.2) */
			apiKeyScope?: 'read' | 'full';
			/** API key ID for logging when authenticated via API key (Req 34.4) */
			apiKeyId?: number;
			/** API key rate limit per minute (null = unlimited) (Req 34.5) */
			apiKeyRateLimitPerMinute?: number | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
