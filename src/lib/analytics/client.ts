"use client";

import posthog from "posthog-js";

import { ANALYTICS_EVENTS } from "./events";

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
