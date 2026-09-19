/**
 * The product analytics event catalog (docs/FEATURES.md, "What we measure").
 *
 * One list, shared by every client and by the server, so a dashboard is never
 * built on a name that only one platform sends. Web and Android both emit
 * through this vocabulary: the server emits what it can see for all of them
 * (an answer finished, a devotional was generated), and each client emits only
 * what the server cannot see (a screen was opened, a card was tapped).
 *
 * THE CONTENT RULE, which is not negotiable: no event may carry the content of
 * anyone's study. Not the question, not the answer, not note text, not a
 * highlight's label, not a church name or address, not a verse's words. The
 * privacy page promises "No analytics profiles built from the content of your
 * study" (src/lib/marketing/legal-content.ts), and that promise is kept here or
 * not at all. Shapes are allowed and are the point: which book, how many
 * characters, which model, answered or not, how long it took.
 *
 * Adding an event means adding it to this list first. A name that is not here
 * is a typo waiting to split a funnel in half.
 */

export const ANALYTICS_EVENTS = {
	/** A chat turn reached its end, answered or not. Emitted server-side for every client. */
	chatTurnCompleted: "chat_turn_completed",
	/** A reader rated one answer. Carries the thumb and its chips, never the reason text. */
	answerRated: "answer_rated",
	/** An answer was shared out of the app as a link. */
	answerShared: "answer_shared",
	/** A tapped verse produced an insight. */
	verseInsightOpened: "verse_insight_opened",
	/** A tapped word produced a word study. */
	verseWordStudied: "verse_word_studied",
	/** The Daily Cross was opened for a given day. */
	dailyCrossViewed: "daily_cross_viewed",
	/** The spoken devotional was requested or played. */
	listenRequested: "listen_requested",
	/** A Learn card was reviewed. */
	learnReviewed: "learn_reviewed",
	/** A note was created. Length only, never the note. */
	noteCreated: "note_created",
	/** A reading plan day was completed. */
	readingPlanProgressed: "reading_plan_progressed",
	/** A chapter was read long enough to count in the reading log. */
	chapterRead: "chapter_read",
	/** A user opened the paywall or started checkout. */
	billingCheckoutStarted: "billing_checkout_started",
	/** Someone sent feedback through the in-app feedback box. */
	feedbackSubmitted: "feedback_submitted",
	/** An account was seen for the first time by the server. */
	accountCreated: "account_created",
	/**
	 * A screen was opened in a native client. Web's equivalent is `$pageview`,
	 * which the browser SDK sends for free; native has no URL to watch, so the
	 * app says so itself. Mirrored in `mobile/src/lib/analytics.ts`.
	 */
	screenViewed: "screen_viewed",
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * Which client a server-side event was serving. Android is the primary client
 * and web is the fallback surface, so every server event carries this: an
 * answer rate that looks fine overall can still be broken on one platform.
 *
 * Resolved from the request, never from a body field a caller could spoof into
 * another platform's numbers.
 */
export type AnalyticsPlatform = "android" | "ios" | "macos" | "web" | "unknown";

const ANDROID_HINT = /\bokhttp\b|\bandroid\b|\bexpo\b/i;
const APPLE_MOBILE_HINT = /\biphone\b|\bipad\b|\bios\b/i;
const MAC_HINT = /\bmacintosh\b|\bmac os x\b|\bdarwin\b/i;
const BROWSER_HINT = /\bmozilla\b|\bchrome\b|\bsafari\b|\bfirefox\b|\bedge\b/i;

/**
 * Name the client from the request's own headers.
 *
 * `x-sureword-client` is what the native apps set for themselves and is
 * trusted first, because a WebView-shaped user agent is exactly what the RN
 * and Swift HTTP stacks produce. The user-agent sniff below it is only for
 * builds already in the wild that never set the header, which is every Android
 * build shipped before this change. Order matters: Expo's Android fetch says
 * "okhttp", and a Mac browser says both "Macintosh" and "Mozilla", so the
 * browser test has to come after the native ones it would otherwise swallow.
 */
export function platformFromHeaders(headers: Headers): AnalyticsPlatform {
	const declared = headers.get("x-sureword-client")?.trim().toLowerCase();
	if (declared === "android" || declared === "ios" || declared === "macos" || declared === "web") {
		return declared;
	}

	const agent = headers.get("user-agent") ?? "";
	if (!agent) return "unknown";
	if (ANDROID_HINT.test(agent)) return "android";
	if (APPLE_MOBILE_HINT.test(agent)) return "ios";
	if (MAC_HINT.test(agent) && !BROWSER_HINT.test(agent)) return "macos";
	if (BROWSER_HINT.test(agent)) return "web";
	return "unknown";
}

/**
 * Bucket a count so it groups in a chart without becoming a fingerprint.
 * Used for note lengths and question lengths, where the exact number says
 * something about the content and the bucket does not.
 */
export function sizeBucket(value: number): string {
	if (!Number.isFinite(value) || value < 0) return "unknown";
	if (value < 100) return "under_100";
	if (value < 500) return "under_500";
	if (value < 2000) return "under_2k";
	if (value < 10000) return "under_10k";
	return "10k_plus";
}

/** Bucket a duration in milliseconds, same reasoning as {@link sizeBucket}. */
export function durationBucket(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "unknown";
	if (ms < 2000) return "under_2s";
	if (ms < 5000) return "under_5s";
	if (ms < 15000) return "under_15s";
	if (ms < 45000) return "under_45s";
	return "45s_plus";
}
