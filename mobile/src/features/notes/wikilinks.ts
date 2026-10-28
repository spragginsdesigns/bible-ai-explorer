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

/** Same pattern the server parses (src/lib/note-links.ts). */
const WIKILINK_PATTERN = /\[\[([^[\]]+?)\]\]/g;

/** One `[[...]]` occurrence, as offsets into the scanned text. */
export interface WikilinkSpan {
	/** Start of `[[`. */
	from: number;
	/** End of `]]`. */
	to: number;
	/** The part drawn as the chip: the display text after `|`, else the whole inside. */
	labelFrom: number;
	labelTo: number;
	/** Resolution target: the text before any `#` or `|`, trimmed. */
	target: string;
}

/**
 * Finds every wikilink in one run of text. `offset` shifts the result so the
 * editor plugin can pass a ProseMirror text node's position straight in.
 */
export function findWikilinks(text: string, offset = 0): WikilinkSpan[] {
	const spans: WikilinkSpan[] = [];
	WIKILINK_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = WIKILINK_PATTERN.exec(text)) !== null) {
		const inner = match[1];
		const hash = inner.indexOf("#");
		const pipe = inner.indexOf("|");
		const cut = Math.min(hash === -1 ? inner.length : hash, pipe === -1 ? inner.length : pipe);
		const target = inner.slice(0, cut).trim();
		if (!target) continue;
		const innerFrom = offset + match.index + 2;
		const label = pipe === -1 ? "" : inner.slice(pipe + 1);
		const labelFrom = label.trim() ? innerFrom + pipe + 1 : innerFrom;
		spans.push({
			from: offset + match.index,
			to: offset + match.index + match[0].length,
			labelFrom,
			labelTo: innerFrom + inner.length,
			target,
		});
	}
	return spans;
}

/** The server's resolution key: trimmed and case-insensitive. */
export function wikilinkKey(name: string): string {
	return name.trim().toLowerCase();
}

/**
 * Mirrors the server's resolution rule: case-insensitive over title and
 * aliases, and the most recently updated note wins a collision.
 */
export function resolveWikilinkTarget(notes: Note[], target: string): Note | null {
	const key = wikilinkKey(target);
	if (!key) return null;
	let winner: Note | null = null;
	for (const note of notes) {
		const names = [note.title, ...note.aliases];
		if (!names.some((name) => wikilinkKey(name) === key)) continue;
		if (!winner || note.updatedAt > winner.updatedAt) winner = note;
	}
	return winner;
}

/** Every key that resolves to some note, for drawing resolved vs dimmed links. */
export function wikilinkTargetKeys(notes: Note[]): string[] {
	const keys = new Set<string>();
	for (const note of notes) {
		for (const name of [note.title, ...note.aliases]) {
			const key = wikilinkKey(name);
			if (key) keys.add(key);
		}
	}
	return [...keys].sort();
}
