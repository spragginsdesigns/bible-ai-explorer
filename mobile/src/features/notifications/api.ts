import { apiJson, type GetToken } from "@/lib/api";

/**
 * Register/refresh this device's Expo push token. `enabled` governs the
 * verse-of-the-day cron and `chatReplies` the "your answer is ready" push; the
 * token itself stays registered either way, so turning one off never silences
 * the other.
 */
export function registerPushToken(
	getToken: GetToken,
	body: {
		token: string;
		platform: "ios" | "android";
		timezone: string;
		notifyHour: number;
		enabled: boolean;
		chatReplies: boolean;
	}
) {
	return apiJson<{ success: boolean }>(getToken, "/api/push-tokens", {
		method: "POST",
		body,
	});
}

/** Forget this device entirely - no push of any kind reaches it again. */
export function unregisterPushToken(getToken: GetToken, token: string) {
	return apiJson<{ success: boolean }>(getToken, "/api/push-tokens", {
		method: "DELETE",
		body: { token },
	});
}

export interface DailyCrossStudyStep {
	book: string;
	chapter: number;
	focus: string;
}

/** One "Pick Up Your Cross" day, as served by GET /api/verse-of-day/today. */
export interface DailyCrossEntry {
	id: string;
	reference: string;
	book: string;
	chapter: number;
	verse: number;
	text: string;
	reason: string;
	whyToday: string | null;
	application: string | null;
	studyPath: DailyCrossStudyStep[];
	question: string | null;
	sentAt: string;
}

/**
 * Today's guided day. The server generates one on demand when the morning
 * cron hasn't run for this user — that generation is a model call, so the
 * timeout gets extra room.
 */
export function fetchTodayCross(getToken: GetToken) {
	return apiJson<DailyCrossEntry>(getToken, "/api/verse-of-day/today", undefined, {
		timeoutMs: 300_000,
	});
}

/**
 * Replace today's guided day with a newly prepared one, optionally centred on
 * something the user typed. Same route the assistant's setDailyCross tool uses,
 * so a replacement from chat and one from this screen are the same act.
 */
export function replaceTodayCross(getToken: GetToken, focus?: string) {
	return apiJson<DailyCrossEntry>(
		getToken,
		"/api/verse-of-day/today",
		{ method: "POST", body: focus ? { focus } : {} },
		{ timeoutMs: 300_000 }
	);
}

/**
 * How the server describes today's spoken devotional. "unavailable" means the
 * deployment has no ElevenLabs credentials and can never make audio - the card
 * renders nothing at all for it. "locked" means this account is not on
 * SureWord Pro, and the card renders the Pro panel instead.
 */
export type DailyCrossAudioStatus =
	| "none"
	| "pending"
	| "ready"
	| "failed"
	| "unavailable"
	| "locked";

/** The caller's subscription tier, as reported alongside the audio. */
export type UserPlan = "free" | "pro";

/** Today's spoken devotional, as served by /api/verse-of-day/audio. */
export interface DailyCrossAudio {
	status: DailyCrossAudioStatus;
	/**
	 * Signed blob URL, good for 24 hours; only present while status is "ready".
	 * Kept because it fetches fine, but never handed to a player - Chrome's
	 * media loader will not load it, and the proxy keeps both clients on one
	 * path. Play from `streamUrl`.
	 */
	url: string | null;
	/**
	 * Path (relative to `API_URL`) that proxies the narration through the app's
	 * own API, `Range` and all; only present while status is "ready". Needs the
	 * Clerk bearer token like any other route. See
	 * `src/app/api/verse-of-day/audio/stream/route.ts`.
	 */
	streamUrl: string | null;
	title: string | null;
	/** The narrated text, for "Read along". */
	script: string | null;
	durationSec: number | null;
	generatedAt: string | null;
	/** The caller's tier, so "locked" needs no second call to explain itself. */
	plan: UserPlan;
}

/**
 * The state of today's devotional audio, without starting any work. This is
 * the only call the card makes on the happy path: the narration is started
 * server-side when the day is stored, so this is polled until it lands.
 */
export function fetchTodayCrossAudio(getToken: GetToken) {
	return apiJson<DailyCrossAudio>(getToken, "/api/verse-of-day/audio");
}

/**
 * The manual retry behind a failed card, and nothing else - first generations
 * are scheduled with the day. Safe to call twice (a ready or recently pending
 * row is reused), but it is a model call plus a full narration when it does
 * run, so around 30-60s.
 */
export function requestTodayCrossAudio(getToken: GetToken) {
	return apiJson<DailyCrossAudio>(
		getToken,
		"/api/verse-of-day/audio",
		{ method: "POST" },
		{ timeoutMs: 300_000 }
	);
}

/** Record that a chapter was read; feeds the verse-of-the-day personalization. */
export function recordReadingEvent(
	getToken: GetToken,
	body: { book: string; chapter: number; translation?: string }
) {
	return apiJson<{ success: boolean }>(getToken, "/api/reading-events", {
		method: "POST",
		body,
	});
}
