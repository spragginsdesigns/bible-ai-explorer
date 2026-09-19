"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth, useUser } from "@clerk/nextjs";
import posthog from "posthog-js";

/**
 * Product analytics, browser half (PostHog).
 *
 * Mounted once in the root layout. It does three things and deliberately
 * nothing else: start the SDK, record a page view when the route changes, and
 * tell PostHog who the reader is once Clerk knows.
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

	useEffect(() => {
		if (!POSTHOG_KEY || !isLoaded) return;

		if (!isSignedIn || !userId) {
			// Signing out has to break the link between the account and anything
			// the next person on this browser does.
			posthog.reset();
			return;
		}

		posthog.identify(userId, {
			email: user?.primaryEmailAddress?.emailAddress ?? undefined,
			name: user?.fullName ?? undefined,
			signed_up_at: user?.createdAt ? new Date(user.createdAt).toISOString() : undefined,
		});
	}, [isLoaded, isSignedIn, userId, user]);

	return null;
}

let initialized = false;

export default function AnalyticsProvider(): React.ReactElement | null {
	useEffect(() => {
		if (!POSTHOG_KEY || initialized) return;
		initialized = true;
		posthog.init(POSTHOG_KEY, {
			// Same-origin so an ad blocker cannot quietly delete half the numbers.
			// The rewrite lives in next.config.mjs and the path is public in
			// src/middleware.ts, or signed-out visitors would be redirected to
			// /sign-in instead of being counted.
			api_host: "/ingest",
			ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.posthog.com",
			capture_pageview: false,
			capture_pageleave: true,
			autocapture: false,
			disable_session_recording: true,
			person_profiles: "identified_only",
		});
	}, []);

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
