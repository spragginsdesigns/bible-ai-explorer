import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
/** Apply and prove the entire schema document before opening manual editing. */
export function adoptCanonicalDocument(expected: ProseMirrorNode, apply: () => void, current: () => ProseMirrorNode): boolean {
	try { apply(); return current().eq(expected); } catch { return false; }
}
