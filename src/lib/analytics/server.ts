import "server-only";

import { PostHog } from "posthog-node";

import type { AnalyticsEventName, AnalyticsPlatform } from "./events";
import { parseUserIdAllowlist } from "@/lib/entitlements-rules";
import { INTERNAL_PERSON_PROPERTY, deployEnvironment, isInternalUserId } from "./internal";

/**
 * Clerk ids whose activity is never product signal. Read here rather than in
 * ./internal.ts so that module can stay import-free and directly testable.
 */
function internalUserIds(): string[] {
	return parseUserIdAllowlist(process.env.INTERNAL_USER_IDS);
}

/**
 * Product analytics, server half (PostHog).
 *
 * The server is the honest half of the measurement: it sees every client at
 * once, including the Android builds already installed on people's phones that
 * will never carry a client SDK, and it cannot be blocked by an ad blocker or
 * a dead network. Client events exist for what the server genuinely cannot
 * see (a screen opened, a card tapped, a person who never signed in).
 *
 * Three rules hold this file together:
 *
 * 1. **It never throws and never blocks an answer.** Every entry point is
 *    wrapped and swallows its own errors. Analytics failing must never turn a
 *    working answer into a 500; that trade is always wrong.
 * 2. **It is off unless configured.** With no key, every call is a no-op, so
 *    local development and any deploy without the env var stay silent instead
 *    of erroring or, worse, polluting production numbers with dev traffic.
 * 3. **It carries no study content.** See the content rule in ./events.ts.
 *
 * Serverless flushing: a Vercel function can freeze the moment it responds, so
 * a batched queue would lose the event. `flushAt: 1` sends on capture, and
 * callers that can afford it await {@link flushAnalytics} before returning.
 */

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

/** How long a flush may hold a response open before we give up on it. */
const FLUSH_TIMEOUT_MS = 1500;

let client: PostHog | null = null;

/**
 * True when analytics is configured. Callers do not need to check this: every
 * function here is already a no-op without it. Exported because a route that
 * would do real work purely to build properties can skip that work.
 */
export function analyticsEnabled(): boolean {
	return Boolean(POSTHOG_KEY);
}

function getClient(): PostHog | null {
	if (!POSTHOG_KEY) return null;
	if (client) return client;
	client = new PostHog(POSTHOG_KEY, {
		host: POSTHOG_HOST,
		// Send immediately: the function may freeze right after the response.
		flushAt: 1,
		flushInterval: 0,
		// The only IP a server event carries is the Vercel function's own, so
		// geolocating it is not merely useless, it is wrong: it stamped every
		// backend event "Ashburn, Virginia" and would have overwritten each
		// person's real location with the data centre's. Country belongs to the
		// client events, which are sent from the actual device.
		disableGeoip: true,
	});
	return client;
}

export interface ServerEventInput {
	/** The Clerk user id. Anonymous server events are not a thing: there is no session without one. */
	userId: string;
	event: AnalyticsEventName;
	/** Shape only. No question text, no answer text, no note bodies. */
	properties?: Record<string, unknown>;
	platform?: AnalyticsPlatform;
}

/**
 * Record one server-side event.
 *
 * Fire and forget by design. Await it only where the extra few milliseconds
 * genuinely do not matter; in a streaming route, call it inside the same
 * `waitUntil` that already covers persistence.
 */
export function captureServerEvent({ userId, event, properties, platform }: ServerEventInput): void {
	const posthog = getClient();
	if (!posthog || !userId) return;
	try {
		const internal = isInternalUserId(userId, internalUserIds());
		posthog.capture({
			distinctId: userId,
			event,
			properties: {
				...properties,
				...(platform ? { platform } : {}),
				// Tells a dashboard which half of the pipeline produced the row,
				// so a client event and its server twin never get double counted.
				source: "server",
				// Preview deploys share this project; without it a branch under
				// test reads as production traffic.
				environment: deployEnvironment(),
				// Re-asserted on every event rather than only at sign-up, because
				// the allowlist changes (a new reviewer account, a new test
				// device) and a person flagged only once would keep the old
				// answer forever.
				$set: {
					...(properties?.$set && typeof properties.$set === "object"
						? (properties.$set as Record<string, unknown>)
						: {}),
					[INTERNAL_PERSON_PROPERTY]: internal,
				},
			},
		});
	} catch (error) {
		console.error("[analytics] capture failed:", error);
	}
}

/**
 * Attach who someone is to their events.
 *
 * Identity, not content: the Clerk id is already the distinct id, and this
 * adds the handful of account properties that make a cohort answerable ("did
 * the people who signed up this week come back?"). Called where an account is
 * first seen rather than on every request, because person properties are
 * overwritten on every call and that is a write we do not need to repeat.
 */
export function identifyServerUser(
	userId: string,
	properties: Record<string, unknown>,
): void {
	const posthog = getClient();
	if (!posthog || !userId) return;
	try {
		posthog.identify({
			distinctId: userId,
			properties: {
				...properties,
				[INTERNAL_PERSON_PROPERTY]: isInternalUserId(userId, internalUserIds()),
			},
		});
	} catch (error) {
		console.error("[analytics] identify failed:", error);
	}
}

/**
 * Push anything queued, with a ceiling on how long it may take.
 *
 * The race matters: PostHog being slow or unreachable must cost the user at
 * most {@link FLUSH_TIMEOUT_MS}, never their answer. Losing an event is an
 * acceptable outcome here and a hung request is not.
 */
export async function flushAnalytics(): Promise<void> {
	const posthog = client;
	if (!posthog) return;
	try {
		await Promise.race([
			posthog.flush(),
			new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
		]);
	} catch (error) {
		console.error("[analytics] flush failed:", error);
	}
}
