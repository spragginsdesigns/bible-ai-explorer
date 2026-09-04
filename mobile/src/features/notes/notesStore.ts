import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import type { Folder, Note, Tag } from "./types";

/**
 * Shared, persisted cache for the notes library. Both the list screen and the
 * note editor read from and write through to this module-level store, so:
 *
 * - the list renders the last snapshot instantly (hydrated from AsyncStorage)
 *   and revalidates silently in the background;
 * - the editor opens a previously-seen note without a spinner;
 * - edits made in the editor are visible in the list immediately, no
 *   pull-to-refresh needed.
 *
 * List fetches return summary rows (no content/htmlContent). Note bodies are
 * merged in from single-note fetches and saves; `hasBody` marks entries whose
 * body fields are real rather than summary placeholders.
 */

// v2: v1 rows predate `aliases`/`properties`, and reading one back would hand
// the UI a Note whose array fields are undefined. Dropping the old cache costs
// one silent revalidation.
const STORAGE_KEY = "sureword.notes-cache.v2";

export interface NotesSnapshot {
	notes: Note[];
	folders: Folder[];
	tags: Tag[];
	/** True once the persisted cache has been read (or found absent). */
	hydrated: boolean;
}

let snapshot: NotesSnapshot = { notes: [], folders: [], tags: [], hydrated: false };

const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function persist() {
	AsyncStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({ notes: snapshot.notes, folders: snapshot.folders, tags: snapshot.tags })
	).catch(() => {
		// A full/unavailable store must never break the UI.
	});
}

function setSnapshot(next: Omit<NotesSnapshot, "hydrated">) {
	snapshot = { ...next, hydrated: true };
	persist();
	emit();
}

let hydratePromise: Promise<void> | null = null;

/**
 * Bumped by every clear. A read issued before a clear is still in flight after
 * it, and would otherwise resolve straight into setSnapshot and hand the new
 * account the previous account's notes.
 */
let generation = 0;

/** Read the persisted cache exactly once per app run. */
export function hydrateNotesCache(): Promise<void> {
	if (!hydratePromise) {
		const startedAt = generation;
		hydratePromise = (async () => {
			try {
				const raw = await AsyncStorage.getItem(STORAGE_KEY);
				if (generation !== startedAt) return;
				if (raw) {
					const parsed = JSON.parse(raw) as Partial<NotesSnapshot>;
					setSnapshot({
						notes: parsed.notes ?? [],
						folders: parsed.folders ?? [],
						tags: parsed.tags ?? [],
					});
				}
			} catch {
				// Corrupt or unreadable cache: fall through to a network load.
			} finally {
				if (!snapshot.hydrated) {
					snapshot = { ...snapshot, hydrated: true };
				}
				emit();
			}
		})();
	}
	return hydratePromise;
}

/**
 * Drop every cached row and the persisted blob behind it. Called when the
 * signed-in account is not the one this cache was written for, and on sign-out:
 * notes are private study, and the next account must never see them.
 *
 * `hydratePromise` is replaced rather than cleared so a screen mounting later
 * cannot re-read the file we are deleting; the snapshot is already marked
 * hydrated, so the library falls straight through to a server load.
 */
export function clearNotesCache(): Promise<void> {
	generation += 1;
	snapshot = { notes: [], folders: [], tags: [], hydrated: true };
	hydratePromise = Promise.resolve();
	emit();
	return AsyncStorage.removeItem(STORAGE_KEY).catch(() => {
		// An unwritable store must never break sign-out; the snapshot is
		// already empty, so nothing is shown from it either way.
	});
}

/**
 * Replace the cache with a server snapshot. List rows are summaries, so a
 * cached body is carried over while the server row is unchanged (updatedAt
 * bumps on every edit); a changed row drops the stale body so the editor
 * refetches it.
 */
export function applyServerSnapshot(notes: Note[], folders: Folder[], tags: Tag[]) {
	const prevById = new Map(snapshot.notes.map((note) => [note.id, note]));
	const merged = notes.map((note) => {
		const prev = prevById.get(note.id);
		if (
			prev &&
			prev.hasBody &&
			!note.hasBody &&
			prev.updatedAt === note.updatedAt
		) {
			return { ...note, content: prev.content, htmlContent: prev.htmlContent, hasBody: true };
		}
		return note;
	});
	setSnapshot({ notes: merged, folders, tags });
}

export function getCachedNote(id: string): Note | null {
	return snapshot.notes.find((note) => note.id === id) ?? null;
}

/** Refresh folders/tags without touching the cached notes. */
export function applyFoldersAndTags(folders: Folder[], tags: Tag[]) {
	setSnapshot({ ...snapshot, folders, tags });
}

export function upsertNoteInCache(note: Note) {
	const exists = snapshot.notes.some((entry) => entry.id === note.id);
	setSnapshot({
		...snapshot,
		notes: exists
			? snapshot.notes.map((entry) => (entry.id === note.id ? note : entry))
			: [note, ...snapshot.notes],
	});
}

export function patchNoteInCache(id: string, changes: Partial<Note>) {
	setSnapshot({
		...snapshot,
		notes: snapshot.notes.map((note) => (note.id === id ? { ...note, ...changes } : note)),
	});
}

export function removeNoteFromCache(id: string) {
	setSnapshot({ ...snapshot, notes: snapshot.notes.filter((note) => note.id !== id) });
}

export function addFolderToCache(folder: Folder) {
	setSnapshot({ ...snapshot, folders: [...snapshot.folders, folder] });
}

export function removeFolderFromCache(id: string) {
	setSnapshot({
		...snapshot,
		folders: snapshot.folders.filter((folder) => folder.id !== id),
		notes: snapshot.notes.map((note) =>
			note.folderId === id ? { ...note, folderId: null } : note
		),
	});
}

export function addTagToCache(tag: Tag) {
	setSnapshot({ ...snapshot, tags: [...snapshot.tags, tag] });
}

export function removeTagFromCache(id: string) {
	setSnapshot({
		...snapshot,
		tags: snapshot.tags.filter((tag) => tag.id !== id),
		notes: snapshot.notes.map((note) =>
			note.tagIds.includes(id)
				? { ...note, tagIds: note.tagIds.filter((tagId) => tagId !== id) }
				: note
		),
	});
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useNotesSnapshot(): NotesSnapshot {
	return useSyncExternalStore(subscribe, () => snapshot);
}
