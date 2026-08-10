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

	const upstream = await fetch(target, {
		method: request.method,
		headers,
		body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
		// Streaming a request body requires duplex; harmless for bodyless methods.
		...({ duplex: "half" } as Record<string, unknown>),
		redirect: "manual",
	});

	const responseHeaders = new Headers();
	upstream.headers.forEach((value, key) => {
		if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
	});

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
