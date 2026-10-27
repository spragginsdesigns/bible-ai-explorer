import { CONSENT_DECLINED_NOTICE, aiConsentGate } from "@/lib/ai-consent-gate";
import type { TutorAction, TutorLevel, TutorSessionSummary, TutorSessionView } from "@/lib/beta/tutor/tutor-rules";

/**
 * The Socratic Tutor's calls to /api/beta/tutor (LC-17650). Anything that
 * reaches the model first passes SureWord's AI consent gate, the same sheet
 * every AI surface asks through; reading and pausing a session never do.
 */
export class TutorRequestError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: string | null,
	) {
		super(message);
		this.name = "TutorRequestError";
	}
}

const MESSAGES: Record<string, string> = {
	empty_answer: "Write your answer first.",
	answer_too_long: "That is a lot to check at once. Keep it under 2,000 characters.",
	stale: "This session changed in another window, so it has been brought up to date. Try again.",
	session_full: "This session is full. Save it as a note and start a fresh one on the same passage.",
	no_hint: "No more hints on this question. Try an answer, or ask for the tutor's reading.",
	nothing_to_save: "Answer at least one question before saving.",
};

function requestId(): string {
	return crypto.randomUUID().replace(/-/g, "");
}

async function call<T>(path: string, init: RequestInit & { ai?: boolean } = {}): Promise<T> {
	const { ai, ...rest } = init;
	if (ai && !(await aiConsentGate.ensure(true))) throw new TutorRequestError(CONSENT_DECLINED_NOTICE, 403, "AI_CONSENT_REQUIRED");
	let response: Response;
	try {
		response = await fetch(path, {
			...rest,
			headers: { "Content-Type": "application/json", ...(ai ? { "Idempotency-Key": requestId() } : {}), ...rest.headers },
			cache: "no-store",
		});
	} catch {
		throw new TutorRequestError("You appear to be offline. Check your connection and try again.", 0, "offline");
	}
	const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	if (!response.ok) {
		const code = typeof data.code === "string" ? data.code : typeof data.error === "string" ? data.error : null;
		const message = (code && MESSAGES[code]) || (typeof data.error === "string" && !/^[a-z_]+$/.test(data.error) ? data.error : "Something went wrong. Please try again.");
		throw new TutorRequestError(message, response.status, code);
	}
	return data as T;
}

const sessionPath = (id: string) => `/api/beta/tutor/sessions/${encodeURIComponent(id)}`;

export const tutorApi = {
	list: () => call<{ sessions: TutorSessionSummary[] }>("/api/beta/tutor/sessions"),
	start: (passage: string, level: TutorLevel) =>
		call<{ session: TutorSessionView }>("/api/beta/tutor/sessions", { method: "POST", body: JSON.stringify({ passage, level }), ai: true }),
	read: (id: string) => call<{ session: TutorSessionView }>(sessionPath(id)),
	turn: (id: string, action: TutorAction, text: string, expect: number) =>
		call<{ session: TutorSessionView }>(`${sessionPath(id)}/turn`, { method: "POST", body: JSON.stringify({ action, text, expect }), ai: true }),
	change: (id: string, patch: { level?: TutorLevel; paused?: boolean }) =>
		call<{ session: TutorSessionView }>(sessionPath(id), { method: "PATCH", body: JSON.stringify(patch) }),
	remove: (id: string) => call<{ deleted: true }>(sessionPath(id), { method: "DELETE" }),
	saveNote: (id: string) =>
		call<{ noteId: string; noteTitle: string; created: boolean; session: TutorSessionView }>(`${sessionPath(id)}/note`, { method: "POST", ai: true }),
};
