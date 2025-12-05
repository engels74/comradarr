/**
 * Network utilities for local network bypass authentication.
 *
 * Requirements: 10.3
 *
 * Provides RFC1918 private address detection for local network bypass mode.
 */

/**
 * Check if IP is a private/local network address (RFC1918).
 *
 * Covers:
 * - 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
 * - 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
 * - 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
 * - 127.0.0.0/8 (localhost)
 * - ::1 (IPv6 localhost)
 *
 * @param ip - IP address to check (IPv4 or IPv6)
 * @returns true if the IP is a local/private network address
 */
export function isLocalNetworkIP(ip: string | null): boolean {
	if (!ip) return false;

	// Normalize the IP (remove port if present, trim whitespace)
	const normalizedIP = ip.trim().split(':').slice(0, -1).length > 1 ? ip.trim() : ip.trim().split(':')[0]!;

	// IPv6 localhost
	if (normalizedIP === '::1') return true;

	// Handle IPv4-mapped IPv6 addresses (::ffff:192.168.1.1)
	const ipv4Match = normalizedIP.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
	const ipv4Address = ipv4Match ? ipv4Match[1]! : normalizedIP;

	// Parse IPv4 address
	const parts = ipv4Address.split('.');
	if (parts.length !== 4) return false;

	const octets = parts.map((p) => Number.parseInt(p, 10));

	// Validate octets
	if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;

	const [first, second] = octets;

	// 127.0.0.0/8 - Localhost
	if (first === 127) return true;

	// 10.0.0.0/8
	if (first === 10) return true;

	// 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
	if (first === 172 && second !== undefined && second >= 16 && second <= 31) return true;

	// 192.168.0.0/16
	if (first === 192 && second === 168) return true;

	return false;
}

/**
 * Extract client IP from request.
 *
 * Checks headers in order:
 * 1. X-Forwarded-For (first IP in chain)
 * 2. X-Real-IP
 * 3. getClientAddress() callback (SvelteKit's connection IP)
 *
 * @param request - The HTTP request
 * @param getClientAddress - Optional callback to get connection IP
 * @returns Client IP address or null if not determinable
 */
export function getClientIP(request: Request, getClientAddress?: () => string): string | null {
	// Try X-Forwarded-For header first (may contain chain of IPs)
	const forwardedFor = request.headers.get('x-forwarded-for');
	if (forwardedFor) {
		// Get the first IP in the chain (original client)
		const firstIP = forwardedFor.split(',')[0]?.trim();
		if (firstIP) return firstIP;
	}

	// Try X-Real-IP header
	const realIP = request.headers.get('x-real-ip');
	if (realIP) {
		return realIP.trim();
	}

	// Fall back to SvelteKit's getClientAddress
	if (getClientAddress) {
		try {
			return getClientAddress();
		} catch {
			// getClientAddress may throw if not available
			return null;
		}
	}

	return null;
}
