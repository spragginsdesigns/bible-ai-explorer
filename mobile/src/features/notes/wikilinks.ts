import type { Note } from "./types";

/**
 * Client-side wikilink helpers. The server parses `[[Target]]`,
 * `[[Target|display]]` and `[[Target#heading]]` out of plainText and owns
 * resolution and backlinks - nothing here computes a link graph. These only
 * cover writing a link into the editor and choosing what to write.
 */

/** The four characters that carry meaning inside `[[...]]`. */
const RESERVED = /[[\]|#]/g;

/** A title is only usable as a link target once its delimiters are gone. */
export function sanitizeWikilinkTarget(raw: string): string {
	return raw.replace(RESERVED, " ").replace(/\s+/g, " ").trim();
}

/** Returns "" when nothing usable survives sanitizing, so callers can skip the insert. */
export function formatWikilink(raw: string): string {
	const target = sanitizeWikilinkTarget(raw);
	return target ? `[[${target}]]` : "";
}

/** Titles and aliases are matched the same way, so a note is findable by either. */
export function filterNotesForLinking(
	notes: Note[],
	query: string,
	excludeId: string
): Note[] {
	const pool = notes.filter((note) => note.id !== excludeId);
	const needle = sanitizeWikilinkTarget(query).toLowerCase();
	if (!needle) return pool;
	return pool.filter(
		(note) =>
			note.title.toLowerCase().includes(needle) ||
			note.aliases.some((alias) => alias.toLowerCase().includes(needle))
	);
}

/**
 * Drives the "Link to: <query>" row: offered only when the query names
 * something that does not exist yet, so the row never duplicates a real note.
 */
export function hasExactTarget(notes: Note[], query: string, excludeId: string): boolean {
	const needle = sanitizeWikilinkTarget(query).toLowerCase();
	if (!needle) return true;
	return notes.some(
		(note) =>
			note.id !== excludeId &&
			(note.title.toLowerCase() === needle ||
				note.aliases.some((alias) => alias.toLowerCase() === needle))
	);
}

/** Unresolved links have no note behind them, so fall back to what was typed. */
export function outgoingLinkLabel(link: { targetTitle: string; title: string | null }): string {
	return link.title?.trim() || link.targetTitle;
}
