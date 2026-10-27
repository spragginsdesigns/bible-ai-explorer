import { checkConceptMap, type ConceptMap } from "@/lib/beta/maps/map-rules";
import { MAP_BOOKS } from "@/lib/beta/maps/passages";

/**
 * A generated map stays in this tab's session storage until the founder saves
 * or discards it (LC-17654), so a reload or a trip to the reader and back does
 * not throw away a draft that cost a model call. Keyed by account.
 */
export interface StoredDraft {
	map: ConceptMap;
	retrieval: { searches: number; verses: number; books: string[]; degraded: boolean } | null;
}

export function draftStorageKey(userId: string): string {
	return `sureword:beta-maps:draft:${userId}`;
}

export function readDraft(userId: string): StoredDraft | null {
	try {
		const raw = window.sessionStorage.getItem(draftStorageKey(userId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { map?: unknown; retrieval?: StoredDraft["retrieval"] };
		// Structure only: passages were checked against the KJV when the draft was made.
		const checked = checkConceptMap(parsed.map, { books: MAP_BOOKS });
		return checked.ok ? { map: checked.value, retrieval: parsed.retrieval ?? null } : null;
	} catch {
		return null;
	}
}

/**
 * Keeps the draft only while it is a readable map, so an edit caught half way
 * (a label cleared to retype it, a question left with one reading) never
 * replaces the last good copy that a reload would come back to.
 */
export function writeDraft(userId: string, draft: StoredDraft): void {
	if (!checkConceptMap(draft.map, { books: MAP_BOOKS }).ok) return;
	try {
		window.sessionStorage.setItem(draftStorageKey(userId), JSON.stringify(draft));
	} catch {
		/* Storage full or blocked: the draft still lives in memory for this visit. */
	}
}
