/** Read final saved state; an action receipt alone may omit the changed body. */
export type NoteWriteEvidence = { noteId: string; available: false } | {
	noteId: string; available: true; title: string; plainText: string; truncated: boolean;
};
const NOTE_WRITES = new Set(["addToNote", "updateNote", "organizeNote"]);
export function successfulNoteWriteId(
	toolName: string,
	output: unknown,
): string | null {
	if (!NOTE_WRITES.has(toolName) || !output || typeof output !== "object") return null;
	const result = output as { noteId?: unknown; success?: unknown; error?: unknown };
	if (result.success === false || result.error || typeof result.noteId !== "string" || !result.noteId.trim()) return null;
	return result.noteId;
}

/** Call after generation/tool execution has ended, never from concurrent callbacks. */
export async function readSavedNoteEvidence(
	noteId: string,
	readOwnedNote: (noteId: string) => Promise<{ id: string; title: string; plainText: string } | null>,
	timeoutMs = 5000,
): Promise<NoteWriteEvidence> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const saved = await Promise.race([readOwnedNote(noteId), new Promise<null>(resolve => {
			timer = setTimeout(() => resolve(null), timeoutMs);
		})]);
		if (!saved || saved.id !== noteId || typeof saved.title !== "string" || typeof saved.plainText !== "string") return { noteId, available: false };
		return { noteId, available: true, title: saved.title, plainText: saved.plainText.slice(0, 8000), truncated: saved.plainText.length > 8000 };
	} catch {
		// Never turn a completed write into a retried side effect.
		return { noteId, available: false };
	} finally { clearTimeout(timer); }
}
