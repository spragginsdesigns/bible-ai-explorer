export interface EditorDraftOwner { accountId: string; noteId: string }
export interface EditorDraftBody { content: string; htmlContent: string; plainText: string; wordCount: number }
export interface EditorDraft { version: 1; id: string; owner: EditorDraftOwner; body: EditorDraftBody }
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const retained = new Map<string, EditorDraft>();
let sequence = 0;
const keyFor = (owner: EditorDraftOwner) => `sureword.note-editor-draft.v1:${encodeURIComponent(owner.accountId)}:${encodeURIComponent(owner.noteId)}`;
export function retainEditorDraft(storage: DraftStorage | null, owner: EditorDraftOwner, body: EditorDraftBody): { draft: EditorDraft; persisted: boolean } {
	const draft: EditorDraft = { version: 1, id: `${Date.now()}-${++sequence}`, owner: { ...owner }, body: { ...body } };
	const key = keyFor(owner); retained.set(key, draft);
	try { if (!storage) return { draft, persisted: false }; storage.setItem(key, JSON.stringify(draft)); return { draft, persisted: true }; }
	catch { return { draft, persisted: false }; }
}
export function readEditorDraft(storage: DraftStorage | null, owner: EditorDraftOwner): EditorDraft | null {
	const key = keyFor(owner), memory = retained.get(key);
	if (memory) return memory;
	if (!storage) throw new Error("Local draft recovery storage is unavailable.");
	const raw = storage.getItem(key); if (raw === null) return null;
	const value = JSON.parse(raw) as EditorDraft;
	if (value?.version !== 1 || typeof value.id !== "string" || value.owner?.accountId !== owner.accountId || value.owner?.noteId !== owner.noteId
		|| typeof value.body?.content !== "string" || typeof value.body.htmlContent !== "string" || typeof value.body.plainText !== "string" || typeof value.body.wordCount !== "number") throw new Error("The retained local draft could not be read.");
	return value;
}
/** An older save response must never discard a newer rich-text draft. */
export function clearEditorDraft(storage: DraftStorage | null, owner: EditorDraftOwner, expectedId: string): boolean {
	const key = keyFor(owner), memory = retained.get(key);
	if (memory && memory.id !== expectedId) return false;
	try {
		const raw = storage?.getItem(key);
		if (raw && (JSON.parse(raw) as EditorDraft).id !== expectedId) return false;
		storage?.removeItem(key);
	} catch { return false; }
	retained.delete(key); return true;
}
