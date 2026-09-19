import Constants from "expo-constants";
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
} as const;

export const analytics: PostHog | null = POSTHOG_KEY
	? new PostHog(POSTHOG_KEY, {
			host: POSTHOG_HOST,
			// Application Opened / Backgrounded, which is the spine of any
			// retention question. Screen views are captured by the provider.
			captureAppLifecycleEvents: true,
			// Events queue in AsyncStorage while offline and flush on
			// reconnect, which matters on a phone in a church parking lot.
			flushInterval: 30,
		})
	: null;

/** Every event this client sends carries the platform, as the server's do. */
const BASE_PROPERTIES = { platform: "android", source: "client" } as const;

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
		analytics.identify(userId, properties);
	} catch {
		// Same reasoning as track().
	}
}

/**
 * Signing out has to break the link between this device and the account, or
 * the next person to sign in on this phone inherits the previous one's trail.
 */
export function resetAnalytics(): void {
	if (!analytics) return;
	try {
		analytics.reset();
	} catch {
		// Same reasoning as track().
	}
}
