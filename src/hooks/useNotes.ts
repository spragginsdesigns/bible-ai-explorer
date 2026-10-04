"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Note, Folder, Tag, NoteApiResponse, NoteLinks } from "@/types/notes";
import { toNote } from "@/types/notes";
import {
	clearOtherNotesCaches,
	mergeServerRows,
	readNotesCache,
	writeNotesCache,
	type NotesCacheSnapshot,
} from "@/components/notes/notesCache";

export type SortOption = "updatedAt" | "createdAt" | "title";

export interface UpdateNoteOptions {
	/**
	 * Let the PATCH outlive the page (pagehide / tab close). Browsers cap
	 * keepalive bodies at 64KB, so larger notes fall back to a normal request.
	 */
	keepalive?: boolean;
}

const KEEPALIVE_BODY_LIMIT = 60_000;
const PERSIST_DELAY_MS = 400;
const LOAD_ERROR = "Could not load your notes.";

/** Body fields belong to the editor, which keeps them dirty and retries; they are never rolled back. */
const BODY_FIELDS = new Set<keyof Note>(["content", "htmlContent", "plainText", "wordCount"]);

/** Android's per-mutation failure copy (useNoteEditorData.ts). */
function failureMessage(changes: Partial<Note>): string | null {
	if ("title" in changes) return "The title could not be saved.";
	if ("isPinned" in changes) return "The pin could not be saved.";
	if ("folderId" in changes) return "The move could not be saved.";
	if ("aliases" in changes) return "The aliases could not be saved.";
	if ("properties" in changes) return "The properties could not be saved.";
	return null;
}

function browserStorage(): Storage | null {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
}

/**
 * Outgoing wikilinks and backlinks for a note. The server owns link resolution;
 * the client never derives backlinks from loaded notes.
 */
export async function fetchNoteLinks(id: string): Promise<NoteLinks> {
	const res = await fetch(`/api/notes/${id}/links`);
	if (!res.ok) throw new Error("Failed to load links");
	const data: Partial<NoteLinks> = await res.json();
	return {
		outgoing: data.outgoing ?? [],
		backlinks: data.backlinks ?? [],
	};
}

/**
 * Notes library state for one signed-in user. Mirrors Android's
 * useNotesLibrary + notesStore: the per-user cache renders instantly, the
 * server load revalidates silently (again on every window focus), and every
 * optimistic mutation rolls back when the server rejects it.
 */
