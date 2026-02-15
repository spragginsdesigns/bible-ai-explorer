"use client";

import { useState, useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { notesDb } from "@/lib/notesDb";
import type { Note, Folder, Tag } from "@/types/notes";

export type SortOption = "updatedAt" | "createdAt" | "title";

export function useNotes() {
	const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
	const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
	const [activeTagId, setActiveTagId] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [sortBy, setSortBy] = useState<SortOption>("updatedAt");

	const notes = useLiveQuery(
		() => notesDb.notes.orderBy("updatedAt").reverse().toArray(),
		[]
	);

	const folders = useLiveQuery(
		() => notesDb.folders.orderBy("sortOrder").toArray(),
		[]
	);

	const tags = useLiveQuery(() => notesDb.tags.toArray(), []);

	const filteredNotes = (notes ?? []).filter((note) => {
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
				return b.updatedAt - a.updatedAt;
			case "createdAt":
				return b.createdAt - a.createdAt;
			case "title":
				return a.title.localeCompare(b.title);
			default:
				return 0;
		}
	});

	const activeNote = (notes ?? []).find((n) => n.id === activeNoteId) ?? null;

	const createNote = useCallback(async (folderId?: string | null): Promise<Note> => {
		const now = Date.now();
		const note: Note = {
			id: crypto.randomUUID(),
			title: "Untitled Note",
			content: "",
			htmlContent: "",
			plainText: "",
			folderId: folderId ?? activeFolderId,
			tagIds: [],
			createdAt: now,
			updatedAt: now,
			isPinned: false,
			wordCount: 0,
		};
		await notesDb.notes.add(note);
		setActiveNoteId(note.id);
		return note;
	}, [activeFolderId]);

	const updateNote = useCallback(async (id: string, changes: Partial<Note>) => {
		await notesDb.notes.update(id, {
			...changes,
			updatedAt: Date.now(),
		});
	}, []);

	const deleteNote = useCallback(async (id: string) => {
		await notesDb.notes.delete(id);
		await notesDb.noteAIMessages.where("noteId").equals(id).delete();
		if (activeNoteId === id) setActiveNoteId(null);
	}, [activeNoteId]);

	const togglePin = useCallback(async (id: string) => {
		const note = await notesDb.notes.get(id);
		if (note) {
			await notesDb.notes.update(id, { isPinned: !note.isPinned });
		}
	}, []);

	// Folder CRUD
	const createFolder = useCallback(async (name: string): Promise<Folder> => {
		const existing = await notesDb.folders.toArray();
		const folder: Folder = {
			id: crypto.randomUUID(),
			name,
			parentId: null,
			sortOrder: existing.length,
			createdAt: Date.now(),
		};
		await notesDb.folders.add(folder);
		return folder;
	}, []);

	const renameFolder = useCallback(async (id: string, name: string) => {
		await notesDb.folders.update(id, { name });
	}, []);

	const deleteFolder = useCallback(async (id: string) => {
		// Move notes in this folder to unfiled
		await notesDb.notes.where("folderId").equals(id).modify({ folderId: null });
		await notesDb.folders.delete(id);
		if (activeFolderId === id) setActiveFolderId(null);
	}, [activeFolderId]);

	// Tag CRUD
	const createTag = useCallback(async (name: string, color: string): Promise<Tag> => {
		const tag: Tag = {
			id: crypto.randomUUID(),
			name,
			color,
			createdAt: Date.now(),
		};
		await notesDb.tags.add(tag);
		return tag;
	}, []);

	const deleteTag = useCallback(async (id: string) => {
		// Remove tag from all notes
		const notesWithTag = await notesDb.notes.where("tagIds").equals(id).toArray();
		for (const note of notesWithTag) {
			await notesDb.notes.update(note.id, {
				tagIds: note.tagIds.filter((t) => t !== id),
			});
		}
		await notesDb.tags.delete(id);
		if (activeTagId === id) setActiveTagId(null);
	}, [activeTagId]);

	const toggleNoteTag = useCallback(async (noteId: string, tagId: string) => {
		const note = await notesDb.notes.get(noteId);
		if (!note) return;
		const hasTag = note.tagIds.includes(tagId);
		await notesDb.notes.update(noteId, {
			tagIds: hasTag
				? note.tagIds.filter((t) => t !== tagId)
				: [...note.tagIds, tagId],
		});
	}, []);

	return {
		notes: sortedNotes,
		folders: folders ?? [],
		tags: tags ?? [],
		activeNote,
		activeNoteId,
		activeFolderId,
		activeTagId,
		searchQuery,
		sortBy,
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
