import Constants from "expo-constants";
import * as Device from "expo-device";
import PostHog from "posthog-react-native";

/**
 * Product analytics, Android half (docs/FEATURES.md, "What we measure").
 *
 * The server already reports what it can see for every client at once: an
 * answer finished, a rating arrived, an account appeared. This half exists
 * only for what the server cannot see, and that is worth being strict about,
 * because every event added here is one more thing to keep honest:
 *
 * - **Screens opened.** Which parts of the app people actually reach. The
 *   server sees a verse insight request; it has no idea the Bible tab was
 *   opened and abandoned.
 * - **App opened and backgrounded.** This is what makes a retention curve
 *   real. A person who opens SureWord every morning and reads without asking
 *   anything is invisible to the API.
 *
 * Touch autocapture is OFF, the same decision the web client makes and for the
 * same reason: it records the text of whatever was tapped, and here that text
 * is a verse, a saved question or a note title. The content rule in
 * src/lib/analytics/events.ts is the whole app's rule, not the web app's.
 *
 * With no key in `app.json` -> `extra.posthogKey` the client is null and every
 * helper below is a no-op, so a development build stays silent.
 */

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

const POSTHOG_KEY = typeof extra.posthogKey === "string" ? extra.posthogKey : "";
const POSTHOG_HOST =
	typeof extra.posthogHost === "string" ? extra.posthogHost : "https://us.i.posthog.com";

/**
 * Event names, mirrored from `src/lib/analytics/events.ts`. A name that drifts
 * from the server's copy silently splits one funnel into two, so
 * `tests/analytics-event-mirror.test.mjs` pins this list to that file.
 */
export const ANALYTICS_EVENTS = {
	screenViewed: "screen_viewed",
	feedbackSubmitted: "feedback_submitted",
	signInStarted: "sign_in_started",
	signInCompleted: "sign_in_completed",
	signInFailed: "sign_in_failed",
	requestFailed: "request_failed",
} as const;

export const analytics: PostHog | null = POSTHOG_KEY
	? new PostHog(POSTHOG_KEY, {
			host: POSTHOG_HOST,
			// Application Opened / Backgrounded, which is the spine of any
			// retention question. Screen views are sent by hand from
			// features/analytics/useScreenTracking.ts: the SDK's own
			// `captureScreens` hooks a React Navigation container, and
			// expo-router owns its container below the provider, so it produced
			// exactly zero screen events in the first two days of measurement.
			captureAppLifecycleEvents: true,
			// Match the web client. Without this the SDK stores a profile for
			// every anonymous launch, which is how six app opens became six
			// "new users" on 2026-09-20.
			personProfiles: "identified_only",
			// Events queue in AsyncStorage while offline and flush on
			// reconnect, which matters on a phone in a church parking lot.
			flushInterval: 30,
		})
	: null;

/**
 * Is this build incapable of producing product signal?
 *
 * An emulator is this machine's test loop and a dev build is a developer, and
 * both were being counted as people. `Device.isDevice` is false on every
 * emulator and simulator; `__DEV__` is false in a release build, so a real
 * phone running a shipped APK is never caught by either.
 *
 * Google Play's review devices are deliberately NOT detected here. They are
 * real hardware and would need a fingerprint that a real OnePlus owner would
 * also match. They sign in with the reviewer demo account instead, and that
 * account is on `INTERNAL_USER_IDS`, which flags the person rather than
 * guessing at the device.
 */
const IS_TEST_CLIENT = !Device.isDevice || __DEV__;

/**
 * Every event this client sends carries the platform, as the server's do,
 * plus which build produced it so a debug run never reads as production.
 */
const BASE_PROPERTIES = {
	platform: "android",
	source: "client",
	environment: __DEV__ ? "development" : "production",
	// Event-level twin of the person flag, so the anonymous events an emulator
	// sends before anyone signs in can be filtered too. The project's
	// test-account filter matches on it.
	is_test_client: IS_TEST_CLIENT,
} as const;