export function useNotes(userId: string) {
	const [initialCache] = useState<NotesCacheSnapshot | null>(() => {
		const storage = browserStorage();
		return storage ? readNotesCache(storage, userId) : null;
	});
	const [notes, setNotes] = useState<Note[]>(initialCache?.notes ?? []);
	const [folders, setFolders] = useState<Folder[]>(initialCache?.folders ?? []);
	const [tags, setTags] = useState<Tag[]>(initialCache?.tags ?? []);
	const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
	const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
	const [activeTagId, setActiveTagId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [sortBy, setSortBy] = useState<SortOption>("updatedAt");
	const [hasLoaded, setHasLoaded] = useState(false);
	const [isRetrying, setIsRetrying] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [mutationError, setMutationError] = useState<string | null>(null);

	const notesRef = useRef(notes);
	notesRef.current = notes;
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	// A logical clock: every local mutation and every load start takes the
	// next tick, so a snapshot can tell which rows changed after it was asked for.
	const clock = useRef(0);
	const touchedAt = useRef(new Map<string, number>());
	const touch = useCallback((id: string) => {
		clock.current += 1;
		touchedAt.current.set(id, clock.current);
		return clock.current;
	}, []);
	const isLatest = useCallback((id: string, tick: number) => touchedAt.current.get(id) === tick, []);

	const inFlight = useRef<Promise<void> | null>(null);
	const load = useCallback((): Promise<void> => {
		if (inFlight.current) return inFlight.current;
		clock.current += 1;
		const startedAt = clock.current;
		const run = (async () => {
			try {
				const [notesRes, foldersRes, tagsRes] = await Promise.all([
					fetch("/api/notes", { cache: "no-store" }),
					fetch("/api/folders", { cache: "no-store" }),
					fetch("/api/tags", { cache: "no-store" }),
				]);
				if (!notesRes.ok) throw new Error(LOAD_ERROR);
				const serverNotes = ((await notesRes.json()) as NoteApiResponse[]).map(toNote);
				const serverFolders = foldersRes.ok ? ((await foldersRes.json()) as Folder[]) : null;
				const serverTags = tagsRes.ok ? ((await tagsRes.json()) as Tag[]) : null;
				if (!mounted.current) return;
				const touched = touchedAt.current;
				setNotes((prev) => mergeServerRows(serverNotes, prev, touched, startedAt));
				if (serverFolders) {
					setFolders((prev) => mergeServerRows(serverFolders, prev, touched, startedAt));
				}
				if (serverTags) {
					setTags((prev) => mergeServerRows(serverTags, prev, touched, startedAt));
				}
				setLoadError(null);
			} catch {
				// Cached rows stay on screen; the error is only shown in place
				// of the list when there is nothing cached.
				if (mounted.current) setLoadError(LOAD_ERROR);
			} finally {
				inFlight.current = null;
				if (mounted.current) {
					setHasLoaded(true);
					setIsRetrying(false);
				}
			}
		})();
		inFlight.current = run;
		return run;
	}, []);

	useEffect(() => {
		const storage = browserStorage();
		if (storage) clearOtherNotesCaches(storage, userId);
		void load();
	}, [load, userId]);

	// Pick up edits made on Android (or another tab) when the window regains
	// focus; concurrent triggers share the one in-flight request.
	useEffect(() => {
		const revalidate = () => {
			if (document.visibilityState === "visible") void load();
		};
		window.addEventListener("focus", revalidate);
		document.addEventListener("visibilitychange", revalidate);
		return () => {
			window.removeEventListener("focus", revalidate);
			document.removeEventListener("visibilitychange", revalidate);
		};
	}, [load]);

	const retryLoad = useCallback(() => {
		setIsRetrying(true);
		setLoadError(null);
		void load();
	}, [load]);

	const hasLoadedRef = useRef(hasLoaded);
	hasLoadedRef.current = hasLoaded;

	// Persist the library per user, debounced so a burst of autosaves writes once.
	const snapshotRef = useRef<NotesCacheSnapshot>({ notes, folders, tags });
	snapshotRef.current = { notes, folders, tags };
	const canPersist = hasLoaded || initialCache !== null;
	useEffect(() => {
		if (!canPersist) return;
		const timer = setTimeout(() => {
			const storage = browserStorage();
			if (storage) writeNotesCache(storage, userId, snapshotRef.current);
		}, PERSIST_DELAY_MS);
		return () => clearTimeout(timer);
	}, [notes, folders, tags, canPersist, userId]);
	useEffect(
		() => () => {
			const storage = browserStorage();
			if (storage && (hasLoadedRef.current || initialCache !== null)) {
				writeNotesCache(storage, userId, snapshotRef.current);
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[userId]
	);

	const filteredNotes = notes.filter((note) => {
		if (activeFolderId && note.folderId !== activeFolderId) return false;
		if (activeTagId && !note.tagIds.includes(activeTagId)) return false;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			return (
				note.title.toLowerCase().includes(q) ||
				note.plainText.toLowerCase().includes(q) ||
				note.aliases.some((alias) => alias.toLowerCase().includes(q))
			);
		}
		return true;
	});

	const sortedNotes = [...filteredNotes].sort((a, b) => {
		// Pinned notes always first
		if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
		switch (sortBy) {
			case "updatedAt":
				return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
			case "createdAt":
				return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
			case "title":
				return a.title.localeCompare(b.title);
			default:
				return 0;
		}
	});

	const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;
	/** Whether the library (ignoring search and filters) holds this note. */
	const noteExists = useCallback((id: string) => notes.some((n) => n.id === id), [notes]);

	const createNote = useCallback(async (
		folderId?: string | null,
		title?: string,
		seed?: { content: string; html: string; plainText: string; wordCount: number } | null
	): Promise<Note> => {
		const body = {
			title: title?.trim() || "Untitled Note",
			content: seed?.content ?? "",
			htmlContent: seed?.html ?? "",
			plainText: seed?.plainText ?? "",
			folderId: folderId === undefined ? activeFolderId : folderId,
			wordCount: seed?.wordCount ?? 0,
		};

		const res = await fetch("/api/notes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!res.ok) throw new Error("Failed to create note");
		const data: NoteApiResponse = await res.json();
		const note = toNote(data);
		touch(note.id);
		setNotes((prev) => [note, ...prev.filter((n) => n.id !== note.id)]);
		setActiveNoteId(note.id);
		return note;
	}, [activeFolderId, touch]);

	const updateNote = useCallback(async (
		id: string,
		changes: Partial<Note>,
		options?: UpdateNoteOptions
	): Promise<boolean> => {
		const previous = notesRef.current.find((n) => n.id === id);
		const tick = touch(id);
		// Optimistic update
		setNotes((prev) =>
			prev.map((n) =>
				n.id === id ? { ...n, ...changes, updatedAt: new Date().toISOString() } : n
			)
		);

		try {
			const body = JSON.stringify(changes);
			const res = await fetch(`/api/notes/${id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body,
				keepalive: options?.keepalive === true && body.length < KEEPALIVE_BODY_LIMIT,
			});

			if (!res.ok) throw new Error("PATCH rejected");
			const data: NoteApiResponse = await res.json();
			const updated = toNote(data);
			// A newer local change to this note is still in flight; its own
			// response will reconcile the row.
			if (mounted.current && isLatest(id, tick)) {
				setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
			}
			return true;
		} catch {
			if (!mounted.current) return false;
			if (previous && isLatest(id, tick)) {
				const restore: Partial<Note> = {};
				let changed = false;
				for (const key of Object.keys(changes) as (keyof Note)[]) {
					if (BODY_FIELDS.has(key)) continue;
					Object.assign(restore, { [key]: previous[key] });
					changed = true;
				}
				if (changed) {
					setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...restore } : n)));
				}
			}
			const message = failureMessage(changes);
			if (message) setMutationError(message);
			return false;
		}
	}, [touch, isLatest]);

	const deleteNote = useCallback(async (id: string): Promise<boolean> => {
		const index = notesRef.current.findIndex((n) => n.id === id);
		const previous = index >= 0 ? notesRef.current[index] : null;
		touch(id);
		setNotes((prev) => prev.filter((n) => n.id !== id));
		setActiveNoteId((current) => (current === id ? null : current));

		try {
			const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
			if (!res.ok) throw new Error("DELETE rejected");
			return true;
		} catch {
			if (!mounted.current) return false;
			// A failed delete puts the note back where it was, so the list shows it did not go.
			if (previous) {
				touch(id);
				setNotes((prev) => {
					if (prev.some((n) => n.id === id)) return prev;
					const next = [...prev];
					next.splice(Math.min(index, next.length), 0, previous);
					return next;
				});
			}
			setMutationError("The note could not be deleted.");
			return false;
		}
	}, [touch]);

	const togglePin = useCallback(async (id: string): Promise<boolean> => {
		const note = notesRef.current.find((n) => n.id === id);
		if (!note) return false;
		return updateNote(id, { isPinned: !note.isPinned });
	}, [updateNote]);

	const moveNoteToFolder = useCallback(
		(id: string, folderId: string | null) => updateNote(id, { folderId }),
		[updateNote]
	);

	// Folder CRUD
	const createFolder = useCallback(async (name: string): Promise<Folder> => {
		const res = await fetch("/api/folders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		});

		if (!res.ok) throw new Error("Failed to create folder");
		const folder: Folder = await res.json();
		touch(folder.id);
		setFolders((prev) => [...prev, folder]);
		return folder;
	}, [touch]);

	const renameFolder = useCallback(async (id: string, name: string) => {
		touch(id);
		setFolders((prev) =>
			prev.map((f) => (f.id === id ? { ...f, name } : f))
		);

		const res = await fetch(`/api/folders/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		}).catch(() => null);
		if (!res?.ok) void load();
	}, [touch, load]);

	const deleteFolder = useCallback(async (id: string) => {
		touch(id);
		// Move notes to unfiled locally
		setNotes((prev) =>
			prev.map((n) => (n.folderId === id ? { ...n, folderId: null } : n))
		);
		setFolders((prev) => prev.filter((f) => f.id !== id));
		if (activeFolderId === id) setActiveFolderId(null);

		const res = await fetch(`/api/folders/${id}`, { method: "DELETE" }).catch(() => null);
		if (!res?.ok) void load();
	}, [activeFolderId, touch, load]);

	// Tag CRUD
	const createTag = useCallback(async (name: string, color: string): Promise<Tag> => {
		const res = await fetch("/api/tags", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, color }),
		});

		if (!res.ok) throw new Error("Failed to create tag");
		const tag: Tag = await res.json();
		touch(tag.id);
		setTags((prev) => [...prev, tag]);
		return tag;
	}, [touch]);

	const deleteTag = useCallback(async (id: string) => {
		touch(id);
		// Remove tag from all notes locally
		setNotes((prev) =>
			prev.map((n) => ({
				...n,
				tagIds: n.tagIds.filter((t) => t !== id),
			}))
		);
		setTags((prev) => prev.filter((t) => t.id !== id));
		if (activeTagId === id) setActiveTagId(null);

		const res = await fetch(`/api/tags/${id}`, { method: "DELETE" }).catch(() => null);
		if (!res?.ok) void load();
	}, [activeTagId, touch, load]);

	const toggleNoteTag = useCallback(async (noteId: string, tagId: string): Promise<boolean> => {
		const note = notesRef.current.find((n) => n.id === noteId);
		if (!note) return false;
		const previousTagIds = note.tagIds;
		const hasTag = previousTagIds.includes(tagId);
		const tick = touch(noteId);

		// Optimistic update
		setNotes((prev) =>
			prev.map((n) =>
				n.id === noteId
					? {
							...n,
							tagIds: hasTag
								? n.tagIds.filter((t) => t !== tagId)
								: [...n.tagIds, tagId],
						}
					: n
			)
		);

		try {
			const res = await fetch(`/api/notes/${noteId}/tags/${tagId}`, { method: "POST" });
			if (!res.ok) throw new Error("Tag toggle rejected");
			// The route toggles server-side; trust its answer over our guess.
			const data = (await res.json().catch(() => null)) as { action?: string } | null;
			if (mounted.current && data?.action && isLatest(noteId, tick)) {
				const added = data.action === "added";
				setNotes((prev) =>
					prev.map((n) => {
						if (n.id !== noteId) return n;
						const without = n.tagIds.filter((t) => t !== tagId);
						return { ...n, tagIds: added ? [...without, tagId] : without };
					})
				);
			}
			return true;
		} catch {
			if (!mounted.current) return false;
			if (isLatest(noteId, tick)) {
				setNotes((prev) =>
					prev.map((n) => (n.id === noteId ? { ...n, tagIds: previousTagIds } : n))
				);
			}
			setMutationError("The tag could not be saved.");
			return false;
		}
	}, [touch, isLatest]);

	const clearMutationError = useCallback(() => setMutationError(null), []);

	return {
		notes: sortedNotes,
		/** The whole library, for wikilink resolution and the link picker. */
		allNotes: notes,
		totalNotes: notes.length,
		folders,
		tags,
		activeNote,
		activeNoteId,
		activeFolderId,
		activeTagId,
		searchQuery,
		sortBy,
		// The spinner is reserved for a first load with nothing cached to show.
		isLoading: (!hasLoaded && notes.length === 0) || isRetrying,
		hasLoaded,
		loadError,
		mutationError,
		retryLoad,
		clearMutationError,
		noteExists,
		setActiveNoteId,
		setActiveFolderId,
		setActiveTagId,
		setSearchQuery,
		setSortBy,
		createNote,
		updateNote,
		deleteNote,
		togglePin,
		moveNoteToFolder,
		createFolder,
		renameFolder,
		deleteFolder,
		createTag,
		deleteTag,
		toggleNoteTag,
	};
}
