import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/expo";
import type { GetToken } from "@/lib/api";
import { fetchNotes } from "@/features/notes/api";
import { hydrateNotesCache, useNotesSnapshot } from "@/features/notes/notesStore";
import {
	matchChapterNotes,
	versesWithNotes,
	type ChapterNoteSummary,
	type MatchedChapterNote,
} from "./chapterNotes";

const sessionNotesByUser = new Map<string, ChapterNoteSummary[]>();

interface UseChapterNotesOptions {
	getToken: GetToken;
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
 * Links the signed-in user's notes to the chapter currently open in the reader.
 * Reads the persisted `notesStore` snapshot immediately (0ms offline/first paint)
 * and silently revalidates `/api/notes?summary=1` in the background.
 */
export function useChapterNotes({
	getToken,
	bookName,
	bookAbbr,
	chapter,
	verseCount,
}: UseChapterNotesOptions): UseChapterNotesResult {
	const { isLoaded, isSignedIn, userId } = useAuth();
	const storeSnapshot = useNotesSnapshot();
	const [fetchedNotes, setFetchedNotes] = useState<ChapterNoteSummary[] | null>(() =>
		userId ? sessionNotesByUser.get(userId) ?? null : null
	);
	const requestId = useRef(0);

	useEffect(() => {
		void hydrateNotesCache();
	}, []);

	const refresh = useCallback(async () => {
		const id = ++requestId.current;
		if (!isLoaded || !isSignedIn || !userId) {
			setFetchedNotes(null);
			return;
		}
		try {
			const rows = await fetchNotes(getToken);
			if (requestId.current !== id) return;
			const summaries: ChapterNoteSummary[] = rows.map((row) => ({
				id: row.id,
				title: row.title,
				plainText: row.plainText ?? "",
				updatedAt: row.updatedAt,
			}));
			sessionNotesByUser.set(userId, summaries);
			setFetchedNotes(summaries);
		} catch {
			// Fail-soft: fall back to the persisted notesStore snapshot.
		}
	}, [getToken, isLoaded, isSignedIn, userId]);

	useEffect(() => {
		if (!isLoaded || !isSignedIn || !userId) {
			setFetchedNotes(null);
			return;
		}
		const existing = sessionNotesByUser.get(userId);
		if (existing) setFetchedNotes(existing);
		void refresh();
	}, [isLoaded, isSignedIn, userId, refresh]);

	const activeNotes = useMemo<ChapterNoteSummary[]>(() => {
		if (!isSignedIn || !userId) return [];
		if (fetchedNotes) return fetchedNotes;
		return storeSnapshot.notes.map((note) => ({
			id: note.id,
			title: note.title,
			plainText: note.plainText,
			updatedAt: note.updatedAt,
		}));
	}, [isSignedIn, userId, fetchedNotes, storeSnapshot.notes]);

	const matches = useMemo(
		() => matchChapterNotes(activeNotes, { bookName, bookAbbr, chapter, verseCount }),
		[activeNotes, bookName, bookAbbr, chapter, verseCount]
	);

	const notedVerses = useMemo(() => versesWithNotes(matches), [matches]);

	return { matches, notedVerses, refresh };
}
