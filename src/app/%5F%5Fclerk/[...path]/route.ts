/**
 * Clerk Frontend API proxy, serving `/__clerk/*`.
 *
 * NOTE THE DIRECTORY NAME. This lives in `src/app/%5F%5Fclerk/`, not
 * `src/app/__clerk/`. Next.js treats a folder whose name starts with `_` as a
 * private folder and excludes it from routing entirely, so the literal
 * `__clerk` directory produced a silent 404 rather than a route. `%5F` is the
 * documented escape for a leading underscore in a URL segment; the folder still
 * serves `/__clerk/*`. Renaming it back will take auth down without any error.
 *
 * The production Clerk instance is configured with
 * `proxy_url = https://bible-ai-explorer.vercel.app/__clerk` because the app is
 * served from a *.vercel.app domain, where the CNAME records a normal Clerk
 * production instance needs cannot be created. Clerk therefore expects every
 * Frontend API call to arrive here and be forwarded on.
 *
 * This is a route handler rather than a `next.config` rewrite because Clerk
 * requires three headers on the forwarded request (`Clerk-Proxy-Url`,
 * `Clerk-Secret-Key`, `X-Forwarded-For`) and Next.js rewrites cannot add
 * request headers to the destination.
 *
 * Without this file, switching to the production publishable key takes both
 * clients offline: every sign-in call would 404.
 */

const CLERK_FAPI = "https://frontend-api.clerk.dev";

/**
 * Hop-by-hop headers plus the ones the fetch layer must recompute. Forwarding
 * `host` would make Clerk reject the request as being for the wrong domain, and
 * a stale `content-length` breaks the body.
 */
const STRIPPED_REQUEST_HEADERS = new Set([
	"host",
	"connection",
	"keep-alive",
	"transfer-encoding",
	"upgrade",
	"content-length",
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
]);

function proxyUrl(): string {
	const configured = process.env.NEXT_PUBLIC_CLERK_PROXY_URL;
	if (!configured) {
		throw new Error("NEXT_PUBLIC_CLERK_PROXY_URL is required for the Clerk proxy");
	}
	return configured;
}

async function handler(request: Request, context: { params: Promise<{ path: string[] }> }) {
	const secretKey = process.env.CLERK_SECRET_KEY;
	if (!secretKey) {
		return new Response("Clerk proxy misconfigured", { status: 500 });
	}

	const { path } = await context.params;
	const search = new URL(request.url).search;
	const target = `${CLERK_FAPI}/${path.join("/")}${search}`;

	const headers = new Headers();
	request.headers.forEach((value, key) => {
		if (!STRIPPED_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
	});
	headers.set("Clerk-Proxy-Url", proxyUrl());
	headers.set("Clerk-Secret-Key", secretKey);
	// Clerk uses this for bot/abuse signals, so it has to be the real caller.
	// Vercel already populates x-forwarded-for; only synthesise it if missing.
	const forwardedFor =
		request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
	if (forwardedFor) headers.set("X-Forwarded-For", forwardedFor);

	// TEMPORARY (remove once native SSO is confirmed working): log the redirect
	// URL the client asks for on sign-in creation. Clerk silently omits
	// external_verification_redirect_url when the value is not in the instance
	// allowlist, which surfaces in the app only as "Missing external
	// verification redirect URL for SSO flow" with no indication of which URL
	// was rejected.
	let forwardBody: BodyInit | undefined;
	if (request.method !== "GET" && request.method !== "HEAD") {
		const raw = await request.text();
		forwardBody = raw;
		if (path.join("/").includes("client/sign_ins")) {
			const redirect = new URLSearchParams(raw).get("redirect_url");
			console.log(`[clerk-proxy] sign_ins redirect_url=${redirect ?? "(none)"}`);
		}
	}

	const upstream = await fetch(target, {
		method: request.method,
		headers,
		body: forwardBody,
		redirect: "manual",
	});

	const responseHeaders = new Headers();
	upstream.headers.forEach((value, key) => {
		const lower = key.toLowerCase();
		if (STRIPPED_RESPONSE_HEADERS.has(lower)) return;
		// Set-Cookie is handled separately below. forEach collapses repeated
		// headers into one comma-joined value, which is meaningless for cookies:
		// the browser would receive a single malformed cookie instead of several.
		// That corrupted Clerk's client/session cookies on the OAuth callback and
		// made every Google sign-in come back as err_code=authorization_invalid.
		if (lower === "set-cookie") return;
		responseHeaders.set(key, value);
	});

	// getSetCookie preserves each Set-Cookie as its own header.
	for (const cookie of upstream.headers.getSetCookie()) {
		responseHeaders.append("set-cookie", cookie);
	}

	// Clerk answers the OAuth callback with a relative redirect, e.g.
	// `Location: /v1/oauth_callback?...`. The browser resolves that against our
	// origin, which drops the /__clerk prefix and lands on a path this app does
	// not serve - so even a successful Google sign-in ended up on a 404 that the
	// middleware bounced to /sign-in. Put the proxy prefix back on any relative
	// redirect, and pull absolute ones pointing at the Frontend API back through
	// the proxy so the browser never talks to Clerk's host directly.
	const location = upstream.headers.get("location");
	if (location) {
		const prefix = new URL(proxyUrl()).pathname.replace(/\/$/, "");
		if (location.startsWith("/") && !location.startsWith(`${prefix}/`)) {
			responseHeaders.set("location", `${prefix}${location}`);
		} else if (location.startsWith(CLERK_FAPI)) {
			responseHeaders.set("location", `${prefix}${location.slice(CLERK_FAPI.length)}`);
		}
	}

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders,
	});
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;

// The Clerk handshake sets cookies per request; caching any of it would leak
// one user's session state to another.
export const dynamic = "force-dynamic";
