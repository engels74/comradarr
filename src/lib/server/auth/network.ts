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

/** Extract client IP from X-Forwarded-For, X-Real-IP, or getClientAddress(). */
export function getClientIP(request: Request, getClientAddress?: () => string): string | null {
	const forwardedFor = request.headers.get('x-forwarded-for');
	if (forwardedFor) {
		const firstIP = forwardedFor.split(',')[0]?.trim();
		if (firstIP) return firstIP;
	}

	const realIP = request.headers.get('x-real-ip');
	if (realIP) {
		return realIP.trim();
	}

	if (getClientAddress) {
		try {
			return getClientAddress();
		} catch {
			return null;
		}
	}

	return null;
}
