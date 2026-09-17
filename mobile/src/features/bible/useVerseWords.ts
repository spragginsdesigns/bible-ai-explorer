import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiJson, type GetToken } from "@/lib/api";
import { getSettings } from "@/features/settings/settingsStore";

/**
 * Mirror of `src/lib/verse-words-contract.ts`. The mobile tree sits outside the
 * web tsconfig and cannot import from `src/`, so these interfaces are copied by
 * hand; change both together (and `macos/Shared/Bible/VerseWords.swift`).
 */

/** Decoded morphology for one morpheme. */
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
	translit?: string;
	gloss?: string;
	grammar: VerseWordGrammar | null;
}

/** One row of the interlinear list: a word or bound phrase and the KJV wording it became. */
export interface VerseWordRow {
	/** Indexes into `words`, in text order. Every word appears in exactly one row. */
	wordIndexes: number[];
	original: string;
	translit: string;
	kjv: string;
	sense: string;
}

export interface VerseWordStudy {
	book: number;
	chapter: number;
	verse: number;
	reference: string;
	language: "Hebrew" | "Greek";
	textName: string;
	kjvText: string;
	words: VerseWordDetail[];
	rows: VerseWordRow[];
	study: string[];
	carry: string;
	model: string | null;
	cached: boolean;
}

/** One place a Strong's number occurs, from `GET /api/bible/strongs?examples=`. */
export interface StrongsOccurrence {
	reference: string;
	text: string;
}

export interface StrongsOccurrences {
	/** Every verse of the original text carrying the number. */
	total: number;
	examples: StrongsOccurrence[];
}

/** One lexicon entry as served by /api/bible/strongs. */
export interface StrongsEntry {
	number: string;
	lemma: string;
	translit: string;
	def: string;
	kjv: string;
	occurrences?: StrongsOccurrences;
}

export type VerseWordsStatus = "idle" | "loading" | "ready" | "not-found" | "error";

export interface VerseWordsTarget {
	/** Book order, 1-66. */
	book: number;
	chapter: number;
	verse: number;
	/** False while no verse is selected, so the sheet fetches nothing. */
	enabled: boolean;
}

/** How many other KJV verses the expanded word shows. */
const EXAMPLE_COUNT = 3;

/**
 * Generation runs a model, so the first reader of a verse waits far longer than
 * the 30s default; later taps are served from the shared server cache.
 */
const STUDY_TIMEOUT_MS = 60_000;

/** Shown for a 502 or a transport failure: both are worth a retry. */
const GENERIC_ERROR = "Couldn't build the word study.";

/**
 * Session cache for word studies. The server caches them too, so this only
 * saves the round trip, but re-tapping a verse must feel instant. A `null`
 * entry records a verse the original texts do not carry (a 404), which is a
 * permanent answer; failures are never cached so a retry can still succeed.
 */
const studyCache = new Map<string, VerseWordStudy | null>();

function studyKey(book: number, chapter: number, verse: number): string {
	return `${book}:${chapter}:${verse}`;
}

function isUsable(value: VerseWordStudy | null | undefined): value is VerseWordStudy {
	return (
		value !== null &&
		value !== undefined &&
		Array.isArray(value.rows) &&
		value.rows.length > 0 &&
		Array.isArray(value.words)
	);
}

/**
 * Loads the AI-written word study behind a verse (`POST /api/verse-words`),
 * plus on-demand Strong's entries for the row the reader expands.
 *
 * Unlike the old raw interlinear this panel is the whole Words tab, so a
 * failure is reported rather than hidden: `status` separates a verse the
 * original texts genuinely lack ("not-found", a quiet line) from a failure
 * ("error", a message and a Retry).
 */
