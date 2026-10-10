import { promises as dnsPromises, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { pipeline, type Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

/**
 * Server-side GET for URLs that came from outside: a church website Google
 * Places reports, a link found on that site. None of them may reach anything but
 * the public internet - not loopback, not the VPC, not the cloud metadata
 * endpoint at 169.254.169.254.
 *
 * `fetch` cannot enforce that. It follows redirects on its own and resolves
 * hostnames after any check we could make, so a public name can redirect to, or
 * re-resolve to, a private address. This module therefore makes every hop
 * itself, with node:http:
 *
 *   - the URL is checked before each hop (scheme, credentials, port, IP-literal
 *     hosts, localhost names), redirects included, up to a small hop cap;
 *   - the hostname is resolved inside the socket's own `lookup`, every address
 *     is checked there, and the connection goes to the address that was
 *     checked - so a DNS answer that changes between check and connect (DNS
 *     rebinding) has nothing to change.
 *
 * Deliberately free of `server-only` and path aliases so the logic suite can
 * load it directly (`tests/safe-fetch.test.mjs`).
 */

/** Thrown when a URL, a redirect, or a resolved address falls outside the policy. */
export class OutboundUrlRefusedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OutboundUrlRefusedError";
	}
}

export interface OutboundPolicy {
	/** Whether a resolved (or literal) IP address may be connected to. */
	isAllowedAddress(address: string): boolean;
	/** Effective ports allowed; a URL without a port uses its scheme's default. */
	allowedPorts: readonly number[];
	resolve(hostname: string): Promise<LookupAddress[]>;
}

/** The public web on its standard ports. The only policy production code uses. */
export const PUBLIC_WEB_POLICY: OutboundPolicy = {
	isAllowedAddress: isPublicAddress,
	allowedPorts: [80, 443],
	resolve: (hostname) => dnsPromises.lookup(hostname, { all: true }),
};

export interface SafeFetchOptions {
	headers?: Record<string, string>;
	/** One deadline for the whole request: every hop and the body together. */
	timeoutMs: number;
	/** Decoded body bytes kept; the rest is never read. */
	maxBytes: number;
	maxRedirects?: number;
	/** Checked before the body is read; a refusal leaves `body` null. */
	acceptContentType?: (contentType: string) => boolean;
	/** Tests only. Production callers always get `PUBLIC_WEB_POLICY`. */
	policy?: OutboundPolicy;
}

export interface SafeFetchResponse {
	/** The URL the body came from, after redirects. */
	url: string;
	status: number;
	ok: boolean;
	contentType: string;
	/** Null unless the status was 2xx and the content type was accepted. */
	body: Uint8Array | null;
	/** True when the body was cut at `maxBytes`. */
	truncated: boolean;
}

/** Enough for http -> https -> www -> a landing path, with room to spare. */
export const DEFAULT_MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Hostnames that never name a public site. Only a fast path: the address check
 * on every resolved IP is what actually keeps requests on the public internet.
 */
const LOCAL_NAME_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".home.arpa"];

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

function parseIPv4(text: string): number[] | null {
	if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return null;
	const octets = text.split(".").map(Number);
	return octets.every((octet) => octet <= 255) ? octets : null;
}

