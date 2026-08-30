import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Obsidian-style [[wikilinks]] between the user's notes.
 *
 * Links are parsed out of `plainText` rather than the Tiptap JSON or the HTML,
 * because plainText is the one body field every client (web, Android, the AI
 * note tools) writes identically. "NoteLink" rows are therefore derived data:
 * every note write rebuilds the whole set for that note, and a row whose
 * targetNoteId is null is a link to a note that does not exist yet.
 *
 * Titles are not unique per user, so a link resolves case-insensitively
 * against title + aliases and the most recently updated note wins a collision.
 * Renaming a note never unresolves an existing link; deleting the target
 * unresolves it through the FK's ON DELETE SET NULL.
 *
 * Like syncNoteEmbeddings, every sync here is best-effort: a failure only
 * degrades links and must never fail the note write that triggered it.
 */

/** Bounds one INSERT for a pathological note; ordinary notes hold a handful. */
const MAX_LINKS_PER_NOTE = 200;
const SNIPPET_CONTEXT = 80;

const MAX_ALIASES = 20;
const MAX_ALIAS_LENGTH = 120;
const MAX_PROPERTY_KEYS = 32;
const MAX_PROPERTY_KEY_LENGTH = 64;
const MAX_PROPERTY_STRING_LENGTH = 2000;
const MAX_PROPERTY_ARRAY_ITEMS = 32;
const MAX_PROPERTY_ARRAY_ITEM_LENGTH = 200;

/** Advisory-lock class, so these locks cannot collide with any other use. */
const NOTE_LINK_LOCK_NAMESPACE = 4711;

const WIKILINK_PATTERN = /\[\[([^[\]]+?)\]\]/g;

export interface ParsedWikilink {
	/** Lowercased trimmed target - the dedupe and resolution key. */
	key: string;
	/** Target exactly as typed, for rendering an unresolved link. */
	title: string;
	/** Surrounding plainText, for backlink previews. */
	snippet: string;
}

/**
 * Extract the unique wikilink targets from a note body. `[[Target|display]]`
 * and `[[Target#heading]]` both link to "Target"; the display text and the
 * heading are presentation, not identity.
 */
export function parseWikilinks(plainText: string): ParsedWikilink[] {
	const found = new Map<string, ParsedWikilink>();
	if (!plainText) return [];

	WIKILINK_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = WIKILINK_PATTERN.exec(plainText)) !== null) {
		const inner = match[1];
		const cut = Math.min(
			inner.includes("#") ? inner.indexOf("#") : inner.length,
			inner.includes("|") ? inner.indexOf("|") : inner.length
		);
		const title = inner.slice(0, cut).trim();
		if (!title) continue;

		const key = title.toLowerCase();
		if (found.has(key)) continue;

		const from = Math.max(0, match.index - SNIPPET_CONTEXT);
		const to = Math.min(plainText.length, match.index + match[0].length + SNIPPET_CONTEXT);
		const snippet = plainText.slice(from, to).replace(/\s+/g, " ").trim();

		found.set(key, { key, title, snippet });
		if (found.size >= MAX_LINKS_PER_NOTE) break;
	}

	return [...found.values()];
}

/**
 * 32-bit FNV-1a of the note id, used as the advisory lock key below. Any
 * collision between two notes only makes their syncs wait for each other.
 */
function advisoryLockKey(noteId: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < noteId.length; i++) {
		hash ^= noteId.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash | 0; // int4, which is what pg_advisory_xact_lock takes
}

/**
 * Rebuild one note's outgoing links from its body.
 *
 * Notes autosave every ~1.5s, so two syncs for the same note routinely
 * overlap. Delete-then-insert is not safe under that race (the loser hits the
 * (sourceNoteId, targetKey) unique and dies with 23505, leaving stale links),
 * and neither is a sorted upsert pass on its own: two syncs with different
 * link sets can deadlock when one deletes the key the other is inserting. A
 * per-note advisory lock, taken first inside the transaction, makes the syncs
 * serialize instead, so the last writer's link set wins completely.
 */
