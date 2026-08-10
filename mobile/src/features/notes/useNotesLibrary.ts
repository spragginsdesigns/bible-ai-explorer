import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as api from "./api";
import {
	addFolderToCache,
	addTagToCache,
	applyServerSnapshot,
	hydrateNotesCache,
	patchNoteInCache,
	removeFolderFromCache,
	removeNoteFromCache,
	removeTagFromCache,
	upsertNoteInCache,
	useNotesSnapshot,
} from "./notesStore";
import { toNote, type Note, type Tag } from "./types";
import { useStableGetToken } from "./useStableGetToken";

export type NoteSort = "updatedAt" | "createdAt" | "title";

export const SORT_LABELS: Record<NoteSort, string> = {
	updatedAt: "Modified",
	createdAt: "Created",
	title: "Title",
};

const SORT_ORDER: NoteSort[] = ["updatedAt", "createdAt", "title"];

export function nextSort(sort: NoteSort): NoteSort {
	return SORT_ORDER[(SORT_ORDER.indexOf(sort) + 1) % SORT_ORDER.length];
}

/**
 * List-screen data layer: notes + folders + tags with local filtering and the
 * same pinned-first sorting the web useNotes hook applies.
 *
 * Data lives in the shared persisted notesStore, so the list renders the cached
 * snapshot instantly and every fetch is a silent background revalidation - only
 * an explicit pull-to-refresh shows a spinner.
 */
export function useNotesLibrary() {
	const getToken = useStableGetToken();
	const { notes, folders, tags, hydrated } = useNotesSnapshot();

	const [hasLoaded, setHasLoaded] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [searchQuery, setSearchQuery] = useState("");
	const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
	const [activeTagId, setActiveTagId] = useState<string | null>(null);
	const [sortBy, setSortBy] = useState<NoteSort>("updatedAt");

	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const load = useCallback(
		async (mode: "initial" | "refresh" | "silent") => {
			if (mode === "refresh") setIsRefreshing(true);
			try {
				const [noteRows, folderRows, tagRows] = await Promise.all([
					api.fetchNotes(getToken),
					api.fetchFolders(getToken),
					api.fetchTags(getToken),
				]);
				if (!mounted.current) return;
				applyServerSnapshot(noteRows.map(toNote), folderRows, tagRows);
				setError(null);
			} catch (err) {
				if (!mounted.current) return;
				// Cached data stays on screen; only surface errors when there is
				// nothing cached to show.
				setError(err instanceof Error ? err.message : "Could not load your notes.");
			} finally {
				if (!mounted.current) return;
				setHasLoaded(true);
				setIsRefreshing(false);
			}
		},
		[getToken]
	);

	useEffect(() => {
		void hydrateNotesCache().then(() => {
			if (mounted.current) void load("initial");
		});
	}, [load]);

	// Pick up edits made on the web (or another device) when the app returns
	// to the foreground.
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state === "active") void load("silent");
		});
		return () => subscription.remove();
	}, [load]);

	/** Pull-to-refresh: the only mode that shows a spinner. */
	const refresh = useCallback(() => load("refresh"), [load]);
	/** Focus/foreground revalidation: silent, cached data stays put. */
	const revalidate = useCallback(() => load("silent"), [load]);

	// With a hydrated cache there is something to show immediately; the spinner
	// is reserved for a first-ever load with nothing cached.
	const isLoading = !hydrated || (!hasLoaded && notes.length === 0);

	const visibleNotes = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		const filtered = notes.filter((note) => {
			if (activeFolderId && note.folderId !== activeFolderId) return false;
			if (activeTagId && !note.tagIds.includes(activeTagId)) return false;
			if (!query) return true;
			return (
				note.title.toLowerCase().includes(query) ||
				note.plainText.toLowerCase().includes(query)
			);
		});

		return filtered.sort((a, b) => {
			if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
			switch (sortBy) {
				case "createdAt":
					return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
				case "title":
					return a.title.localeCompare(b.title);
				default:
					return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
			}
		});
	}, [notes, searchQuery, activeFolderId, activeTagId, sortBy]);

	const createNote = useCallback(async (): Promise<Note> => {
		const created = toNote(
			await api.createNote(getToken, { title: "Untitled Note", folderId: activeFolderId })
		);
		upsertNoteInCache({ ...created, hasBody: true });
		return created;
	}, [getToken, activeFolderId]);

	const deleteNote = useCallback(
		async (id: string) => {
			removeNoteFromCache(id);
			try {
				await api.deleteNote(getToken, id);
			} catch {
				void load("silent");
			}
		},
		[getToken, load]
	);

	const togglePin = useCallback(
		async (id: string) => {
			const note = notes.find((entry) => entry.id === id);
			if (!note) return;
			const isPinned = !note.isPinned;
			patchNoteInCache(id, { isPinned });
			try {
				await api.patchNote(getToken, id, { isPinned });
			} catch {
				patchNoteInCache(id, { isPinned: note.isPinned });
			}
		},
		[getToken, notes]
	);

	const moveNoteToFolder = useCallback(
		async (id: string, folderId: string | null) => {
			const note = notes.find((entry) => entry.id === id);
			if (!note) return;
			patchNoteInCache(id, { folderId });
			try {
				await api.patchNote(getToken, id, { folderId });
			} catch {
				patchNoteInCache(id, { folderId: note.folderId });
			}
		},
		[getToken, notes]
	);

	const createFolder = useCallback(
		async (name: string) => {
			const folder = await api.createFolder(getToken, name);
			addFolderToCache(folder);
			return folder;
		},
		[getToken]
	);

	const deleteFolder = useCallback(
		async (id: string) => {
			removeFolderFromCache(id);
			setActiveFolderId((current) => (current === id ? null : current));
			try {
				await api.deleteFolder(getToken, id);
			} catch {
				void load("silent");
			}
		},
		[getToken, load]
	);

	const createTag = useCallback(
		async (name: string, color: string) => {
			const tag: Tag = await api.createTag(getToken, name, color);
			addTagToCache(tag);
			return tag;
		},
		[getToken]
	);

	const deleteTag = useCallback(
		async (id: string) => {
			removeTagFromCache(id);
			setActiveTagId((current) => (current === id ? null : current));
			try {
				await api.deleteTag(getToken, id);
			} catch {
				void load("silent");
			}
		},
		[getToken, load]
	);

	return {
		notes: visibleNotes,
		totalNotes: notes.length,
		folders,
		tags,
		isLoading,
		isRefreshing,
		error,
		searchQuery,
		activeFolderId,
		activeTagId,
		sortBy,
		setSearchQuery,
		setActiveFolderId,
		setActiveTagId,
		setSortBy,
		refresh,
		revalidate,
		createNote,
		deleteNote,
		togglePin,
		moveNoteToFolder,
		createFolder,
		deleteFolder,
		createTag,
		deleteTag,
	};
}
