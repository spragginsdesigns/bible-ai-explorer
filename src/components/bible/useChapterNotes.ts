"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	matchChapterNotes,
	versesWithNotes,
	type ChapterNoteSummary,
	type MatchedChapterNote,
} from "@/lib/bible/chapterNotes";
import { readNotesCache } from "@/components/notes/notesCache";

const sessionNotesByUser = new Map<string, ChapterNoteSummary[]>();

interface UseChapterNotesOptions {
	userId: string | null | undefined;
	bookName: string;
	bookAbbr?: string;
	chapter: number;
	verseCount: number;
}

export interface UseChapterNotesResult {
	matches: MatchedChapterNote[];
	notedVerses: Set<number>;
	refresh: () => Promise<void>;
}

/**
 * Loads the signed-in reader's note summaries from localStorage (instant 0ms
 * first paint) and revalidates against `GET /api/notes?summary=1` in the
 * background, returning the notes that reference the active chapter and the
 * 1-based set of verses with notes.
 */
export function useChapterNotes({
	userId,
	bookName,
	bookAbbr,
	chapter,
	verseCount,
}: UseChapterNotesOptions): UseChapterNotesResult {
	const [notes, setNotes] = useState<ChapterNoteSummary[]>(() => {
		if (!userId) return [];
		const inMemory = sessionNotesByUser.get(userId);
		if (inMemory) return inMemory;
		if (typeof window !== "undefined") {
			const cached = readNotesCache(window.localStorage, userId);
			if (cached) return cached.notes;
		}
		return [];
	});
	const requestId = useRef(0);

	const refresh = useCallback(async () => {
		const id = ++requestId.current;
		if (!userId) {
			setNotes([]);
			return;
		}
		try {
			const res = await fetch("/api/notes?summary=1");
			if (!res.ok) return;
			const data = (await res.json()) as unknown;
			if (!Array.isArray(data) || requestId.current !== id) return;
			const summaries: ChapterNoteSummary[] = data
				.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
				.filter(
					(item) =>
						typeof item.id === "string" &&
						typeof item.title === "string" &&
						typeof item.updatedAt === "string"
				)
				.map((item) => ({
					id: item.id as string,
					title: item.title as string,
					plainText: typeof item.plainText === "string" ? item.plainText : "",
					updatedAt: item.updatedAt as string,
				}));
			sessionNotesByUser.set(userId, summaries);
			setNotes(summaries);
		} catch {
			// Fail-soft: keep any cached notes and never disrupt the chapter reader.
		}
	}, [userId]);

	useEffect(() => {
		if (!userId) {
			setNotes([]);
			return;
		}
		const cached = sessionNotesByUser.get(userId);
		if (cached) {
			setNotes(cached);
		} else if (typeof window !== "undefined") {
			const stored = readNotesCache(window.localStorage, userId);
			if (stored) setNotes(stored.notes);
		}
		void refresh();
	}, [userId, refresh]);

	const matches = useMemo(
		() => matchChapterNotes(notes, { bookName, bookAbbr, chapter, verseCount }),
		[notes, bookName, bookAbbr, chapter, verseCount]
	);

	const notedVerses = useMemo(() => versesWithNotes(matches), [matches]);

	return { matches, notedVerses, refresh };
}
