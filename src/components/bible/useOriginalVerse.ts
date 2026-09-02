"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface OriginalWord {
	text: string;
	strongs: string;
	morph: string;
	lemma?: string;
	translit?: string;
	gloss?: string;
}

export interface OriginalVerseData {
	book: number;
	chapter: number;
	verse: number;
	reference: string;
	language: "Hebrew" | "Greek";
	textName: string;
	words: OriginalWord[];
}

export interface StrongsEntry {
	number: string;
	lemma: string;
	translit: string;
	def: string;
	kjv: string;
}

interface UseOriginalVerseArgs {
	book: number;
	chapter: number;
	verse: number;
	enabled: boolean;
}

/**
 * Both texts are public domain and served with a day of cache, so a
 * module-level cache costs nothing and makes re-opening a verse instant.
 * Keyed by book:chapter:verse and by Strong's number respectively.
 */
const verseCache = new Map<string, OriginalVerseData | null>();
const strongsCache = new Map<string, StrongsEntry | null>();

function verseKey(book: number, chapter: number, verse: number): string {
	return `${book}:${chapter}:${verse}`;
}

function isOriginalVerseData(value: unknown): value is OriginalVerseData {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { language?: unknown; words?: unknown };
	return (
		(candidate.language === "Hebrew" || candidate.language === "Greek") &&
		Array.isArray(candidate.words)
	);
}

function isStrongsEntry(value: unknown): value is StrongsEntry {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as { number?: unknown; lemma?: unknown; def?: unknown };
	return (
		typeof candidate.number === "string" &&
		typeof candidate.lemma === "string" &&
		typeof candidate.def === "string"
	);
}

/**
 * The Hebrew or Greek behind the verse open in the reader panel, plus a
 * lazy Strong's dictionary lookup for whichever word the reader clicks.
 *
 * Missing data is an expected outcome, not a failure: the original-language
 * versification does not line up with the KJV everywhere, and both routes
 * answer 404 for a verse they do not carry. The caller renders nothing in
 * that case, so `notFound` and a network error are surfaced the same way.
 */
export function useOriginalVerse({ book, chapter, verse, enabled }: UseOriginalVerseArgs) {
	const [data, setData] = useState<OriginalVerseData | null>(null);
	const [loading, setLoading] = useState(false);
	const [notFound, setNotFound] = useState(false);
	// Only the newest request may write state, so a slow fetch for verse A
	// cannot land in a panel that has since moved to verse B.
	const runIdRef = useRef(0);

	useEffect(() => {
		const id = ++runIdRef.current;

		if (!enabled) {
			setData(null);
			setLoading(false);
			setNotFound(false);
			return;
		}

		const key = verseKey(book, chapter, verse);
		const cached = verseCache.get(key);
		if (cached !== undefined) {
			setData(cached);
			setLoading(false);
			setNotFound(cached === null);
			return;
		}

		const controller = new AbortController();
		setData(null);
		setNotFound(false);
		setLoading(true);

		void (async () => {
			try {
				const res = await fetch(
					`/api/bible/original?book=${book}&chapter=${chapter}&verse=${verse}`,
					{ signal: controller.signal }
				);
				if (runIdRef.current !== id) return;
				if (!res.ok) {
					// 404 is a real answer and worth caching; a 500 is not.
					if (res.status === 404) verseCache.set(key, null);
					setNotFound(true);
					setLoading(false);
					return;
				}
				const parsed: unknown = await res.json();
				if (runIdRef.current !== id) return;
				if (!isOriginalVerseData(parsed)) {
					setNotFound(true);
					setLoading(false);
					return;
				}
				verseCache.set(key, parsed);
				setData(parsed);
				setLoading(false);
			} catch {
				if (runIdRef.current !== id || controller.signal.aborted) return;
				setNotFound(true);
				setLoading(false);
			}
		})();

		return () => controller.abort();
	}, [book, chapter, verse, enabled]);

	/**
	 * Strong's entry for one number, fetched on the first click of a word that
	 * carries it. Resolves to null on 404 or any failure so callers can hide
	 * the definition line instead of showing an error inside a word card.
	 */
	const fetchStrongs = useCallback(async (number: string): Promise<StrongsEntry | null> => {
		const cached = strongsCache.get(number);
		if (cached !== undefined) return cached;
		try {
			const res = await fetch(`/api/bible/strongs?number=${encodeURIComponent(number)}`);
			if (!res.ok) {
				if (res.status === 404) strongsCache.set(number, null);
				return null;
			}
			const parsed: unknown = await res.json();
			if (!isStrongsEntry(parsed)) return null;
			strongsCache.set(number, parsed);
			return parsed;
		} catch {
			return null;
		}
	}, []);

	return { data, loading, notFound, fetchStrongs };
}
