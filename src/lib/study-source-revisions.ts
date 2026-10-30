import { createHash } from "node:crypto";

export interface StudySourceRevisions {
	memories: { id: string; revision: string }[];
	notes: { id: string; revision: string }[];
}
/** Exact selected-source bytes, not an id or a mutable timestamp alone. */
export function noteSourceRevision(note: { title: string; plainText: string }): string {
	return createHash("sha256").update(JSON.stringify([note.title, note.plainText])).digest("hex");
}
export function memorySourceRevision(memory: { category: string; content: string }): string {
	return createHash("sha256").update(JSON.stringify([memory.category, memory.content])).digest("hex");
}