/** PostHog's own internal-traffic flag; the project's test-user cohort is defined on it. */
const INTERNAL_PERSON_PROPERTY = "$internal_or_test_user";

/**
 * What an event may carry: JSON scalars and lists of them, which is both what
 * PostHog stores and, not by coincidence, all a shape-only event ever needs.
 */
export type AnalyticsProperties = Record<
	string,
	string | number | boolean | null | string[] | number[]
>;

/** Record one event. Never throws: analytics must not be able to break a screen. */
export function track(event: string, properties?: AnalyticsProperties): void {
	if (!analytics) return;
	try {
		analytics.capture(event, { ...BASE_PROPERTIES, ...properties });
	} catch {
		// A dropped event is not worth a crash.
	}
}

/**
 * Tie this device's events to the signed-in account, so an Android session and
 * the server events for the same person land on one profile rather than two.
 */
export function identify(userId: string, properties?: AnalyticsProperties): void {
	if (!analytics) return;
	try {
		analytics.identify(userId, {
			...properties,
			// An emulator or dev build that signs in flags the person outright.
			// A real device leaves the flag to the server, which owns the
			// INTERNAL_USER_IDS allowlist and must not have it overwritten from
			// a client: `false` here would un-flag the Play reviewer.
			...(IS_TEST_CLIENT ? { [INTERNAL_PERSON_PROPERTY]: true } : {}),
		});
	} catch {
		// Same reasoning as track().
	}
}

/**
 * Signing out has to break the link between this device and the account, or
 * the next person to sign in on this phone inherits the previous one's trail.
 */
/**
 * Reduce an API path to its route shape. Mirrors `routeShape` in
 * src/lib/analytics/events.ts; see that copy for why it is eager about what
 * counts as an id and why `/api/shared/...` always loses its tail.
 */
export function routeShape(path: string): string {
	// Callers pass both forms: apiJson has a bare "/api/notes", while the
	// streaming fetch only ever sees the absolute URL it was handed. Without
	// this the host became the first two path segments.
	const withoutOrigin = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "");
	const withoutQuery = withoutOrigin.split(/[?#]/)[0] ?? "";
	const segments = withoutQuery
		.split("/")
		.filter(Boolean)
		.map((segment) => {
			if (/^\d+$/.test(segment)) return "[id]";
			if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i.test(segment)) return "[id]";
			if (segment.length >= 12 && /\d/.test(segment) && /^[A-Za-z0-9_-]+$/.test(segment)) {
				return "[id]";
			}
			return segment;
		});

	const sharedAt = segments.indexOf("shared");
	if (sharedAt !== -1 && segments.length > sharedAt + 1) {
		segments.splice(sharedAt + 1, segments.length, "[id]");
	}

	return `/${segments.join("/")}`;
}

/** How long one route+cause pair stays quiet after reporting itself. */
const FAILURE_QUIET_MS = 30_000;
const lastFailureAt = new Map<string, number>();

/**
 * Report a failed API call, at most once per route and cause per 30 seconds.
 *
 * The throttle is not politeness, it is correctness. Going offline fails every
 * in-flight request and every retry behind it, so an unthrottled event would
 * report one person's lost signal as hundreds of failures and bury the single
 * broken endpoint that actually needs finding. `reportAuthFailure` in api.ts
 * throttles for the same reason.
 */
export function trackRequestFailure(input: {
	path: string;
	kind: "offline" | "timeout" | "http";
	status?: number;
}): void {
	if (!analytics) return;
	const route = routeShape(input.path);
	const key = `${route}:${input.kind}`;
	const now = Date.now();
	const previous = lastFailureAt.get(key) ?? 0;
	if (now - previous < FAILURE_QUIET_MS) return;
	lastFailureAt.set(key, now);

	track(ANALYTICS_EVENTS.requestFailed, {
		route,
		kind: input.kind,
		status: input.status ?? null,
	});
}

export function resetAnalytics(): void {
	if (!analytics) return;
	try {
		analytics.reset();
	} catch {
		// Same reasoning as track().
	}
}
