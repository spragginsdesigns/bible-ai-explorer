import type { Folder, Note, Tag } from "@/types/notes";

/**
 * Per-user localStorage cache for the notes library, the web counterpart of
 * Android's persisted notesStore. The list renders the last snapshot instantly
 * (and offline), then the server load revalidates it in the background.
 *
 * Keyed by Clerk user id, and every other account's blob is dropped on read:
 * notes are private study, and a shared browser must never show one account's
 * library to the next.
 */

const KEY_PREFIX = "sureword.notes-cache.v1:";

export interface NotesCacheSnapshot {
	notes: Note[];
	folders: Folder[];
	tags: Tag[];
}

type CacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export function notesCacheKey(userId: string): string {
	return `${KEY_PREFIX}${userId}`;
}

function isNote(value: unknown): value is Note {
	if (!value || typeof value !== "object") return false;
	const note = value as Partial<Note>;
	return (
		typeof note.id === "string" &&
		typeof note.title === "string" &&
		typeof note.content === "string" &&
		typeof note.plainText === "string" &&
		typeof note.updatedAt === "string" &&
		Array.isArray(note.tagIds) &&
		Array.isArray(note.aliases)
	);
}

/** Null when nothing usable is cached; a corrupt blob is removed. */
export function readNotesCache(storage: CacheStorage, userId: string): NotesCacheSnapshot | null {
	const key = notesCacheKey(userId);
	try {
		const raw = storage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<NotesCacheSnapshot>;
		if (!Array.isArray(parsed.notes)) throw new Error("Malformed notes cache");
		return {
			notes: parsed.notes.filter(isNote),
			folders: Array.isArray(parsed.folders) ? parsed.folders : [],
			tags: Array.isArray(parsed.tags) ? parsed.tags : [],
		};
	} catch {
		try {
			storage.removeItem(key);
		} catch {
			// Unwritable storage: nothing more to do.
		}
		return null;
	}
}

/**
 * Bodies are part of the cache, so a quota failure drops the blob entirely
 * rather than keeping a partial copy the editor could open as an empty note.
 */
export function writeNotesCache(
	storage: CacheStorage,
	userId: string,
	snapshot: NotesCacheSnapshot
): void {
	const key = notesCacheKey(userId);
	try {
		storage.setItem(key, JSON.stringify(snapshot));
	} catch {
		try {
			storage.removeItem(key);
		} catch {
			// Unwritable storage must never break the notes screen.
		}
	}
}

/** Remove every cached library that does not belong to `userId`. */
export function clearOtherNotesCaches(storage: CacheStorage, userId: string): void {
	const keep = notesCacheKey(userId);
	try {
		const stale: string[] = [];
		for (let i = 0; i < storage.length; i += 1) {
			const key = storage.key(i);
			if (key && key.startsWith(KEY_PREFIX) && key !== keep) stale.push(key);
		}
		for (const key of stale) storage.removeItem(key);
	} catch {
		// Storage unavailable (private window, blocked site data).
	}
}

/**
 * Merge a server list snapshot (notes, folders or tags) into local state. Rows
 * the user changed, created or deleted locally after the request started win
 * over the server rows, because the response can predate those writes;
 * everything else follows the server.
 */
export function mergeServerRows<T extends { id: string }>(
	serverNotes: T[],
	localNotes: T[],
	touchedAt: ReadonlyMap<string, number>,
	requestStartedAt: number
): T[] {
	const isFresh = (id: string) => (touchedAt.get(id) ?? -Infinity) >= requestStartedAt;
	const localById = new Map(localNotes.map((note) => [note.id, note]));
	const serverIds = new Set(serverNotes.map((note) => note.id));

	// A save that settled while the request was in flight can be newer than
	// the snapshot even though it was touched before the request started: the
	// GET read the row before the PATCH committed. The row's own updatedAt
	// says which copy is newer.
	const stamp = (row: T | undefined) => {
		const value = (row as { updatedAt?: unknown } | undefined)?.updatedAt;
		const time = typeof value === "string" ? Date.parse(value) : NaN;
		return Number.isFinite(time) ? time : null;
	};

	const merged: T[] = [];
	for (const note of serverNotes) {
		if (!isFresh(note.id)) {
			const local = localById.get(note.id);
			const localTime = stamp(local);
			const serverTime = stamp(note);
			merged.push(local && localTime !== null && serverTime !== null && localTime > serverTime ? local : note);
			continue;
		}
		// Changed locally since the request: keep the local copy, or keep it
		// gone if it was deleted locally.
		const local = localById.get(note.id);
		if (local) merged.push(local);
	}
	// Created locally after the request started, so the server could not list it.
	for (const note of localNotes) {
		if (!serverIds.has(note.id) && isFresh(note.id)) merged.unshift(note);
	}
	return merged;
}
