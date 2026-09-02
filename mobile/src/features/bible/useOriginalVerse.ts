import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiJson, type GetToken } from "@/lib/api";
import type { OriginalLanguage } from "./originalText";

/** One original-language word as served by /api/bible/original. */
export interface OriginalWord {
	text: string;
	strongs: string;
	morph: string;
	lemma?: string;
	translit?: string;
	gloss?: string;
}

export interface OriginalVerse {
	book: number;
	chapter: number;
	verse: number;
	reference: string;
	language: OriginalLanguage;
	textName: string;
	words: OriginalWord[];
}

/** One lexicon entry as served by /api/bible/strongs. */
export interface StrongsEntry {
	number: string;
	lemma: string;
	translit: string;
	def: string;
	kjv: string;
}

export interface OriginalVerseTarget {
	book: number;
	chapter: number;
	verse: number;
	/** False while no verse is selected, so the sheet fetches nothing. */
	enabled: boolean;
}

/**
 * Session cache for verse lookups. The underlying texts never change, and the
 * route is a day-cached public GET, so re-tapping a verse must not re-fetch.
 * A `null` entry records a verse the texts genuinely do not carry (a 404),
 * which is a permanent answer; transport failures are never cached so a
 * reconnect can still succeed.
 */
const verseCache = new Map<string, OriginalVerse | null>();

function verseKey(book: number, chapter: number, verse: number): string {
	return `${book}:${chapter}:${verse}`;
}

function isUsable(value: OriginalVerse | null): value is OriginalVerse {
	return value !== null && Array.isArray(value.words) && value.words.length > 0;
}

/**
 * Loads the Hebrew (Westminster Leningrad Codex) or Greek (Scrivener 1894
 * Textus Receptus) words behind a verse, plus on-demand Strong's definitions
 * for the word the reader taps.
 *
 * `notFound` means "there is nothing to show" - a verse the original texts do
 * not carry, or a failed request. The section renders nothing in both cases:
 * this is a supplementary panel on a sheet that is already useful without it,
 * so an error banner would cost more than it explains.
 */
export function useOriginalVerse(getToken: GetToken, target: OriginalVerseTarget) {
	const { book, chapter, verse, enabled } = target;
	const [data, setData] = useState<OriginalVerse | null>(null);
	const [loading, setLoading] = useState(false);
	const [notFound, setNotFound] = useState(false);
	// Guards state writes so a slow response for verse A can never land in an
	// open sheet that has since moved to verse B. Mirrors useVerseInsight.
	const runIdRef = useRef(0);
	// Lexicon entries are immutable, so this survives verse changes for the
	// lifetime of the hook; a re-tapped word never re-bills a request.
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
			setLoading(false);
			setNotFound(false);
			return;
		}

		const key = verseKey(book, chapter, verse);
		const cached = verseCache.get(key);
		if (cached !== undefined) {
			setData(isUsable(cached) ? cached : null);
			setNotFound(!isUsable(cached));
			setLoading(false);
			return;
		}

		setData(null);
		setNotFound(false);
		setLoading(true);

		void (async () => {
			try {
				const result = await apiJson<OriginalVerse>(
					getToken,
					`/api/bible/original?book=${book}&chapter=${chapter}&verse=${verse}`
				);
				if (runIdRef.current !== id) return;
				if (!isUsable(result)) {
					verseCache.set(key, null);
					setData(null);
					setNotFound(true);
					setLoading(false);
					return;
				}
				verseCache.set(key, result);
				setData(result);
				setNotFound(false);
				setLoading(false);
			} catch (error) {
				if (runIdRef.current !== id) return;
				// Only a 404 is a settled answer worth remembering.
				if (error instanceof ApiError && error.status === 404) verseCache.set(key, null);
				setData(null);
				setNotFound(true);
				setLoading(false);
			}
		})();

		return () => {
			// Invalidates this run, which also covers unmount.
			runIdRef.current += 1;
		};
	}, [getToken, book, chapter, verse, enabled]);

	const fetchStrongs = useCallback(
		async (number: string): Promise<StrongsEntry | null> => {
			const cache = strongsCacheRef.current;
			const cached = cache.get(number);
			if (cached !== undefined) return cached;
			try {
				const entry = await apiJson<StrongsEntry>(
					getToken,
					`/api/bible/strongs?number=${encodeURIComponent(number)}`
				);
				cache.set(number, entry);
				return entry;
			} catch (error) {
				// A lexicon miss is permanent and worth caching; a transport
				// failure is not, so a later tap can retry.
				if (error instanceof ApiError && error.status !== undefined) cache.set(number, null);
				return null;
			}
		},
		[getToken]
	);

	return { data, loading, notFound, fetchStrongs };
}
