/**
 * RFC1918 private address detection for local network bypass.
 * Covers: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, ::1
 */
export function isLocalNetworkIP(ip: string | null): boolean {
	if (!ip) return false;

	const normalizedIP =
		ip.trim().split(':').slice(0, -1).length > 1 ? ip.trim() : ip.trim().split(':')[0]!;

	if (normalizedIP === '::1') return true;

	const ipv4Match = normalizedIP.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
	const ipv4Address = ipv4Match ? ipv4Match[1]! : normalizedIP;

	const parts = ipv4Address.split('.');
	if (parts.length !== 4) return false;

	const octets = parts.map((p) => Number.parseInt(p, 10));
	if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;

	const [first, second] = octets;

	if (first === 127) return true;
	if (first === 10) return true;
	if (first === 172 && second !== undefined && second >= 16 && second <= 31) return true;
	if (first === 192 && second === 168) return true;

	return false;
}

/** Extract client IP from SvelteKit's getClientAddress() (populated by the adapter). */
export function getClientIP(_request: Request, getClientAddress?: () => string): string | null {
	if (getClientAddress) {
		try {
			return getClientAddress();
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * Get the raw TCP socket IP via Bun's requestIP(), bypassing any ADDRESS_HEADER override.
 * Returns null if platform info is unavailable (e.g., during dev/testing).
 */
export function getRawSocketIP(platform: App.Platform | undefined): string | null {
	try {
		if (!platform?.server?.requestIP || !platform?.request) return null;
		return platform.server.requestIP(platform.request)?.address ?? null;
	} catch {
		return null;
	}
}

/**
 * Validate local bypass when ADDRESS_HEADER is configured (reverse proxy scenario).
 * Defense-in-depth: verifies the raw socket IP is from a local/trusted source,
 * preventing remote attackers from spoofing the forwarded header.
 *
 * Returns { allowed: true } if bypass should proceed, or { allowed: false, reason } if denied.
 */
export function validateLocalBypassSource(
	headerIP: string | null,
	platform: App.Platform | undefined
): { allowed: boolean; reason?: string; socketIP?: string | null } {
	const addressHeader = process.env.ADDRESS_HEADER;

	if (!addressHeader) {
		return { allowed: isLocalNetworkIP(headerIP) };
	}

	if (!isLocalNetworkIP(headerIP)) {
		return { allowed: false, reason: 'header_ip_not_local' };
	}

	const socketIP = getRawSocketIP(platform);

	if (!socketIP) {
		return { allowed: false, reason: 'socket_ip_unavailable', socketIP };
	}

	if (!isLocalNetworkIP(socketIP)) {
		return { allowed: false, reason: 'socket_ip_not_local', socketIP };
	}

	return { allowed: true, socketIP };
}