export async function syncNoteLinks(note: {
	userId: string;
	noteId: string;
	plainText: string;
}): Promise<void> {
	try {
		const links = parseWikilinks(note.plainText);
		if (links.length === 0) {
			await prisma.noteLink.deleteMany({ where: { sourceNoteId: note.noteId } });
			return;
		}

		// Only notes that actually contain wikilinks pay for this scan, which is
		// why the empty case returns above rather than falling through.
		const candidates = await prisma.note.findMany({
			where: { userId: note.userId },
			select: { id: true, title: true, aliases: true, updatedAt: true },
		});

		const byKey = new Map<string, { id: string; updatedAt: Date }>();
		for (const candidate of candidates) {
			for (const name of [candidate.title, ...candidate.aliases]) {
				const key = name.trim().toLowerCase();
				if (!key) continue;
				const winner = byKey.get(key);
				if (!winner || candidate.updatedAt > winner.updatedAt) {
					byKey.set(key, { id: candidate.id, updatedAt: candidate.updatedAt });
				}
			}
		}

		const sorted = [...links].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
		const keys = sorted.map((link) => link.key);
		const values = Prisma.join(
			sorted.map(
				(link) =>
					Prisma.sql`(${randomUUID()}, ${note.noteId}, ${byKey.get(link.key)?.id ?? null}, ${link.key}, ${link.title}, ${link.snippet}, ${note.userId})`
			)
		);

		await prisma.$transaction([
			// Transaction-scoped on purpose: it is released at commit, so it is
			// safe over the pooled (transaction-pooling) Neon connection, which a
			// session-scoped advisory lock would not be. The ::text cast matters:
			// pg_advisory_xact_lock returns void, which $queryRaw cannot
			// deserialize (P2010), and the whole sync dies in its catch.
			prisma.$queryRaw`SELECT pg_advisory_xact_lock(${NOTE_LINK_LOCK_NAMESPACE}::int4, ${advisoryLockKey(note.noteId)}::int4)::text`,
			prisma.$executeRaw`
				INSERT INTO "NoteLink" ("id","sourceNoteId","targetNoteId","targetKey","targetTitle","snippet","userId")
				VALUES ${values}
				ON CONFLICT ("sourceNoteId","targetKey") DO UPDATE SET
					"targetNoteId" = EXCLUDED."targetNoteId",
					"targetTitle" = EXCLUDED."targetTitle",
					"snippet" = EXCLUDED."snippet"
			`,
			prisma.$executeRaw`
				DELETE FROM "NoteLink"
				WHERE "sourceNoteId" = ${note.noteId} AND "targetKey" NOT IN (${Prisma.join(keys)})
			`,
		]);
	} catch (error) {
		console.error(`Failed to sync note links for ${note.noteId}:`, error);
	}
}

/**
 * Claim the links that were written before this note existed under one of its
 * names. Only unresolved rows are touched, so a rename never steals a link
 * that already points somewhere.
 */
export async function resolvePendingLinks(note: {
	userId: string;
	noteId: string;
	title: string;
	aliases: string[];
}): Promise<void> {
	try {
		const keys = [note.title, ...note.aliases]
			.map((name) => name.trim().toLowerCase())
			.filter(Boolean);
		if (keys.length === 0) return;

		await prisma.noteLink.updateMany({
			where: { userId: note.userId, targetNoteId: null, targetKey: { in: keys } },
			data: { targetNoteId: note.noteId },
		});
	} catch (error) {
		console.error(`Failed to resolve pending links for ${note.noteId}:`, error);
	}
}

/**
 * Plain-text summary of one note's link graph, for injection into the note
 * panel's system prompt so the assistant knows what this note links to and
 * what links back to it. Returns null when the note has no links either way
 * (the common case - keep the prompt free of an empty section). Best-effort
 * like the syncs: a failure returns null rather than failing the chat turn.
 */
