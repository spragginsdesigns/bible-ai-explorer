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
		timeoutMs: 90_000,
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
		{ timeoutMs: 90_000 }
	);
}

/** How the server describes today's spoken devotional. */
export type DailyCrossAudioStatus = "none" | "pending" | "ready" | "failed";

/** Today's spoken devotional, as served by /api/verse-of-day/audio. */
export interface DailyCrossAudio {
	status: DailyCrossAudioStatus;
	/** Short-lived signed URL; only present while status is "ready". */
	url: string | null;
	title: string | null;
	/** The narrated text, for "Read along". */
	script: string | null;
	durationSec: number | null;
	generatedAt: string | null;
}

/**
 * The state of today's devotional audio, without starting any work. Cheap
 * enough to poll while a generation is running.
 */
export function fetchTodayCrossAudio(getToken: GetToken) {
	return apiJson<DailyCrossAudio>(getToken, "/api/verse-of-day/audio");
}

/**
 * Ask the server to prepare today's devotional audio, or hand back the one it
 * already prepared. Audio is deliberately generated on first tap rather than
 * ahead of time, so this is a model call plus a full narration - around 30-60s
 * on a cold day.
 */
export function requestTodayCrossAudio(getToken: GetToken) {
	return apiJson<DailyCrossAudio>(
		getToken,
		"/api/verse-of-day/audio",
		{ method: "POST" },
		{ timeoutMs: 120_000 }
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
