/**
 * Verses SureWord suggests you learn: the client half of GET /api/learn/suggestions.
 *
 * The server decides what to suggest and why. This module only decides what the
 * screen shows, so both clients agree on the rows, the copy and when the
 * section carries the screen.
 *
 * Rows are dropped one at a time rather than failing the whole section: these
 * suggestions sit beside today's practice cards and must never take the
 * practice screen down with them.
 */

export type LearnSuggestionSource = "highlight" | "reading" | "chat" | "cross" | "note";

export interface LearnSuggestion {
	book: number;
	chapter: number;
	verse: number;
	/** "Romans 8:28". */
	reference: string;
	/** The verse in the user's translation. */
	text: string;
	/** One plain sentence naming why this verse was chosen. */
	reason: string;
	/** Inbound cross-references in the bundled corpus. */
	weight: number;
	source: LearnSuggestionSource;
}

/** The endpoint's own cap, enforced again here so a loose server cannot flood the screen. */
export const LEARN_SUGGESTION_LIMIT = 5;

export const LEARN_SUGGESTIONS_HEADING = "Suggested for you";

/** Shown when nothing is due, so an empty queue offers a next verse instead of a dead end. */
export const LEARN_SUGGESTIONS_LEAD = "Verses worth knowing, from what you have been reading.";

const SUGGESTION_SOURCES: readonly string[] = ["highlight", "reading", "chat", "cross", "note"];

export interface LearnVerseCoordinates {
	book: number;
	chapter: number;
	verse: number;
}

export function suggestionKey(verse: LearnVerseCoordinates): string {
	return `${verse.book}:${verse.chapter}:${verse.verse}`;
}

function isCoordinate(value: unknown, max: number): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;
}

function isSentence(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isSuggestion(value: unknown): value is LearnSuggestion {
	if (!value || typeof value !== "object") return false;
	const row = value as Record<string, unknown>;
	return isCoordinate(row.book, 66) && isCoordinate(row.chapter, 200) && isCoordinate(row.verse, 200) &&
		isSentence(row.reference) && isSentence(row.text) && isSentence(row.reason) &&
		typeof row.weight === "number" && Number.isFinite(row.weight) && row.weight >= 0 &&
		typeof row.source === "string" && SUGGESTION_SOURCES.includes(row.source);
}

/** Keeps the rows the contract describes, in the order they arrived, one per verse. */
export function parseSuggestions(value: unknown): LearnSuggestion[] {
	const body = value as { suggestions?: unknown } | null;
	const rows: unknown[] = Array.isArray(body?.suggestions) ? body.suggestions : [];
	const seen = new Set<string>();
	const suggestions: LearnSuggestion[] = [];
	for (const row of rows) {
		if (!isSuggestion(row)) continue;
		const key = suggestionKey(row);
		if (seen.has(key)) continue;
		seen.add(key);
		suggestions.push(row);
		if (suggestions.length === LEARN_SUGGESTION_LIMIT) break;
	}
	return suggestions;
}

/**
 * The only way either client loads suggestions. Every failure, including an
 * endpoint this deploy does not serve yet, means "no suggestions today": the
 * practice screen must never depend on this call.
 */
export async function loadSuggestions(fetchSuggestions: () => Promise<unknown>): Promise<LearnSuggestion[]> {
	try {
		return parseSuggestions(await fetchSuggestions());
	} catch {
		return [];
	}
}

export interface LearnSuggestionsInput {
	suggestions: readonly LearnSuggestion[];
	/** Verse keys the user waved off this session. Never sent to the server. */
	dismissed: ReadonlySet<string>;
	/** Verse keys already added to the queue this session. */
	added: ReadonlySet<string>;
	/** Whether a practice card is on screen today. */
	hasCard: boolean;
}

export interface LearnSuggestionsView {
	rows: LearnSuggestion[];
	/** Nothing is due, so the suggestions are the screen's content. */
	lead: boolean;
	/** Nothing is due and nothing to suggest: the existing empty copy still applies. */
	showEmptyText: boolean;
	heading: string;
}

export function learnSuggestionsView(input: LearnSuggestionsInput): LearnSuggestionsView {
	const rows = input.suggestions.filter((suggestion) => {
		const key = suggestionKey(suggestion);
		return !input.dismissed.has(key) && !input.added.has(key);
	});
	const lead = !input.hasCard && rows.length > 0;
	return {
		rows,
		lead,
		showEmptyText: !input.hasCard && rows.length === 0,
		heading: lead ? LEARN_SUGGESTIONS_LEAD : LEARN_SUGGESTIONS_HEADING,
	};
}

/** The line that stands in for the row once it has been added. */
export function addedConfirmation(reference: string): string {
	return `Added ${reference} to Learn.`;
}
