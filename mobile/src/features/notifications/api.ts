import { apiJson, type GetToken } from "@/lib/api";

/** Register/refresh this device's Expo push token for the verse-of-the-day cron. */
export function registerPushToken(
	getToken: GetToken,
	body: { token: string; platform: "ios" | "android"; timezone: string; notifyHour: number }
) {
	return apiJson<{ success: boolean }>(getToken, "/api/push-tokens", {
		method: "POST",
		body,
	});
}

/** Stop verse-of-the-day pushes to this device. */
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
