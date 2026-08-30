import { apiJson, type GetToken } from "@/lib/api";
import type { Folder, NoteApiResponse, NoteLinks, NotePatch, Tag } from "./types";

/** List rows come back without content/htmlContent; the editor fetches those per note. */
export function fetchNotes(getToken: GetToken) {
	return apiJson<NoteApiResponse[]>(getToken, "/api/notes?summary=1");
}

export function fetchNote(getToken: GetToken, id: string) {
	return apiJson<NoteApiResponse>(getToken, `/api/notes/${id}`);
}

export function createNote(getToken: GetToken, body: { title: string; folderId: string | null }) {
	return apiJson<NoteApiResponse>(getToken, "/api/notes", { method: "POST", body });
}

export function patchNote(getToken: GetToken, id: string, patch: NotePatch) {
	return apiJson<NoteApiResponse>(getToken, `/api/notes/${id}`, { method: "PATCH", body: patch });
}

export function deleteNote(getToken: GetToken, id: string) {
	return apiJson<{ success: boolean }>(getToken, `/api/notes/${id}`, { method: "DELETE" });
}

/** Both link directions for one note. The server owns wikilink parsing and resolution. */
export function fetchNoteLinks(getToken: GetToken, id: string) {
	return apiJson<NoteLinks>(getToken, `/api/notes/${id}/links`);
}

export function fetchFolders(getToken: GetToken) {
	return apiJson<Folder[]>(getToken, "/api/folders");
}

export function createFolder(getToken: GetToken, name: string) {
	return apiJson<Folder>(getToken, "/api/folders", { method: "POST", body: { name } });
}

export function deleteFolder(getToken: GetToken, id: string) {
	return apiJson<{ success: boolean }>(getToken, `/api/folders/${id}`, { method: "DELETE" });
}

export function fetchTags(getToken: GetToken) {
	return apiJson<Tag[]>(getToken, "/api/tags");
}

export function createTag(getToken: GetToken, name: string, color: string) {
	return apiJson<Tag>(getToken, "/api/tags", { method: "POST", body: { name, color } });
}

export function deleteTag(getToken: GetToken, id: string) {
	return apiJson<{ success: boolean }>(getToken, `/api/tags/${id}`, { method: "DELETE" });
}

/** The endpoint toggles: it adds the tag when missing and removes it when present. */
export function toggleNoteTag(getToken: GetToken, noteId: string, tagId: string) {
	return apiJson<{ action: "added" | "removed" }>(
		getToken,
		`/api/notes/${noteId}/tags/${tagId}`,
		{ method: "POST" }
	);
}

export function fetchNoteAIMessages(getToken: GetToken, noteId: string) {
	return apiJson<unknown[]>(getToken, `/api/notes/${noteId}/ai-messages`);
}

export function clearNoteAIMessages(getToken: GetToken, noteId: string) {
	return apiJson<{ success: boolean }>(getToken, `/api/notes/${noteId}/ai-messages`, {
		method: "DELETE",
	});
}
