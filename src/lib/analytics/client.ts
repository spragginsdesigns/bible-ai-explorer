"use client";

import posthog from "posthog-js";

import { ANALYTICS_EVENTS, routeShape } from "./events";
import { createFailureThrottle, type WebRequestFailureKind } from "./web-signals";

/**
 * Named events the browser sends by hand.
 *
 * The web client deliberately has no autocapture (it records the text of
 * whatever was clicked, which here is a verse or somebody's saved question),
 * so anything worth counting has to be named here. That is a feature: it keeps
 * the list of what leaves the browser short enough to read.
 */

/** Which landing-page call to action was tapped. Names, never destinations. */
export type LandingCta =
	| "hero_start"
	| "header_sign_in"
	| "plan_free"
	| "plan_pro"
	| "closing_start"
	| "guest_save"
	| "guest_limit_sign_up";

/** Never throws: a dropped event must not cost the navigation. */
export function trackLandingCta(cta: LandingCta): void {
	try {
		posthog.capture(ANALYTICS_EVENTS.landingCtaClicked, { cta, platform: "web", source: "client" });
	} catch {
		// Analytics is never worth a broken link.
	}
}

/**
 * Guest answer outcomes. Shapes only, per the content rule in ./events.ts:
 * the question and the answer never leave the page through this.
 */
export function trackGuestAnswer(remaining: number, durationBucket: string): void {
	try {
		posthog.capture(ANALYTICS_EVENTS.guestAnswerCompleted, {
			remaining,
			duration: durationBucket,
			platform: "web",
			source: "client",
		});
	} catch {
		// Never worth interrupting an answer.
	}
}

export function trackGuestLimit(reason: string): void {
	try {
		posthog.capture(ANALYTICS_EVENTS.guestLimitReached, { reason, platform: "web", source: "client" });
	} catch {
		// Never worth interrupting the sign-up card.
	}
}

/** Which build a download link points at. Not the URL: the release moves. */
export type NativeDownloadPlatform = "android" | "macos";

/**
 * Somebody tapped a link to install the native app.
 *
 * This is the one conversion the web client exists to drive, and until now it
 * produced no event anywhere: "a web visitor installed Android" was simply not
 * a measurable sentence. It fires on every download surface rather than the
 * landing page alone, because the link is in the sidebar, the chat top bar,
 * the notes top bar, Settings and the shared-answer page too, and a funnel
 * built on one of them would quietly undercount the rest.
 *
 * Never throws and never blocks the navigation: the anchor keeps its real
 * href, so an analytics failure costs the event and not the download.
 */
export function trackNativeDownload(platform: NativeDownloadPlatform, surface: string): void {
	try {
		posthog.capture(ANALYTICS_EVENTS.nativeDownloadClicked, {
			native_platform: platform,
			surface,
			platform: "web",
			source: "client",
		});
	} catch {
		// A dropped event is never worth a broken download link.
	}
}

/**
 * A sign-in attempt began, finished, or stopped. Mirrors the Android events in
 * mobile/app/(auth)/sign-in.tsx: the method, and on failure Clerk's error
 * CODE and the step. Never the identifier, never Clerk's message (a message
 * can quote what the person typed), never the password or code.
 */
export function trackSignIn(
	stage: "started" | "completed" | "failed",
	properties: { method: string; reason?: string; step?: string }
): void {
	const event =
		stage === "started"
			? ANALYTICS_EVENTS.signInStarted
			: stage === "completed"
				? ANALYTICS_EVENTS.signInCompleted
				: ANALYTICS_EVENTS.signInFailed;
	try {
		posthog.capture(event, { ...properties, platform: "web", source: "client" });
	} catch {
		// Never worth interrupting a sign-in.
	}
}

/** Same quiet window as Android's `trackRequestFailure`. */
const FAILURE_QUIET_MS = 30_000;
const shouldReportFailure = createFailureThrottle(FAILURE_QUIET_MS);

/**
 * Report a failed API call from the browser, at most once per route and cause
 * per 30 seconds (see `createFailureThrottle` for why that is correctness and
 * not politeness). The route is reduced to its shape, so neither an id nor a
 * query string can travel with it.
 */
export function trackRequestFailure(input: { path: string; kind: WebRequestFailureKind; status?: number }): void {
	const route = routeShape(input.path);
	if (!shouldReportFailure(`${route}:${input.kind}`, Date.now())) return;
	try {
		posthog.capture(ANALYTICS_EVENTS.requestFailed, {
			route,
			kind: input.kind,
			status: input.status ?? null,
			// Android's `app_state` vocabulary, so one breakdown covers both
			// clients: a request that died while the tab was hidden is not the
			// same story as one that died in front of the reader.
			app_state: typeof document !== "undefined" && document.visibilityState === "hidden" ? "background" : "active",
			platform: "web",
			source: "client",
		});
	} catch {
		// Reporting a failure must not become a second one.
	}
}
