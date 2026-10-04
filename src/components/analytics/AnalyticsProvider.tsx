"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import posthog from "posthog-js";

import { trackRequestFailure } from "@/lib/analytics/client";
import {
	classifyFetchRejection,
	sameOriginApiPath,
	sanitizeAnalyticsPathname,
	sanitizeAnalyticsUrl,
} from "@/lib/analytics/web-signals";
import { observeFetch } from "./fetchObserver";

/**
 * Product analytics, browser half (PostHog).
 *
 * Mounted once in the root layout. It does three things and deliberately
 * nothing else: record a page view when the route changes, tell PostHog who
 * the reader is once Clerk knows, and report API requests that failed. The SDK itself is started in
 * src/instrumentation-client.ts, which Next runs before the React tree, because
 * a child's effect runs before its parent's and an init in this file's effect
 * would arrive one page view too late.
 *
 * Three things are turned OFF on purpose, and each one is a promise we made on
 * the privacy page rather than an oversight:
 *
 * - **Autocapture.** It records the text of whatever was clicked, and in this
 *   app that text is a verse, a saved question, or a note title. That is the
 *   content of someone's study, so every event here is named and explicit
 *   instead.
 * - **Session replay.** Same reason, more so: a replay is a recording of the
 *   reader's screen. If it is ever turned on it needs full text masking and a
 *   privacy page that says so first.
 * - **Anonymous person profiles.** Signed-out traffic is still counted, it
 *   just does not get a stored profile until there is an account to attach it
 *   to.
 *
 * With no key configured the SDK never starts, so local development and any
 * deploy without the env var stay silent rather than polluting production.
 */

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

/**
 * One page view per route change, keyed on the pathname alone. The query is
 * never sent, so a query-only change (a chapter turn, an Atlas search typed
 * into the URL) would only repeat the same row; Android's screen views are
 * route patterns for the same reason.
 */
function AnalyticsPageView(): null {
	const pathname = usePathname();

	useEffect(() => {
		if (!POSTHOG_KEY || !pathname) return;
		posthog.capture("$pageview", {
			$current_url: sanitizeAnalyticsUrl(`${window.location.origin}${pathname}`),
			// The route shape, so "how many people opened a chapter" is one row
			// rather than one row per chapter.
			pathname: sanitizeAnalyticsPathname(pathname),
			platform: "web",
			source: "client",
		});
	}, [pathname]);

	return null;
}

/**
 * `request_failed` for the browser, the twin of Android's reporter in
 * mobile/src/lib/api.ts: same-origin /api/ calls that came back with an error
 * status, timed out, or never reached the server. Observed once through the
 * shared fetch observer, because the web app has no single API client.
 *
 * A signed-out 401 is skipped, as on Android: that is the server correctly
 * turning away a visitor, and counting it would make 401 the loudest and
 * least useful row in the metric.
 */
function AnalyticsRequestFailures(): null {
	const { isSignedIn } = useAuth();
	const signedIn = useRef(false);
	signedIn.current = Boolean(isSignedIn);

	useEffect(
		() =>
			observeFetch(({ url, response, error, signalReason }) => {
				const path = sameOriginApiPath(url, window.location.origin);
				if (!path) return;
				if (response) {
					if (response.ok) return;
					if (response.status === 401 && !signedIn.current) return;
					trackRequestFailure({ path, kind: "http", status: response.status });
					return;
				}
				const kind = classifyFetchRejection(error, signalReason);
				if (kind) trackRequestFailure({ path, kind });
			}),
		[]
	);

	return null;
}

function AnalyticsIdentity(): null {
	const { isLoaded, isSignedIn, user } = useUser();
	const { userId } = useAuth();
	/**
	 * Who was signed in last time this ran, so a sign-OUT can be told apart
	 * from merely being signed out.
	 *
	 * This distinction is the whole reason the ref exists. `posthog.reset()`
	 * mints a brand new anonymous id and drops the old one on the floor, so
	 * calling it whenever Clerk reports nobody signed in destroys exactly the
	 * trail that makes an acquisition funnel possible: the landing page, the
	 * pricing page and the sign-up click all end up on a person that the
	 * eventual account never merges with. It also fires on every cold start,
	 * because Clerk reports signed-out for a beat before it restores the
	 * session. On 2026-09-20 that turned six app launches into six phantom
	 * users, and the two real people into four.
	 */
	const previousUserId = useRef<string | null>(null);

	useEffect(() => {
		if (!POSTHOG_KEY || !isLoaded) return;

		if (!isSignedIn || !userId) {
			// Only a real sign-out resets: somebody was here, and now they are
			// not. A visitor who has simply never signed in keeps their trail,
			// which is what lets it merge into the account they are about to
			// create.
			if (previousUserId.current) {
				posthog.reset();
				previousUserId.current = null;
			}
			return;
		}

		previousUserId.current = userId;
		posthog.identify(userId, {
			email: user?.primaryEmailAddress?.emailAddress ?? undefined,
			name: user?.fullName ?? undefined,
			signed_up_at: user?.createdAt ? new Date(user.createdAt).toISOString() : undefined,
		});
	}, [isLoaded, isSignedIn, userId, user]);

	return null;
}

export default function AnalyticsProvider(): React.ReactElement | null {
	if (!POSTHOG_KEY) return null;

	return (
		<>
			<AnalyticsPageView />
			<AnalyticsIdentity />
			<AnalyticsRequestFailures />
		</>
	);
}