/** Eight 16-bit groups, or null. Accepts `::`, an IPv4 tail and a zone id. */
function parseIPv6(input: string): number[] | null {
	let text = input.toLowerCase();
	const zone = text.indexOf("%");
	if (zone >= 0) text = text.slice(0, zone);
	if (!text.includes(":")) return null;

	const tail: number[] = [];
	const lastColon = text.lastIndexOf(":");
	if (text.slice(lastColon + 1).includes(".")) {
		const v4 = parseIPv4(text.slice(lastColon + 1));
		if (!v4) return null;
		tail.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
		const head = text.slice(0, lastColon + 1);
		text = head.endsWith("::") ? head : head.slice(0, -1);
	}

	const expected = 8 - tail.length;
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const toGroups = (part: string): string[] => (part ? part.split(":") : []);
	const left = toGroups(halves[0]);
	const right = halves.length === 2 ? toGroups(halves[1]) : [];
	if (![...left, ...right].every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;

	const missing = expected - left.length - right.length;
	if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

	return [
		...left.map((group) => Number.parseInt(group, 16)),
		...new Array<number>(halves.length === 2 ? missing : 0).fill(0),
		...right.map((group) => Number.parseInt(group, 16)),
		...tail,
	];
}

function isPublicIPv4([a, b, c]: number[]): boolean {
	if (a === 0 || a === 10 || a === 127) return false; // "this network", private, loopback
	if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
	if (a === 169 && b === 254) return false; // link-local, incl. 169.254.169.254 metadata
	if (a === 172 && b >= 16 && b <= 31) return false; // private 172.16/12
	if (a === 192 && b === 168) return false; // private 192.168/16
	if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // IETF 192.0.0/24, TEST-NET-1
	if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay anycast
	if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking 198.18/15
	if (a === 198 && b === 51 && c === 100) return false; // TEST-NET-2
	if (a === 203 && b === 0 && c === 113) return false; // TEST-NET-3
	if (a >= 224) return false; // multicast 224/4, reserved 240/4, broadcast
	return true;
}

function isPublicIPv6(groups: number[]): boolean {
	const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
	const upperZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
	// ::ffff:a.b.c.d reaches the IPv4 address it wraps, so it is judged as one.
	if (upperZero && g5 === 0xffff) return isPublicIPv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);

	// Global unicast is 2000::/3. Everything outside it (::, ::1, IPv4-compatible
	// ::/96, 64:ff9b:: NAT64, fc00::/7 unique-local, fe80::/10 link-local,
	// ff00::/8 multicast, discard and the rest) is refused.
	if ((g0 & 0xe000) !== 0x2000) return false;
	if (g0 === 0x2001 && g1 < 0x0200) return false; // IETF protocol assignments, incl. Teredo
	if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
	if (g0 === 0x2002) return false; // 6to4, which can wrap any IPv4 address
	if (g0 === 0x3fff && g1 < 0x1000) return false; // documentation 3fff::/20
	return true;
}

/** Whether an IP address (v4 or v6, as text) is a routable public address. */
export function isPublicAddress(address: string): boolean {
	const v4 = parseIPv4(address);
	if (v4) return isPublicIPv4(v4);
	const v6 = parseIPv6(address);
	return v6 ? isPublicIPv6(v6) : false;
}

// ---------------------------------------------------------------------------
// URL policy
// ---------------------------------------------------------------------------

function effectivePort(url: URL): number {
	if (url.port) return Number(url.port);
	return url.protocol === "https:" ? 443 : 80;
}

/** URL.hostname keeps IPv6 brackets and any trailing root dot; sockets want neither. */
function socketHost(url: URL): string {
	return url.hostname.replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "");
}

/** Why `url` may not be fetched under `policy`, or null when it may. */
function refusalReason(url: URL, policy: OutboundPolicy): string | null {
	if (url.protocol !== "http:" && url.protocol !== "https:") return "only http and https are fetched";
	if (url.username || url.password) return "URLs with credentials are not fetched";
	if (!policy.allowedPorts.includes(effectivePort(url))) return `port ${effectivePort(url)} is not allowed`;

	const host = socketHost(url).toLowerCase();
	if (!host) return "the URL has no host";
	if (parseIPv4(host) || parseIPv6(host)) {
		return policy.isAllowedAddress(host) ? null : `${host} is not a public address`;
	}
	if (!host.includes(".")) return `${host} is not a public hostname`;
	if (host === "localhost" || LOCAL_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
		return `${host} is not a public hostname`;
	}
	return null;
}

/**
 * The static half of the policy: everything that can be judged from the URL
 * alone. Passing it does not make a URL safe to fetch (its hostname may still
 * resolve to a private address), only `safeFetch` decides that.
 */
export function isOutboundUrlAllowed(raw: string, policy: OutboundPolicy = PUBLIC_WEB_POLICY): boolean {
	try {
		return refusalReason(new URL(raw), policy) === null;
	} catch {
		return false;
	}
}

/**
 * A `lookup` for the socket that resolves through the policy and refuses the
 * whole hostname if any address it returns is not allowed. Refusing on any,
 * rather than filtering, keeps a name that mixes public and private records from
 * being steered at the private one.
 */
