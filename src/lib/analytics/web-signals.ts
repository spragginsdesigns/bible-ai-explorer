/**
 * Pure helpers behind the web client's analytics: what a URL is allowed to say
 * about itself, how a failed browser request is classified, and how a Clerk
 * sign-in attempt is named. Kept free of the browser and of posthog-js so the
 * rules can be tested in Node (tests/analytics-web-signals.test.mjs), because
 * every one of them is the kind of thing that is only ever wrong in
 * production, where nobody is looking.
 *
 * The content rule in ./events.ts applies to all of it: a query string in this
 * app carries a verse's words, a prompt, or an attached passage
 * (`/?prompt=...`, `/?attachText=...`), so no URL leaves the browser with one.
 */

/**
 * Event property keys that hold a full URL. PostHog stamps several of these on
 * every event by itself, not just on page views, so sanitizing only the
 * `$pageview` call would still leak the query string through every other
 * event and through `$pageleave`.
 */
const URL_PROPERTY = /(^|[_$])(url|referrer)$/i;
/** Event property keys that hold a bare pathname. */
const PATHNAME_PROPERTY = /(^|[_$])pathname$/i;

/**
 * A path reduced to what may be measured. A shared-answer id IS the
 * credential that opens it (see the `/shared/(.*)` note in src/middleware.ts),
 * so that tail always goes.
 */
