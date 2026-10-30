import { useAuth } from "@clerk/expo";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import {
	addTagToCache,
	applyFoldersAndTags,
	getCachedNote,
	hydrateNotesCache,
	patchNoteInCache,
	removeNoteFromCache,
	upsertNoteInCache,
	useNotesSnapshot,
} from "./notesStore";
import { toNote, type Note, type NoteProperties, type NoteSavePayload } from "./types";
import { initialHtmlFor } from "./utils";
import { useStableGetToken } from "./useStableGetToken";

/**
 * Editor-screen data layer for a single note.
 *
 * The note is seeded synchronously from the shared notesStore, so a note whose
 * body was loaded before opens instantly; the network fetch then revalidates
 * in the background. Folders/tags also come from the store. Every mutation
 * writes through to the store, keeping the list screen in sync with no
 * pull-to-refresh.
 */
export function useNoteEditorData(noteId: string, ownership?: { isCurrent: () => boolean; canSave: () => boolean }) {
	const rawToken = useStableGetToken();
	const { userId, sessionId } = useAuth();
	const identity = useRef({ userId, sessionId });
	identity.current = { userId, sessionId };
	const ownershipRef = useRef(ownership);
	ownershipRef.current = ownership;
	const readGeneration = useRef(0);
	const writes = useRef(new Set<Promise<unknown>>());
	const trackWrite = <T,>(promise: Promise<T>): Promise<T> => {
		writes.current.add(promise);
		void promise.then(() => writes.current.delete(promise), () => writes.current.delete(promise));
		return promise;
	};
	const flushMutations = useCallback(async () => {
		try { await Promise.all([...writes.current]); return true; } catch { return false; }
	}, []);
	const getToken = useCallback(async (flags?: { fresh?: boolean }) => {
		if (!mounted.current || identity.current.userId !== userId || identity.current.sessionId !== sessionId || ownershipRef.current?.isCurrent() === false) throw new Error("The note or reading account changed.");
		const token = await rawToken(flags);
		if (!mounted.current || identity.current.userId !== userId || identity.current.sessionId !== sessionId || ownershipRef.current?.isCurrent() === false) throw new Error("The note or reading account changed.");
		return token;
	}, [rawToken, userId, sessionId]);
	const tokenOwner = useRef(getToken);
	tokenOwner.current = getToken;
	const requestIsCurrent = () => tokenOwner.current === getToken && mounted.current && ownershipRef.current?.isCurrent() !== false;
	const { folders, tags } = useNotesSnapshot();

	const [note, setNote] = useState<Note | null>(() => getCachedNote(noteId));
	// A cached summary row (no body yet) can fill the top bar, but the editor
	// itself waits for the real body so it never seeds - or autosaves - an
	// empty document over a note that has content.
	const [isLoading, setIsLoading] = useState(() => !getCachedNote(noteId)?.hasBody);
	const [error, setError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const generation = readGeneration.current;

		(async () => {
			// The cache may still be hydrating (deep link straight to a note).
			await hydrateNotesCache();
			if (cancelled || !requestIsCurrent() || generation !== readGeneration.current) return;
			const cached = getCachedNote(noteId);
			if (cached) {
				setNote((prev) => prev ?? cached);
				if (cached.hasBody) setIsLoading(false);
			}

			try {
				const loaded: Note = { ...toNote(await api.fetchNote(getToken, noteId)), hasBody: true };
				if (cancelled || !requestIsCurrent() || generation !== readGeneration.current) return;
				setNote(loaded);
				upsertNoteInCache(loaded);
				setError(null);
			} catch (err) {
				if (cancelled || !requestIsCurrent() || generation !== readGeneration.current) return;
				setError(err instanceof Error ? err.message : "Could not open this note.");
			} finally {
				if (!cancelled) setIsLoading(false);
			}

			// Secondary data — a failure here should not block editing.
			try {
				const [tagRows, folderRows] = await Promise.all([
					api.fetchTags(getToken),
					api.fetchFolders(getToken),
				]);
				if (cancelled || !requestIsCurrent() || generation !== readGeneration.current) return;
				applyFoldersAndTags(folderRows, tagRows);
			} catch {
				// Tag/folder controls stay empty.
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [getToken, noteId]);

	const save = useCallback(
		async (payload: NoteSavePayload) => {
			if (ownershipRef.current?.canSave() === false) throw new Error("Check the saved AI result before editing this note.");
			const generation = ++readGeneration.current;
			setIsSaving(true);
			try {
				const updated: Note = {
					...toNote(await api.patchNote(async flags => {
						const token = await getToken(flags);
						if (ownershipRef.current?.canSave() === false) throw new Error("Editing is paused while the assistant finishes.");
						return token;
					}, noteId, payload)),
					hasBody: true,
				};
				if (!requestIsCurrent() || generation !== readGeneration.current) return;
				if (mounted.current) {
					setNote(updated);
					setError(null);
				}
				upsertNoteInCache(updated);
			} catch (err) {
				if (requestIsCurrent()) {
					setError(err instanceof Error ? err.message : "Changes could not be saved.");
				}
				// Keep the failure visible, but let the editor keep the document
				// dirty so a later flush can retry this payload.
				throw err;
			} finally {
				if (requestIsCurrent()) setIsSaving(false);
			}
		},
		[getToken, noteId]
	);

	// Optimistic mutations roll back to the pre-change note when the server
	// rejects them; callers fire these with `void`, so failures surface via `error`.
	const renameNote = useCallback(
		async (title: string) => {
			const previous = note;
			const trimmed = title.trim() || "Untitled Note";
			setNote((prev) => (prev ? { ...prev, title: trimmed } : prev));
			patchNoteInCache(noteId, { title: trimmed });
			try {
				await trackWrite(api.patchNote(getToken, noteId, { title: trimmed }));
			} catch (err) {
				if (!requestIsCurrent()) return;
				setNote(previous);
				if (previous) upsertNoteInCache(previous);
				setError(err instanceof Error ? err.message : "The title could not be saved.");
			}
		},
		[getToken, noteId, note]
	);

	const togglePin = useCallback(async () => {
		const previous = note;
		let next = false;
		setNote((prev) => {
			if (!prev) return prev;
			next = !prev.isPinned;
			return { ...prev, isPinned: next };
		});
		patchNoteInCache(noteId, { isPinned: !previous?.isPinned });
		try {
			await trackWrite(api.patchNote(getToken, noteId, { isPinned: next }));
		} catch (err) {
			if (!requestIsCurrent()) return;
			setNote(previous);
			if (previous) upsertNoteInCache(previous);
			setError(err instanceof Error ? err.message : "The pin could not be saved.");
		}
	}, [getToken, noteId, note]);

	const moveToFolder = useCallback(
		async (folderId: string | null) => {
			const previous = note;
			setNote((prev) => (prev ? { ...prev, folderId } : prev));
			patchNoteInCache(noteId, { folderId });
			try {
				await trackWrite(api.patchNote(getToken, noteId, { folderId }));
			} catch (err) {
				if (!requestIsCurrent()) return;
				setNote(previous);
				if (previous) upsertNoteInCache(previous);
				setError(err instanceof Error ? err.message : "The move could not be saved.");
			}
		},
		[getToken, noteId, note]
	);

	const toggleTag = useCallback(
		async (tagId: string) => {
			const previous = note;
			const has = previous?.tagIds.includes(tagId) ?? false;
			const tagIds = previous
				? has
					? previous.tagIds.filter((id) => id !== tagId)
					: [...previous.tagIds, tagId]
				: [];
			setNote((prev) => (prev ? { ...prev, tagIds } : prev));
			patchNoteInCache(noteId, { tagIds });
			try {
				await trackWrite(api.toggleNoteTag(getToken, noteId, tagId));
			} catch (err) {
				if (!requestIsCurrent()) return;
				setNote(previous);
				if (previous) upsertNoteInCache(previous);
				setError(err instanceof Error ? err.message : "The tag could not be saved.");
			}
		},
		[getToken, noteId, note]
	);

	const setAliases = useCallback(
		async (aliases: string[]) => {
			const previous = note;
			setNote((prev) => (prev ? { ...prev, aliases } : prev));
			patchNoteInCache(noteId, { aliases });
			try {
				await trackWrite(api.patchNote(getToken, noteId, { aliases }));
			} catch (err) {
				if (!requestIsCurrent()) return;
				setNote(previous);
				if (previous) upsertNoteInCache(previous);
				setError(err instanceof Error ? err.message : "The aliases could not be saved.");
			}
		},
		[getToken, noteId, note]
	);

	const setProperties = useCallback(
		async (properties: NoteProperties) => {
			const previous = note;
			setNote((prev) => (prev ? { ...prev, properties } : prev));
			patchNoteInCache(noteId, { properties });
			try {
				await trackWrite(api.patchNote(getToken, noteId, { properties }));
			} catch (err) {
				if (!requestIsCurrent()) return;
				setNote(previous);
				if (previous) upsertNoteInCache(previous);
				setError(err instanceof Error ? err.message : "The properties could not be saved.");
			}
		},
		[getToken, noteId, note]
	);

	/**
	 * Fill in an unresolved `[[wikilink]]`. The new note lands in this note's
	 * folder so a linked pair stays filed together, and the server resolves the
	 * link as soon as the title exists.
	 */
	const createLinkedNote = useCallback(
		async (title: string): Promise<string | null> => {
			try {
				const created: Note = {
					...toNote(await api.createNote(getToken, { title, folderId: note?.folderId ?? null })),
					hasBody: true,
				};
				upsertNoteInCache(created);
				return created.id;
			} catch (err) {
				if (requestIsCurrent()) {
					setError(err instanceof Error ? err.message : "The note could not be created.");
				}
				return null;
			}
		},
		[getToken, note?.folderId]
	);

	const createTag = useCallback(
		async (name: string, color: string) => {
			const tag = await api.createTag(getToken, name, color);
			addTagToCache(tag);
			return tag;
		},
		[getToken]
	);

	const removeNote = useCallback(async () => {
		try {
			await api.deleteNote(getToken, noteId);
			removeNoteFromCache(noteId);
		} catch (err) {
			if (!requestIsCurrent()) return;
			setError(err instanceof Error ? err.message : "The note could not be deleted.");
		}
	}, [getToken, noteId]);

	/**
	 * Pull the server's copy after the AI has appended to this note and hand
	 * back the HTML so the open editor can be re-seeded with it.
	 */
	const refetchHtml = useCallback(async (): Promise<string | null> => {
		const generation = ++readGeneration.current;
		try {
			const fresh: Note = { ...toNote(await api.fetchNote(getToken, noteId)), hasBody: true };
			if (!requestIsCurrent() || generation !== readGeneration.current) return null;
			if (requestIsCurrent()) setNote(fresh);
			upsertNoteInCache(fresh);
			return initialHtmlFor(fresh);
		} catch {
			return null;
		}
	}, [getToken, noteId]);

	return {
		note,
		tags,
		folders,
		isLoading,
		isSaving,
		error,
		reportSaveError: setError,
		save,
		renameNote,
		togglePin,
		moveToFolder,
		toggleTag,
		setAliases,
		setProperties,
		createLinkedNote,
		createTag,
		removeNote,
		refetchHtml,
		flushMutations,
	};
}