export async function describeNoteLinks(noteId: string): Promise<string | null> {
	try {
		const [outgoing, backlinks] = await Promise.all([
			prisma.noteLink.findMany({
				where: { sourceNoteId: noteId },
				orderBy: { targetKey: "asc" },
				select: { targetTitle: true, target: { select: { title: true } } },
				take: 30,
			}),
			prisma.noteLink.findMany({
				where: { targetNoteId: noteId },
				orderBy: { source: { updatedAt: "desc" } },
				select: { snippet: true, source: { select: { title: true } } },
				take: 30,
			}),
		]);
		if (outgoing.length === 0 && backlinks.length === 0) return null;

		const lines: string[] = [];
		if (outgoing.length > 0) {
			lines.push("Notes this note links to (via [[wikilinks]] in its text):");
			for (const link of outgoing) {
				lines.push(
					link.target
						? `- [[${link.target.title}]]`
						: `- [[${link.targetTitle}]] (pending - no note with this title exists yet)`
				);
			}
		}
		if (backlinks.length > 0) {
			lines.push("Notes that link TO this note (its backlinks / linked mentions):");
			for (const link of backlinks) {
				const snippet = link.snippet ? ` - "${link.snippet.slice(0, 120)}"` : "";
				lines.push(`- [[${link.source.title}]]${snippet}`);
			}
		}
		return lines.join("\n");
	} catch (error) {
		console.error(`Failed to describe note links for ${noteId}:`, error);
		return null;
	}
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

/** Normalize a request body's `aliases`: trimmed, de-duplicated, non-empty. */
export function validateAliases(input: unknown): Validated<string[]> {
	if (!Array.isArray(input)) {
		return { ok: false, error: "aliases must be an array of strings" };
	}
	if (input.length > MAX_ALIASES) {
		return { ok: false, error: `aliases must hold at most ${MAX_ALIASES} entries` };
	}

	const seen = new Set<string>();
	const aliases: string[] = [];
	for (const entry of input) {
		if (typeof entry !== "string") {
			return { ok: false, error: "aliases must be an array of strings" };
		}
		const alias = entry.trim();
		if (!alias) continue;
		if (alias.length > MAX_ALIAS_LENGTH) {
			return { ok: false, error: `each alias must be at most ${MAX_ALIAS_LENGTH} characters` };
		}
		const key = alias.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		aliases.push(alias);
	}
	return { ok: true, value: aliases };
}

export type NotePropertyValue = string | number | boolean | string[];
export type NoteProperties = Record<string, NotePropertyValue>;

/**
 * Validate a request body's `properties`. Null clears them; anything that is
 * not a flat object of scalars or string arrays is rejected rather than
 * coerced, so the column stays queryable.
 */
export function validateProperties(input: unknown): Validated<NoteProperties | null> {
	if (input === null) return { ok: true, value: null };
	if (typeof input !== "object" || Array.isArray(input)) {
		return { ok: false, error: "properties must be an object" };
	}

	const entries = Object.entries(input as Record<string, unknown>);
	if (entries.length > MAX_PROPERTY_KEYS) {
		return { ok: false, error: `properties must hold at most ${MAX_PROPERTY_KEYS} keys` };
	}

	const properties: NoteProperties = {};
	for (const [key, value] of entries) {
		if (!key.trim()) {
			return { ok: false, error: "property keys must not be empty" };
		}
		if (key.length > MAX_PROPERTY_KEY_LENGTH) {
			return {
				ok: false,
				error: `property keys must be at most ${MAX_PROPERTY_KEY_LENGTH} characters`,
			};
		}

		if (typeof value === "string") {
			if (value.length > MAX_PROPERTY_STRING_LENGTH) {
				return {
					ok: false,
					error: `property "${key}" must be at most ${MAX_PROPERTY_STRING_LENGTH} characters`,
				};
			}
			properties[key] = value;
		} else if (typeof value === "boolean") {
			properties[key] = value;
		} else if (typeof value === "number") {
			if (!Number.isFinite(value)) {
				return { ok: false, error: `property "${key}" must be a finite number` };
			}
			properties[key] = value;
		} else if (Array.isArray(value)) {
			if (value.length > MAX_PROPERTY_ARRAY_ITEMS) {
				return {
					ok: false,
					error: `property "${key}" must hold at most ${MAX_PROPERTY_ARRAY_ITEMS} items`,
				};
			}
			const items: string[] = [];
			for (const item of value) {
				if (typeof item !== "string" || item.length > MAX_PROPERTY_ARRAY_ITEM_LENGTH) {
					return {
						ok: false,
						error: `property "${key}" must be an array of strings up to ${MAX_PROPERTY_ARRAY_ITEM_LENGTH} characters`,
					};
				}
				items.push(item);
			}
			properties[key] = items;
		} else {
			return {
				ok: false,
				error: `property "${key}" must be a string, number, boolean, or array of strings`,
			};
		}
	}

	return { ok: true, value: properties };
}
