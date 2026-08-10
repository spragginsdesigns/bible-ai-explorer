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
import { toNote, type Note, type NoteSavePayload } from "./types";
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
export function useNoteEditorData(noteId: string) {
	const getToken = useStableGetToken();
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

		(async () => {
			// The cache may still be hydrating (deep link straight to a note).
			await hydrateNotesCache();
			if (cancelled) return;
			const cached = getCachedNote(noteId);
			if (cached) {
				setNote((prev) => prev ?? cached);
				if (cached.hasBody) setIsLoading(false);
			}

			try {
				const loaded: Note = { ...toNote(await api.fetchNote(getToken, noteId)), hasBody: true };
				if (cancelled) return;
				setNote(loaded);
				upsertNoteInCache(loaded);
				setError(null);
			} catch (err) {
				if (cancelled) return;
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
				if (cancelled) return;
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
			setIsSaving(true);
			try {
				const updated: Note = {
					...toNote(await api.patchNote(getToken, noteId, payload)),
					hasBody: true,
				};
				if (mounted.current) {
					setNote(updated);
					setError(null);
				}
				upsertNoteInCache(updated);
			} catch (err) {
				if (mounted.current) {
					setError(err instanceof Error ? err.message : "Changes could not be saved.");
				}
			} finally {
				if (mounted.current) setIsSaving(false);
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
				await api.patchNote(getToken, noteId, { title: trimmed });
			} catch (err) {
				if (!mounted.current) return;
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
			await api.patchNote(getToken, noteId, { isPinned: next });
		} catch (err) {
			if (!mounted.current) return;
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
				await api.patchNote(getToken, noteId, { folderId });
			} catch (err) {
				if (!mounted.current) return;
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
				await api.toggleNoteTag(getToken, noteId, tagId);
			} catch (err) {
				if (!mounted.current) return;
				setNote(previous);
				if (previous) upsertNoteInCache(previous);
				setError(err instanceof Error ? err.message : "The tag could not be saved.");
			}
		},
		[getToken, noteId, note]
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
			if (!mounted.current) return;
			setError(err instanceof Error ? err.message : "The note could not be deleted.");
		}
	}, [getToken, noteId]);

	/**
	 * Pull the server's copy after the AI has appended to this note and hand
	 * back the HTML so the open editor can be re-seeded with it.
	 */
	const refetchHtml = useCallback(async (): Promise<string | null> => {
		try {
			const fresh: Note = { ...toNote(await api.fetchNote(getToken, noteId)), hasBody: true };
			if (mounted.current) setNote(fresh);
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
		save,
		renameNote,
		togglePin,
		moveToFolder,
		toggleTag,
		createTag,
		removeNote,
		refetchHtml,
	};
}
