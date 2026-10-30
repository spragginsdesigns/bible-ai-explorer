export const CANONICAL_ADOPTION_BRIDGE = "canonicalNoteAdoption";
export type CanonicalAdoptionResult = { matched: boolean; html?: string };
export type CanonicalAdoptionMessage =
	| { type: "replace-canonical-note"; payload: { requestId: string; html: string } }
	| { type: "canonical-note-replaced"; payload: CanonicalAdoptionResult & { requestId: string } };

function documentKey(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(documentKey).join(",")}]`;
	if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${documentKey(item)}`).join(",")}}`;
	return JSON.stringify(value);
}
/** Called atomically inside the editor: all nodes, marks and attributes must match. */
export function adoptCanonicalDocument(expected: object, apply: () => void, readDocument: () => object, readHTML: () => string): CanonicalAdoptionResult {
	try {
		apply();
		if (documentKey(expected) !== documentKey(readDocument())) return { matched: false };
		return { matched: true, html: readHTML() };
	} catch { return { matched: false }; }
}