export function useVerseWords(getToken: GetToken, target: VerseWordsTarget) {
	const { book, chapter, verse, enabled } = target;
	const [data, setData] = useState<VerseWordStudy | null>(null);
	const [status, setStatus] = useState<VerseWordsStatus>("idle");
	const [error, setError] = useState<string | null>(null);
	// Bumped by retry() to re-run the effect; failures are never cached, so a
	// re-run is a real second attempt.
	const [attempt, setAttempt] = useState(0);
	// Guards state writes so a slow response for verse A can never land in an
	// open sheet that has since moved to verse B. Mirrors useVerseInsight.
	const runIdRef = useRef(0);
	// Lexicon entries are immutable, so this survives verse changes for the
	// lifetime of the hook; a re-expanded row never re-bills a request.
	const strongsCacheRef = useRef(new Map<string, StrongsEntry | null>());

	useEffect(() => {
		const id = ++runIdRef.current;

		const valid =
			Number.isInteger(book) &&
			Number.isInteger(chapter) &&
			Number.isInteger(verse) &&
			book >= 1 &&
			book <= 66 &&
			chapter >= 1 &&
			verse >= 1;

		if (!enabled || !valid) {
			setData(null);
			setStatus("idle");
			setError(null);
			return;
		}

		const key = studyKey(book, chapter, verse);
		const cached = studyCache.get(key);
		if (cached !== undefined) {
			setData(isUsable(cached) ? cached : null);
			setStatus(isUsable(cached) ? "ready" : "not-found");
			setError(null);
			return;
		}

		setData(null);
		setError(null);
		setStatus("loading");

		void (async () => {
			try {
				const result = await apiJson<VerseWordStudy>(
					getToken,
					"/api/verse-words",
					{
						method: "POST",
						body: {
							book,
							chapter,
							verse,
							modelId: getSettings().chatModelId,
						},
					},
					{ timeoutMs: STUDY_TIMEOUT_MS }
				);
				if (runIdRef.current !== id) return;
				if (!isUsable(result)) {
					// A 200 with no rows is the same answer as a 404 to a reader.
					studyCache.set(key, null);
					setData(null);
					setStatus("not-found");
					return;
				}
				studyCache.set(key, result);
				setData(result);
				setStatus("ready");
			} catch (err) {
				if (runIdRef.current !== id) return;
				setData(null);
				if (err instanceof ApiError && err.status === 404) {
					// The original texts do not carry this verse: settled, and worth
					// remembering so a re-tap does not ask again.
					studyCache.set(key, null);
					setStatus("not-found");
					return;
				}
				// A credential problem (403) explains itself; everything else is a
				// server or transport failure the reader can only retry.
				setError(
					err instanceof ApiError && err.status === 403 ? err.message : GENERIC_ERROR
				);
				setStatus("error");
			}
		})();

		return () => {
			// Invalidates this run, which also covers unmount.
			runIdRef.current += 1;
		};
	}, [getToken, book, chapter, verse, enabled, attempt]);

	const retry = useCallback(() => setAttempt((count) => count + 1), []);

	const fetchStrongs = useCallback(
		async (number: string): Promise<StrongsEntry | null> => {
			const cache = strongsCacheRef.current;
			// The verse being read is skipped in the examples: the reader is
			// already looking at it. That makes the answer per verse, so the
			// cache key carries the verse too.
			const exclude = `${book}:${chapter}:${verse}`;
			const key = `${number}|${exclude}`;
			const cached = cache.get(key);
			if (cached !== undefined) return cached;
			try {
				const entry = await apiJson<StrongsEntry>(
					getToken,
					`/api/bible/strongs?number=${encodeURIComponent(number)}` +
						`&examples=${EXAMPLE_COUNT}&exclude=${encodeURIComponent(exclude)}`
				);
				cache.set(key, entry);
				return entry;
			} catch (err) {
				// A lexicon miss is permanent and worth caching; a transport
				// failure is not, so a later tap can retry.
				if (err instanceof ApiError && err.status === 404) cache.set(key, null);
				return null;
			}
		},
		[getToken, book, chapter, verse]
	);

	return { data, status, error, retry, fetchStrongs };
}
