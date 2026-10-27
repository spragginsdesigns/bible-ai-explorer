import type { MemoryCandidate, MemoryOverview, MemoryPassagePreview, MemorySession, MemorySessionCard } from "@/lib/beta/memory/memory";
import type { QuizQuestion } from "@/lib/quiz-contract";
import { parseReviewAcknowledgement, type LearnCard, type LearnResult } from "@/components/learn/learn";

/**
 * Scripture Memory's browser transport (LC-17651, docs/beta/memory.md). The
 * module's own routes live under /api/beta/memory; a review goes to Learn a
 * verse's own `/api/learn/[id]/review` with the card's revision, exactly as
 * the Learn a verse screen sends one, so there is one scheduler and one deck.
 */

export type { MemoryCandidate, MemoryOverview, MemoryPassagePreview, MemorySession, MemorySessionCard };
export type { MemorySessionUnit, MemoryBookView, MemoryUnitView } from "@/lib/beta/memory/memory";

async function request<T>(path: string, init?: { method: "POST"; body: object }): Promise<T> {
	let response: Response;
	try {
		response = await fetch(path, {
			method: init?.method ?? "GET",
			cache: "no-store",
			headers: init ? { "Content-Type": "application/json" } : undefined,
			body: init ? JSON.stringify(init.body) : undefined,
		});
	} catch {
		throw new Error("You appear to be offline. Please try again.");
	}
	const data = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
	if (!response.ok || !data) {
		throw new Error(typeof data?.error === "string" ? data.error : `Something went wrong (${response.status}).`);
	}
	return data;
}

export const fetchOverview = () => request<MemoryOverview>("/api/beta/memory");
export const fetchSession = () => request<MemorySession>("/api/beta/memory/session");
export const fetchCandidates = () => request<{ candidates: MemoryCandidate[] }>("/api/beta/memory/candidates");
export const previewReference = (reference: string) =>
	request<{ passage: MemoryPassagePreview }>(`/api/beta/memory/candidates?reference=${encodeURIComponent(reference)}`);
export const addCards = (reference: string, source: "highlight" | "suggestion" | "sheet") =>
	request<{ key: string; reference: string; added: number; alreadyInDeck: number }>("/api/beta/memory/cards", {
		method: "POST",
		body: { reference, source },
	});
export const writeQuestions = (reference: string) =>
	request<{ questions: QuizQuestion[] }>("/api/beta/memory/questions", { method: "POST", body: { reference } });

export function browserTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** "YYYY-MM-DD" of an instant on the founder's own calendar. */
export function localDay(instant: Date | string, timezone = browserTimezone()): string {
	const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
		typeof instant === "string" ? new Date(instant) : instant,
	);
	const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * One review of one card through Learn a verse's route. The operation id
 * makes a retried request count once; the revision makes a review from a
 * stale screen a conflict instead of a second review.
 */
export async function sendReview(card: MemorySessionCard, result: LearnResult): Promise<LearnCard> {
	const operationId = crypto.randomUUID();
	let response: Response;
	try {
		response = await fetch(`/api/learn/${encodeURIComponent(card.id)}/review`, {
			method: "POST",
			cache: "no-store",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				result,
				operationId,
				expectedRevision: card.revision,
				reviewedAt: new Date().toISOString(),
				timezone: browserTimezone(),
			}),
		});
	} catch {
		throw new Error("You appear to be offline. Your answer was not saved; try again.");
	}
	const data = await response.json().catch(() => null);
	if (response.status === 409) {
		throw new Error("This verse was reviewed somewhere else just now. Reload to pick up its new schedule.");
	}
	if (!response.ok) {
		throw new Error(typeof data?.error === "string" ? data.error : `The review was not saved (${response.status}).`);
	}
	const acknowledgement = parseReviewAcknowledgement(data, operationId);
	if (!acknowledgement.currentCard) throw new Error("This verse is no longer in your cards.");
	return acknowledgement.currentCard;
}