export function sanitizeAnalyticsPathname(pathname: string): string {
	const path = pathname.split(/[?#]/)[0] || "/";
	return path.startsWith("/shared/") ? "/shared/[id]" : path;
}

/**
 * A URL with its query string and fragment removed and its path sanitized.
 *
 * Every query key is dropped, with no allowlist: no dashboard reads one, and
 * PostHog extracts `utm_*` campaign parameters into their own properties
 * before an event is sent, so attribution survives without them. A value that
 * is not a parseable absolute URL is returned with the same stripping applied
 * textually rather than passed through.
 */
export function sanitizeAnalyticsUrl(value: string): string {
	try {
		const url = new URL(value);
		return `${url.origin}${sanitizeAnalyticsPathname(url.pathname)}`;
	} catch {
		return sanitizeAnalyticsPathname(value);
	}
}

type PropertyBag = Record<string, unknown>;

function sanitizeBag(bag: PropertyBag): PropertyBag {
	const next: PropertyBag = { ...bag };
	for (const [key, value] of Object.entries(next)) {
		if (typeof value !== "string" || !value) continue;
		if (URL_PROPERTY.test(key)) next[key] = sanitizeAnalyticsUrl(value);
		else if (PATHNAME_PROPERTY.test(key)) next[key] = sanitizeAnalyticsPathname(value);
	}
	return next;
}

/**
 * Sanitize one outgoing event: its properties and the person properties PostHog
 * attaches through `$set` / `$set_once` (`$initial_current_url` lives there).
 * Never drops an event; it only rewrites URL-shaped values.
 */
export function sanitizeOutgoingEvent<T extends { properties?: PropertyBag; $set?: PropertyBag; $set_once?: PropertyBag }>(
	event: T
): T {
	const next: T = { ...event };
	if (event.properties) {
		const properties = sanitizeBag(event.properties);
		for (const nested of ["$set", "$set_once"] as const) {
			const value = properties[nested];
			if (value && typeof value === "object") properties[nested] = sanitizeBag(value as PropertyBag);
		}
		next.properties = properties;
	}
	if (event.$set) next.$set = sanitizeBag(event.$set);
	if (event.$set_once) next.$set_once = sanitizeBag(event.$set_once);
	return next;
}

/** How a browser request died, in the same three words Android uses. */
export type WebRequestFailureKind = "offline" | "timeout" | "http";

function errorName(value: unknown): string | null {
	if (value && typeof value === "object" && "name" in value) {
		const name = (value as { name?: unknown }).name;
		return typeof name === "string" ? name : null;
	}
	return null;
}

/**
 * Classify a rejected fetch, or return null when it is not a failure at all.
 *
 * A plain abort is somebody pressing Stop or a component unmounting, which is
 * the product working; only an abort whose reason is a timeout counts. Any
 * other rejection is the network refusing the request, which Android also
 * files as `offline`.
 */
export function classifyFetchRejection(
	error: unknown,
	signalReason?: unknown
): Exclude<WebRequestFailureKind, "http"> | null {
	const name = errorName(error);
	if (name === "TimeoutError") return "timeout";
	if (name === "AbortError") return errorName(signalReason) === "TimeoutError" ? "timeout" : null;
	return "offline";
}

/**
 * The pathname of a same-origin API call, or null for anything else (Clerk,
 * PostHog's /ingest proxy, assets, other origins). The query is gone either
 * way; the caller still reduces ids with `routeShape`.
 */
export function sameOriginApiPath(requestUrl: string, origin: string): string | null {
	try {
		const url = new URL(requestUrl, origin);
		if (url.origin !== origin) return null;
		return url.pathname.startsWith("/api/") ? url.pathname : null;
	} catch {
		return null;
	}
}

/**
 * One report per key per quiet window. Going offline fails every in-flight
 * request and every retry behind it, so without this one person's lost
 * signal reads as hundreds of failures and buries the endpoint that is
 * actually broken. Mirrors the throttle in mobile/src/lib/analytics.ts.
 */
export function createFailureThrottle(quietMs: number): (key: string, now: number) => boolean {
	const lastAt = new Map<string, number>();
	return (key, now) => {
		const previous = lastAt.get(key);
		if (previous !== undefined && now - previous < quietMs) return false;
		lastAt.set(key, now);
		return true;
	};
}

/**
 * The method name a Clerk first-factor strategy is reported under, matching
 * mobile/app/(auth)/sign-in.tsx: `google`, `password`, `email_code`.
 */
export function signInMethodFromStrategy(strategy: string | null | undefined): string | null {
	if (!strategy) return null;
	if (strategy.startsWith("oauth_")) return strategy.slice("oauth_".length);
	return strategy;
}

/** Which step of a Clerk sign-in a failed Frontend API call belongs to. */
export interface ClerkSignInFailure {
	method: string;
	step: "lookup" | "verify" | "prepare";
}

/**
 * Name a failed Clerk Frontend API call, or return null when it is not part of
 * a sign-in. Only the `strategy` field of the request body is ever read: the
 * same body carries the identifier and the password or code, and none of that
 * may reach an event.
 */
export function clerkSignInFailureFrom(requestUrl: string, body: string | null): ClerkSignInFailure | null {
	let pathname: string;
	try {
		pathname = new URL(requestUrl).pathname;
	} catch {
		return null;
	}
	const match = pathname.match(/\/v1\/client\/sign_ins(?:\/[^/]+\/(attempt_first_factor|prepare_first_factor))?\/?$/);
	if (!match) return null;
	let strategy: string | null = null;
	if (body) {
		try {
			strategy = new URLSearchParams(body).get("strategy");
		} catch {
			strategy = null;
		}
	}
	const method = signInMethodFromStrategy(strategy);
	if (match[1] === "attempt_first_factor") return { method: method ?? "unknown", step: "verify" };
	if (match[1] === "prepare_first_factor") return { method: method ?? "email_code", step: "prepare" };
	// Creating the attempt: an identifier lookup unless it was an OAuth start.
	return method && strategy?.startsWith("oauth_")
		? { method, step: "lookup" }
		: { method: "email", step: "lookup" };
}

/** Clerk's machine-readable reason from an error response body, never its message. */
export function clerkErrorCodeFrom(body: unknown): string {
	if (body && typeof body === "object" && "errors" in body) {
		const errors = (body as { errors?: unknown }).errors;
		if (Array.isArray(errors)) {
			const first: unknown = errors[0];
			if (first && typeof first === "object" && "code" in first) {
				const code = (first as { code?: unknown }).code;
				if (typeof code === "string" && code) return code;
			}
		}
	}
	return "unknown";
}
