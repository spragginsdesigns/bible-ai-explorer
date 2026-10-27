/**
 * Pure rules for the Learning Paths lesson player (LC-17648): the instant
 * feedback the browser shows before the server's grade arrives. It reads the
 * answer keys in the exercise view, which the server built with the same
 * seeded order it grades with (`progress-rules.ts`), so the two always agree
 * (tests/beta-paths-progress.test.mjs checks that they do).
 *
 * No imports beyond types, so the tests load it with Node's type stripping.
 */
import type { ExerciseView } from "./view-types";

/** What the founder has answered so far, per exercise type; null parts are not answered yet. */
export type Draft =
	| { type: "choice" | "blank"; choice: number | null }
	| { type: "order"; order: number[] }
	| { type: "match"; pairs: (number | null)[] };

export function emptyDraft(ex: ExerciseView): Draft {
	if (ex.type === "order") return { type: "order", order: [] };
	if (ex.type === "match") return { type: "match", pairs: (ex.verses ?? []).map(() => null) };
	return { type: ex.type, choice: null };
}

/** The response the API takes, or null while the answer is incomplete. */
export function draftResponse(ex: ExerciseView, draft: Draft): { choice: number } | { order: number[] } | { pairs: number[] } | null {
	if (draft.type === "order") return draft.order.length === (ex.items?.length ?? -1) ? { order: draft.order } : null;
	if (draft.type === "match") return draft.pairs.every((pair) => pair !== null) ? { pairs: draft.pairs as number[] } : null;
	return draft.choice === null ? null : { choice: draft.choice };
}

/** Right or wrong, with a right or wrong per place for order and match. */
export function localGrade(ex: ExerciseView, response: { choice: number } | { order: number[] } | { pairs: number[] }): { correct: boolean; parts: boolean[] } {
	if ("choice" in response) {
		const correct = response.choice === ex.answerIndex;
		return { correct, parts: [correct] };
	}
	if ("order" in response) {
		const parts = response.order.map((shown, place) => ex.itemPlaces?.[shown] === place);
		return { correct: parts.length > 0 && parts.every(Boolean), parts };
	}
	const parts = response.pairs.map((shown, pair) => ex.truthPairs?.[shown] === pair);
	return { correct: parts.length > 0 && parts.every(Boolean), parts };
}

/** Place a step: tapping one already placed takes it back out. */
export function toggleOrder(order: readonly number[], shown: number): number[] {
	return order.includes(shown) ? order.filter((value) => value !== shown) : [...order, shown];
}

/**
 * Pair a truth with a verse. With no verse chosen, the truth fills the first
 * empty verse. A truth can belong to one verse only, so it moves.
 */
export function placeTruth(pairs: readonly (number | null)[], truth: number, verse: number | null): (number | null)[] {
	const target = verse ?? pairs.findIndex((pair) => pair === null);
	if (target < 0) return [...pairs];
	return pairs.map((pair, index) => (index === target ? truth : pair === truth ? null : pair));
}

/** Questions answered so far, retries not counted, for the progress bar. */
export function answeredCount(queue: readonly string[], index: number): number {
	return new Set(queue.slice(0, index)).size;
}

/** A question already asked earlier in this session is its second try. */
export function isRetry(queue: readonly string[], index: number): boolean {
	return queue.indexOf(queue[index]) < index;
}

/**
 * The answers to show after Check, one verse at a time: steps of an order
 * exercise that come from the same verse are listed together above it,
 * numbered by their place in the right order, instead of repeating the verse.
 */
export function groupAnswers<T extends { ref: string; label: string | null }>(answers: readonly T[]): (T & { labels: { n: number; label: string }[] })[] {
	const groups: (T & { labels: { n: number; label: string }[] })[] = [];
	answers.forEach((answer, index) => {
		const label = answer.label ? [{ n: index + 1, label: answer.label }] : [];
		const group = groups.find((entry) => entry.ref === answer.ref);
		if (group) group.labels.push(...label);
		else groups.push({ ...answer, labels: label });
	});
	return groups;
}

const PROPER = /\b(god|god's|jesus|christ|christ's|lord|lord's|holy spirit|holy ghost|paul|paul's|gentiles|israel|abraham|moses|david|adam|scripture|scriptures|trinity)\b/g;
const PROPER_CASE: Record<string, string> = { "holy spirit": "Holy Spirit", "holy ghost": "Holy Ghost" };

/** A concept label as a reader sees it: "Who God is", "Jesus Christ", "The Holy Spirit". */
export function conceptTitle(concept: string): string {
	const named = concept.replace(PROPER, (word) => PROPER_CASE[word] ?? word.charAt(0).toUpperCase() + word.slice(1));
	return named.charAt(0).toUpperCase() + named.slice(1);
}
