import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import { toNote, type Folder, type Note, type Tag } from "./types";
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
 */
export function useNotesLibrary() {
	const getToken = useStableGetToken();

	const [notes, setNotes] = useState<Note[]>([]);
	const [folders, setFolders] = useState<Folder[]>([]);
	const [tags, setTags] = useState<Tag[]>([]);
	const [isLoading, setIsLoading] = useState(true);
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
		async (mode: "initial" | "refresh") => {
			if (mode === "refresh") setIsRefreshing(true);
			try {
				const [noteRows, folderRows, tagRows] = await Promise.all([
					api.fetchNotes(getToken),
					api.fetchFolders(getToken),
					api.fetchTags(getToken),
				]);
				if (!mounted.current) return;
				setNotes(noteRows.map(toNote));
				setFolders(folderRows);
				setTags(tagRows);
				setError(null);
			} catch (err) {
				if (!mounted.current) return;
				setError(err instanceof Error ? err.message : "Could not load your notes.");
			} finally {
				if (!mounted.current) return;
				setIsLoading(false);
				setIsRefreshing(false);
			}
		},
		[getToken]
	);

	useEffect(() => {
		void load("initial");
	}, [load]);

	const refresh = useCallback(() => load("refresh"), [load]);

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
		setNotes((prev) => [created, ...prev]);
		return created;
	}, [getToken, activeFolderId]);

	const deleteNote = useCallback(
		async (id: string) => {
			const previous = notes;
			setNotes((prev) => prev.filter((note) => note.id !== id));
			try {
				await api.deleteNote(getToken, id);
			} catch {
				setNotes(previous);
			}
		},
		[getToken, notes]
	);

	const patchNoteLocal = useCallback((id: string, changes: Partial<Note>) => {
		setNotes((prev) => prev.map((note) => (note.id === id ? { ...note, ...changes } : note)));
	}, []);

	const togglePin = useCallback(
		async (id: string) => {
			const note = notes.find((entry) => entry.id === id);
			if (!note) return;
			const isPinned = !note.isPinned;
			patchNoteLocal(id, { isPinned });
			try {
				await api.patchNote(getToken, id, { isPinned });
			} catch {
				patchNoteLocal(id, { isPinned: note.isPinned });
			}
		},
		[getToken, notes, patchNoteLocal]
	);

	const moveNoteToFolder = useCallback(
		async (id: string, folderId: string | null) => {
			const note = notes.find((entry) => entry.id === id);
			if (!note) return;
			patchNoteLocal(id, { folderId });
			try {
				await api.patchNote(getToken, id, { folderId });
			} catch {
				patchNoteLocal(id, { folderId: note.folderId });
			}
		},
		[getToken, notes, patchNoteLocal]
	);

	const createFolder = useCallback(
		async (name: string) => {
			const folder = await api.createFolder(getToken, name);
			setFolders((prev) => [...prev, folder]);
			return folder;
		},
		[getToken]
	);

	const deleteFolder = useCallback(
		async (id: string) => {
			setFolders((prev) => prev.filter((folder) => folder.id !== id));
			setNotes((prev) =>
				prev.map((note) => (note.folderId === id ? { ...note, folderId: null } : note))
			);
			setActiveFolderId((current) => (current === id ? null : current));
			await api.deleteFolder(getToken, id);
		},
		[getToken]
	);

	const createTag = useCallback(
		async (name: string, color: string) => {
			const tag = await api.createTag(getToken, name, color);
			setTags((prev) => [...prev, tag]);
			return tag;
		},
		[getToken]
	);

	const deleteTag = useCallback(
		async (id: string) => {
			setTags((prev) => prev.filter((tag) => tag.id !== id));
			setNotes((prev) =>
				prev.map((note) => ({ ...note, tagIds: note.tagIds.filter((tagId) => tagId !== id) }))
			);
			setActiveTagId((current) => (current === id ? null : current));
			await api.deleteTag(getToken, id);
		},
		[getToken]
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
