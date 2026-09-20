"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import posthog from "posthog-js";

/**
 * Product analytics, browser half (PostHog).
 *
 * Mounted once in the root layout. It does two things and deliberately nothing
 * else: record a page view when the route changes, and tell PostHog who the
 * reader is once Clerk knows. The SDK itself is started in
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
 * A shared-answer id IS the credential that opens it (see the `/shared/(.*)`
 * note in src/middleware.ts), so it must never travel into an analytics
 * payload. The path is reduced to its shape and the query string goes with it.
 */
function sanitizeUrl(pathname: string, search: string): string {
	if (pathname.startsWith("/shared/")) {
		return `${window.location.origin}/shared/[id]`;
	}
	return `${window.location.origin}${pathname}${search ? `?${search}` : ""}`;
}

function AnalyticsPageView(): null {
	const pathname = usePathname();
	const searchParams = useSearchParams();

	useEffect(() => {
		if (!POSTHOG_KEY || !pathname) return;
		const search = searchParams?.toString() ?? "";
		posthog.capture("$pageview", {
			$current_url: sanitizeUrl(pathname, search),
			// The route shape, so "how many people opened a chapter" is one row
			// rather than one row per chapter.
			pathname: pathname.startsWith("/shared/") ? "/shared/[id]" : pathname,
			platform: "web",
			source: "client",
		});
	}, [pathname, searchParams]);

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
			{/* useSearchParams() opts its subtree out of static rendering, and
			    without a boundary that would take every page down with it. */}
			<Suspense fallback={null}>
				<AnalyticsPageView />
			</Suspense>
			<AnalyticsIdentity />
		</>
	);
}
