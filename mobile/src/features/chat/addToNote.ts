import { apiJson, type GetToken } from "@/lib/api";
import type { NoteApiResponse } from "@/features/notes/types";

/** Response shape of POST /api/notes/append (shared contract with the web client). */
export interface AppendToNoteResult {
	noteId: string;
	noteTitle: string;
	created: boolean;
}

/**
 * Save an assistant answer into a note. `noteId: null` creates a new note;
 * `title` is only meaningful on create (the server defaults it when omitted).
 */
export function appendAnswerToNote(
	getToken: GetToken,
	body: { markdown: string; noteId: string | null; title?: string }
) {
	return apiJson<AppendToNoteResult>(getToken, "/api/notes/append", {
		method: "POST",
		body,
	});
}

/** Case-insensitive match on title or body preview; a blank query keeps every note. */
export function filterNotesByQuery(
	notes: NoteApiResponse[],
	query: string
): NoteApiResponse[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return notes;
	return notes.filter(
		(note) =>
			note.title.toLowerCase().includes(needle) ||
			note.plainText.toLowerCase().includes(needle)
	);
}
