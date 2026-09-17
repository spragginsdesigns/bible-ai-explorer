/**
 * The shape every client renders for the Words tab of the verse sheet. This
 * file is the contract between `POST /api/verse-words` and the Android, web
 * and Apple clients; it carries no runtime imports so the plain-node logic
 * tests and the mobile tree can both read it.
 *
 * Mirrored in `mobile/src/features/bible/useVerseWords.ts` (TypeScript) and
 * `macos/Shared/Bible/VerseWords.swift` (Codable). Change all three together.
 */

/** Decoded morphology for one morpheme, from `src/lib/bible/morphology.ts`. */
export interface VerseWordGrammar {
	partOfSpeech: string;
	features: string[];
	summary: string;
}

/** One word of the original text, in text order, with everything deterministic. */
export interface VerseWordDetail {
	/** Display form: Hebrew with vowel points but no cantillation, or Greek. */
	text: string;
	strongs: string;
	morph: string;
	lemma?: string;
	/** Strong's transliteration, its 19th-century notation and all. */
	translit?: string;
	/** Strong's KJV rendering list with its "[idiom]" markers removed. */
	gloss?: string;
	/** Plain-English grammar for the whole word, or null when undecodable. */
	grammar: VerseWordGrammar | null;
}

/** One row of the interlinear list: a word or a bound phrase and the KJV wording it became. */
export interface VerseWordRow {
	/** Indexes into `words`, in text order. Every word appears in exactly one row. */
	wordIndexes: number[];
	/** The row's words joined for display, already in reading order. */
	original: string;
	/** A reader's transliteration: "melo kaph", "re'ut ruach", "agape". */
	translit: string;
	/** The KJV words this became, quoted from the verse. */
	kjv: string;
	/** One line on what the original carries: a literal sense, an image, a root. */
	sense: string;
}

export interface VerseWordStudy {
	book: number;
	chapter: number;
	verse: number;
	/** "Ecclesiastes 4:6" */
	reference: string;
	language: "Hebrew" | "Greek";
	/** "Westminster Leningrad Codex" or "Scrivener 1894 Textus Receptus". */
	textName: string;
	kjvText: string;
	words: VerseWordDetail[];
	rows: VerseWordRow[];
	/** One or two short paragraphs: what the original says, and why the KJV reads as it does. */
	study: string[];
	/** One sentence to carry away. */
	carry: string;
	/** Namespaced model id that wrote the study, or null when unknown. */
	model: string | null;
	/** True when served from the shared cache rather than freshly generated. */
	cached: boolean;
}

/** Request body for `POST /api/verse-words`. */
export interface VerseWordsRequest {
	/** Book order, 1-66. */
	book: number;
	chapter: number;
	verse: number;
	/** The user's chat model pick; the server applies its own low effort. */
	modelId?: string | null;
}

/** One place a Strong's number occurs, served by `GET /api/bible/strongs?examples=`. */
export interface StrongsOccurrence {
	/** KJV reference when the row aligns to the KJV, e.g. "Isaiah 30:15". */
	reference: string;
	/** The KJV verse text, plain. */
	text: string;
}

export interface StrongsOccurrences {
	/** Every verse of the original text carrying the number. */
	total: number;
	examples: StrongsOccurrence[];
}
