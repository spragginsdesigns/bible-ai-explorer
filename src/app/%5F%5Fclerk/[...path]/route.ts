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

/**
 * Remove the Domain attribute from a Set-Cookie value so the cookie binds to
 * whatever host served it - ours - instead of Clerk's.
 */
function stripCookieDomain(cookie: string): string {
	return cookie
		.split(";")
		.filter((part) => !/^\s*domain=/i.test(part))
		.join(";");
}

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

	// Read the body rather than streaming it: undici's duplex streaming is not
	// reliably available here, and the bodies on this route are small.
	const forwardBody =
		request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();

	// TEMPORARY: web sign-in still fails where native now succeeds. Clerk reports
	// only err_code=authorization_invalid, which says nothing about why. Log the
	// requested redirect and whether the client cookie actually came back on the
	// callback - no cookie values, only presence.
	const joined = path.join("/");
	if (joined.includes("client/sign_ins") && forwardBody) {
		console.log(`[clerk-proxy] sign_ins redirect_url=${new URLSearchParams(forwardBody).get("redirect_url") ?? "(none)"}`);
	}
	if (joined.includes("oauth_callback")) {
		const jar = request.headers.get("cookie") ?? "";
		console.log(
			`[clerk-proxy] oauth_callback __client=${jar.includes("__client=")} __client_uat=${jar.includes("__client_uat")} query=${new URL(request.url).searchParams.has("code") ? "has-code" : "no-code"}`
		);
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
	//
	// Every cookie Clerk sends is scoped to its own host
	// (Domain=.frontend-api.clerk.dev, Domain=clerkprod-cloudflare.net). Served
	// from our origin the browser rejects all of them outright, so Clerk's client
	// cookie was never stored and the OAuth callback could not be matched to the
	// sign-in attempt - which Clerk reports as authorization_invalid. Dropping
	// the Domain attribute makes each cookie host-only for our domain, which is
	// what a reverse proxy has to do.
	for (const cookie of upstream.headers.getSetCookie()) {
		responseHeaders.append("set-cookie", stripCookieDomain(cookie));
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
		// Only Frontend API paths (/v1/...) belong behind the proxy. A relative
		// redirect to somewhere in this app - which is what the success path
		// produces - must be left exactly as-is, or signing in successfully would
		// land on /__clerk/<app route> and break just as badly as the failure did.
		// An err_code redirect means Clerk rejected the attempt. Prefixing it
		// would send the browser straight back into this same proxy route, which
		// answers with the identical redirect forever. Surface it on /sign-in.
		const errCode = location.includes("err_code=")
			? new URLSearchParams(location.split("?")[1] ?? "").get("err_code")
			: null;
		if (errCode) {
			responseHeaders.set("location", `/sign-in?clerk_error=${encodeURIComponent(errCode)}`);
		} else if (location.startsWith("/v1/") && !location.startsWith(`${prefix}/`)) {
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