export function createGuardedLookup(policy: OutboundPolicy): LookupFunction {
	return (hostname, options, callback) => {
		policy
			.resolve(hostname)
			.then((addresses) => {
				if (addresses.length === 0) throw new OutboundUrlRefusedError(`${hostname} did not resolve`);
				const refused = addresses.find((entry) => !policy.isAllowedAddress(entry.address));
				if (refused) throw new OutboundUrlRefusedError(`${hostname} resolves to a non-public address`);

				const family = options.family === 4 || options.family === 6 ? options.family : 0;
				const usable = family ? addresses.filter((entry) => entry.family === family) : addresses;
				if (usable.length === 0) throw new OutboundUrlRefusedError(`${hostname} has no IPv${family} address`);

				if (options.all) callback(null, usable);
				else callback(null, usable[0].address, usable[0].family);
			})
			.catch((error: unknown) => {
				callback(error instanceof Error ? error : new Error(String(error)), "", 0);
			});
	};
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function requestOnce(
	url: URL,
	headers: Record<string, string>,
	policy: OutboundPolicy,
	signal: AbortSignal
): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const transport = url.protocol === "https:" ? https : http;
		const request = transport.request(
			{
				protocol: url.protocol,
				hostname: socketHost(url),
				port: effectivePort(url),
				path: `${url.pathname}${url.search}`,
				method: "GET",
				headers,
				// No pooling: every connection goes through the guarded lookup.
				agent: false,
				lookup: createGuardedLookup(policy),
				signal,
			},
			resolve
		);
		request.on("error", reject);
		request.end();
	});
}

/** The response body as a decoded stream, or null for an encoding we do not speak. */
function decodedBody(response: IncomingMessage): Readable | null {
	const encoding = (response.headers["content-encoding"] ?? "identity").trim().toLowerCase();
	const ignoreClose = () => undefined;
	if (encoding === "identity" || encoding === "") return response;
	if (encoding === "gzip" || encoding === "x-gzip") return pipeline(response, createGunzip(), ignoreClose);
	if (encoding === "deflate") return pipeline(response, createInflate(), ignoreClose);
	if (encoding === "br") return pipeline(response, createBrotliDecompress(), ignoreClose);
	return null;
}

async function readCapped(stream: Readable, maxBytes: number): Promise<{ body: Uint8Array; truncated: boolean }> {
	const chunks: Uint8Array[] = [];
	let total = 0;
	let truncated = false;
	for await (const chunk of stream) {
		const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(String(chunk));
		const room = maxBytes - total;
		if (bytes.byteLength >= room) {
			chunks.push(bytes.subarray(0, room));
			total += room;
			truncated = bytes.byteLength > room;
			break;
		}
		chunks.push(bytes);
		total += bytes.byteLength;
	}

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { body, truncated };
}

/**
 * GET a URL from outside under `PUBLIC_WEB_POLICY`. Throws
 * `OutboundUrlRefusedError` when the URL, any redirect, or any resolved address
 * breaks the policy, and ordinary errors for network failures and timeouts.
 * A non-2xx answer is returned, not thrown.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResponse> {
	const policy = options.policy ?? PUBLIC_WEB_POLICY;
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	const signal = AbortSignal.timeout(options.timeoutMs);
	const headers = { "Accept-Encoding": "gzip, deflate, br", ...options.headers };

	let url = new URL(rawUrl);
	for (let hop = 0; ; hop++) {
		const refusal = refusalReason(url, policy);
		if (refusal) throw new OutboundUrlRefusedError(`Refused ${url.origin}: ${refusal}`);

		const response = await requestOnce(url, headers, policy, signal);
		const status = response.statusCode ?? 0;
		const location = response.headers.location;

		if (REDIRECT_STATUSES.has(status) && location) {
			response.destroy();
			if (hop >= maxRedirects) throw new OutboundUrlRefusedError(`More than ${maxRedirects} redirects`);
			url = new URL(location, url);
			continue;
		}

		const contentType = response.headers["content-type"] ?? "";
		const ok = status >= 200 && status < 300;
		const result = { url: url.toString(), status, ok, contentType };
		if (!ok || (options.acceptContentType && !options.acceptContentType(contentType))) {
			response.destroy();
			return { ...result, body: null, truncated: false };
		}

		const stream = decodedBody(response);
		if (!stream) {
			response.destroy();
			throw new Error(`Unsupported content encoding: ${response.headers["content-encoding"]}`);
		}
		try {
			return { ...result, ...(await readCapped(stream, options.maxBytes)) };
		} finally {
			stream.destroy();
			response.destroy();
		}
	}
}
