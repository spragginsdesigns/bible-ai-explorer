"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readModelPref } from "@/lib/preferences";
import type { StrongsOccurrences, VerseWordStudy } from "@/lib/verse-words-contract";

/**
 * `GET /api/bible/strongs?examples=` : the dictionary entry for one number
 * plus, when asked for, the other KJV verses it lands in.
 */
export interface StrongsDetail {
	number: string;
	lemma: string;
	translit: string;
	def: string;
	kjv: string;
	occurrences?: StrongsOccurrences;
}

export type VerseWordsState =
	| { status: "loading" }
	| { status: "ready"; study: VerseWordStudy }
	/** The original text does not carry this verse. Not a failure, just nothing to show. */
	| { status: "not-found" }
	| { status: "error"; message: string; retryable: boolean };

/** What a failed generation says. A credential problem speaks for itself instead. */
const ERROR_MESSAGE = "Couldn't build the word study.";

/**
 * The study is generated once per verse and then served from a shared server
 * cache, so a session-level cache only saves the round trip. Keyed by
 * book:chapter:verse; a "not-found" is a real answer and cached too.
 * Strong's entries are keyed by number and by the verse excluded from their
 * examples, since that list differs per verse.
 */
const studyCache = new Map<string, VerseWordStudy | "not-found">();
const strongsCache = new Map<string, StrongsDetail | null>();

function verseKey(book: number, chapter: number, verse: number): string {
	return `${book}:${chapter}:${verse}`;
}

function isVerseWordStudy(value: unknown): value is VerseWordStudy {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<VerseWordStudy>;
	return (
		(candidate.language === "Hebrew" || candidate.language === "Greek") &&
		Array.isArray(candidate.words) &&
		Array.isArray(candidate.rows) &&
		Array.isArray(candidate.study) &&
		typeof candidate.carry === "string"
	);
}

function isStrongsDetail(value: unknown): value is StrongsDetail {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<StrongsDetail>;
	return (
		typeof candidate.number === "string" &&
		typeof candidate.lemma === "string" &&
		typeof candidate.def === "string"
	);
}

/** The `error` field of a JSON error body, when the body has one. */
async function errorMessage(res: Response): Promise<string | null> {
	try {
		const data = (await res.json()) as { error?: unknown };
		return typeof data.error === "string" && data.error ? data.error : null;
	} catch {
		return null;
	}
}

interface UseVerseWordsArgs {
	/** Book order, 1-66. */
	book: number;
	chapter: number;
	verse: number;
}

/**
 * The Words tab's AI-written word study for one verse, plus the lazy Strong's
 * lookup behind whichever row the reader opens. Mirrors the mobile hook in
 * mobile/src/features/bible/useVerseWords.ts; auth is the same-origin Clerk
 * session cookie, so the request must carry credentials.
 *
 * A first tap on a verse nobody has opened waits on generation, which is why
 * the loading copy names the language rather than spinning silently.
 */
export function useVerseWords({ book, chapter, verse }: UseVerseWordsArgs) {
	const [state, setState] = useState<VerseWordsState>({ status: "loading" });
	// Only the newest request may write state, so a slow generation for verse A
	// cannot land in a panel that has since moved to verse B.
	const runIdRef = useRef(0);
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		const id = ++runIdRef.current;
		const key = verseKey(book, chapter, verse);

		const cached = studyCache.get(key);
		if (cached !== undefined) {
			setState(cached === "not-found" ? { status: "not-found" } : { status: "ready", study: cached });
			return;
		}

		const controller = new AbortController();
		setState({ status: "loading" });

		void (async () => {
			try {
				const res = await fetch("/api/verse-words", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					credentials: "same-origin",
					body: JSON.stringify({ book, chapter, verse, modelId: readModelPref() }),
					signal: controller.signal,
				});
				if (runIdRef.current !== id) return;

				if (!res.ok) {
					const message = await errorMessage(res);
					if (runIdRef.current !== id) return;
					if (res.status === 404) {
						studyCache.set(key, "not-found");
						setState({ status: "not-found" });
						return;
					}
					// A credential problem is about the account, not the verse: the
					// server's own wording is the only useful thing to show, and
					// retrying it changes nothing.
					if (res.status === 403) {
						setState({ status: "error", message: message ?? ERROR_MESSAGE, retryable: false });
						return;
					}
					setState({ status: "error", message: ERROR_MESSAGE, retryable: true });
					return;
				}

				const parsed: unknown = await res.json();
				if (runIdRef.current !== id) return;
				if (!isVerseWordStudy(parsed)) {
					setState({ status: "error", message: ERROR_MESSAGE, retryable: true });
					return;
				}
				if (parsed.rows.length === 0) {
					// A 200 with no rows is the same answer as a 404 to a reader
					// (and to Android, which maps it the same way).
					studyCache.set(key, "not-found");
					setState({ status: "not-found" });
					return;
				}
				studyCache.set(key, parsed);
				setState({ status: "ready", study: parsed });
			} catch {
				if (runIdRef.current !== id || controller.signal.aborted) return;
				setState({ status: "error", message: ERROR_MESSAGE, retryable: true });
			}
		})();

		return () => controller.abort();
	}, [book, chapter, verse, attempt]);

	/** Re-asks for a study that failed. A cached answer was never a failure. */
	const retry = useCallback(() => setAttempt((count) => count + 1), []);

	/**
	 * Strong's entry for one number, fetched the first time a row carrying it is
	 * opened. Resolves to null on 404 or any failure, so the detail card falls
	 * back to the word's own gloss instead of showing an error inside itself.
	 */
	const fetchStrongs = useCallback(
		async (number: string): Promise<StrongsDetail | null> => {
			const exclude = verseKey(book, chapter, verse);
			const key = `${number}|${exclude}`;
			const cached = strongsCache.get(key);
			if (cached !== undefined) return cached;
			try {
				const res = await fetch(
					`/api/bible/strongs?number=${encodeURIComponent(number)}&examples=3&exclude=${exclude}`
				);
				if (!res.ok) {
					if (res.status === 404) strongsCache.set(key, null);
					return null;
				}
				const parsed: unknown = await res.json();
				if (!isStrongsDetail(parsed)) return null;
				strongsCache.set(key, parsed);
				return parsed;
			} catch {
				return null;
			}
		},
		[book, chapter, verse]
	);

	return { state, retry, fetchStrongs };
}
