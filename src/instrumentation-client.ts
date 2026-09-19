import posthog from "posthog-js";

/**
 * Start PostHog before the app hydrates.
 *
 * Next runs this file ahead of the React tree, which is the whole reason it
 * exists here rather than in a provider's effect: React runs a child's effect
 * before its parent's, so a provider that called `init` in its own effect
 * would have already dropped the first page view of the session by the time it
 * ran. That first view is the signed-out landing page, which is the one view
 * every acquisition question starts from.
 *
 * What is switched off here is switched off on purpose; the reasoning lives in
 * src/components/analytics/AnalyticsProvider.tsx and docs/FEATURES.md
 * ("What we measure"). Short version: autocapture would record the text of
 * whatever was clicked, and in this app that text is a verse or somebody's
 * saved question.
 */

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (POSTHOG_KEY) {
	posthog.init(POSTHOG_KEY, {
		// Same-origin, so an ad blocker cannot quietly delete half the numbers.
		// The rewrite is in next.config.mjs and the path is public in
		// src/middleware.ts.
		api_host: "/ingest",
		ui_host: "https://us.posthog.com",
		// Captured by hand on route changes: the App Router does not reload the
		// document, so the SDK's own listener would only ever see the first URL.
		capture_pageview: false,
		capture_pageleave: true,
		autocapture: false,
		disable_session_recording: true,
		person_profiles: "identified_only",
	});
}
