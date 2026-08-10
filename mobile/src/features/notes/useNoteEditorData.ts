import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api";
import { toNote, type Folder, type Note, type NoteSavePayload, type Tag } from "./types";
import { initialHtmlFor } from "./utils";
import { useStableGetToken } from "./useStableGetToken";

/** Editor-screen data layer for a single note. */
export function useNoteEditorData(noteId: string) {
	const getToken = useStableGetToken();

	const [note, setNote] = useState<Note | null>(null);
	const [tags, setTags] = useState<Tag[]>([]);
	const [folders, setFolders] = useState<Folder[]>([]);
	const [isLoading, setIsLoading] = useState(true);
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
		setIsLoading(true);

		(async () => {
			try {
				const loaded = toNote(await api.fetchNote(getToken, noteId));
				if (cancelled) return;
				setNote(loaded);
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
				setTags(tagRows);
				setFolders(folderRows);
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
				const updated = toNote(await api.patchNote(getToken, noteId, payload));
				if (mounted.current) {
					setNote(updated);
					setError(null);
				}
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
			try {
				await api.patchNote(getToken, noteId, { title: trimmed });
			} catch (err) {
				if (!mounted.current) return;
				setNote(previous);
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
		try {
			await api.patchNote(getToken, noteId, { isPinned: next });
		} catch (err) {
			if (!mounted.current) return;
			setNote(previous);
			setError(err instanceof Error ? err.message : "The pin could not be saved.");
		}
	}, [getToken, noteId, note]);

	const moveToFolder = useCallback(
		async (folderId: string | null) => {
			const previous = note;
			setNote((prev) => (prev ? { ...prev, folderId } : prev));
			try {
				await api.patchNote(getToken, noteId, { folderId });
			} catch (err) {
				if (!mounted.current) return;
				setNote(previous);
				setError(err instanceof Error ? err.message : "The move could not be saved.");
			}
		},
		[getToken, noteId, note]
	);

	const toggleTag = useCallback(
		async (tagId: string) => {
			const previous = note;
			setNote((prev) => {
				if (!prev) return prev;
				const has = prev.tagIds.includes(tagId);
				return {
					...prev,
					tagIds: has ? prev.tagIds.filter((id) => id !== tagId) : [...prev.tagIds, tagId],
				};
			});
			try {
				await api.toggleNoteTag(getToken, noteId, tagId);
			} catch (err) {
				if (!mounted.current) return;
				setNote(previous);
				setError(err instanceof Error ? err.message : "The tag could not be saved.");
			}
		},
		[getToken, noteId, note]
	);

	const createTag = useCallback(
		async (name: string, color: string) => {
			const tag = await api.createTag(getToken, name, color);
			setTags((prev) => [...prev, tag]);
			return tag;
		},
		[getToken]
	);

	const removeNote = useCallback(async () => {
		try {
			await api.deleteNote(getToken, noteId);
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
			const fresh = toNote(await api.fetchNote(getToken, noteId));
			if (mounted.current) setNote(fresh);
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
