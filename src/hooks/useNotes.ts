"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { Note, Folder, Tag, NoteApiResponse } from "@/types/notes";
import { toNote } from "@/types/notes";

export type SortOption = "updatedAt" | "createdAt" | "title";

export function useNotes() {
	const [notes, setNotes] = useState<Note[]>([]);
	const [folders, setFolders] = useState<Folder[]>([]);
	const [tags, setTags] = useState<Tag[]>([]);
	const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
	const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
	const [activeTagId, setActiveTagId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [sortBy, setSortBy] = useState<SortOption>("updatedAt");
	const [isLoading, setIsLoading] = useState(true);
	const initialized = useRef(false);

	// Load all data from API on mount
	useEffect(() => {
		if (initialized.current) return;
		initialized.current = true;

		(async () => {
			try {
				const [notesRes, foldersRes, tagsRes] = await Promise.all([
					fetch("/api/notes"),
					fetch("/api/folders"),
					fetch("/api/tags"),
				]);

				if (notesRes.ok) {
					const data: NoteApiResponse[] = await notesRes.json();
					setNotes(data.map(toNote));
				}
				if (foldersRes.ok) {
					setFolders(await foldersRes.json());
				}
				if (tagsRes.ok) {
					setTags(await tagsRes.json());
				}
			} catch {
				// Silent fail
			} finally {
				setIsLoading(false);
			}
		})();
	}, []);

	const filteredNotes = notes.filter((note) => {
		if (activeFolderId && note.folderId !== activeFolderId) return false;
		if (activeTagId && !note.tagIds.includes(activeTagId)) return false;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			return (
				note.title.toLowerCase().includes(q) ||
				note.plainText.toLowerCase().includes(q)
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

	const createNote = useCallback(async (folderId?: string | null): Promise<Note> => {
		const body = {
			title: "Untitled Note",
			content: "",
			htmlContent: "",
			plainText: "",
			folderId: folderId ?? activeFolderId,
			wordCount: 0,
		};

		const res = await fetch("/api/notes", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		if (!res.ok) throw new Error("Failed to create note");
		const data: NoteApiResponse = await res.json();
		const note = toNote(data);
		setNotes((prev) => [note, ...prev]);
		setActiveNoteId(note.id);
		return note;
	}, [activeFolderId]);

	const updateNote = useCallback(async (id: string, changes: Partial<Note>) => {
		// Optimistic update
		setNotes((prev) =>
			prev.map((n) =>
				n.id === id ? { ...n, ...changes, updatedAt: new Date().toISOString() } : n
			)
		);

		const res = await fetch(`/api/notes/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(changes),
		});

		if (res.ok) {
			const data: NoteApiResponse = await res.json();
			const updated = toNote(data);
			setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
		}
	}, []);

	const deleteNote = useCallback(async (id: string) => {
		setNotes((prev) => prev.filter((n) => n.id !== id));
		if (activeNoteId === id) setActiveNoteId(null);

		await fetch(`/api/notes/${id}`, { method: "DELETE" });
	}, [activeNoteId]);

	const togglePin = useCallback(async (id: string) => {
		const note = notes.find((n) => n.id === id);
		if (!note) return;
		const newPinned = !note.isPinned;

		setNotes((prev) =>
			prev.map((n) => (n.id === id ? { ...n, isPinned: newPinned } : n))
		);

		await fetch(`/api/notes/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ isPinned: newPinned }),
		});
	}, [notes]);

	// Folder CRUD
	const createFolder = useCallback(async (name: string): Promise<Folder> => {
		const res = await fetch("/api/folders", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		});

		if (!res.ok) throw new Error("Failed to create folder");
		const folder: Folder = await res.json();
		setFolders((prev) => [...prev, folder]);
		return folder;
	}, []);

	const renameFolder = useCallback(async (id: string, name: string) => {
		setFolders((prev) =>
			prev.map((f) => (f.id === id ? { ...f, name } : f))
		);

		await fetch(`/api/folders/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name }),
		});
	}, []);

	const deleteFolder = useCallback(async (id: string) => {
		// Move notes to unfiled locally
		setNotes((prev) =>
			prev.map((n) => (n.folderId === id ? { ...n, folderId: null } : n))
		);
		setFolders((prev) => prev.filter((f) => f.id !== id));
		if (activeFolderId === id) setActiveFolderId(null);

		await fetch(`/api/folders/${id}`, { method: "DELETE" });
	}, [activeFolderId]);

	// Tag CRUD
	const createTag = useCallback(async (name: string, color: string): Promise<Tag> => {
		const res = await fetch("/api/tags", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, color }),
		});

		if (!res.ok) throw new Error("Failed to create tag");
		const tag: Tag = await res.json();
		setTags((prev) => [...prev, tag]);
		return tag;
	}, []);

	const deleteTag = useCallback(async (id: string) => {
		// Remove tag from all notes locally
		setNotes((prev) =>
			prev.map((n) => ({
				...n,
				tagIds: n.tagIds.filter((t) => t !== id),
			}))
		);
		setTags((prev) => prev.filter((t) => t.id !== id));
		if (activeTagId === id) setActiveTagId(null);

		await fetch(`/api/tags/${id}`, { method: "DELETE" });
	}, [activeTagId]);

	const toggleNoteTag = useCallback(async (noteId: string, tagId: string) => {
		const note = notes.find((n) => n.id === noteId);
		if (!note) return;
		const hasTag = note.tagIds.includes(tagId);

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

		await fetch(`/api/notes/${noteId}/tags/${tagId}`, { method: "POST" });
	}, [notes]);

	return {
		notes: sortedNotes,
		folders,
		tags,
		activeNote,
		activeNoteId,
		activeFolderId,
		activeTagId,
		searchQuery,
		sortBy,
		isLoading,
		setActiveNoteId,
		setActiveFolderId,
		setActiveTagId,
		setSearchQuery,
		setSortBy,
		createNote,
		updateNote,
		deleteNote,
		togglePin,
		createFolder,
		renameFolder,
		deleteFolder,
		createTag,
		deleteTag,
		toggleNoteTag,
	};
}
