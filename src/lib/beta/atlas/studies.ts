import "server-only";

import { getAtlas } from "@/lib/bible/atlas";
import { parseAtlasRef } from "@/lib/bible/atlas-core";
import { BOOKS } from "@/lib/bible/books";
import { searchVault } from "@/lib/beta/vault/search";
import type { VaultEntry, VaultKind } from "@/lib/beta/vault/vault-rules";
import { lifeChapters, type ChapterSpan } from "./atlas-rules";
import type { AtlasPersonStudies } from "./types";

/**
 * The founder's own studies on a person's passages (LC-17725,
 * docs/beta/atlas.md): the Knowledge Vault's passage search, run once per
 * chapter of the life (the person's own references and every event's), so a
 * note, highlight, chat, verse being learned or beta study on 1 Samuel 17
 * appears on David. Read only, owner-scoped by the Vault itself, words only:
 * no meaning search, no AI, nothing written.
 */

/**
 * What counts as the founder's own study. Reading days are a log, not a study;
 * memories are what SureWord remembers about them; sermon studies are their
 * church's. All three stay in the Vault.
 */
const STUDY_KINDS: VaultKind[] = ["note", "highlight", "chat", "verse", "study"];
/** Newest studies read per chapter. */
const PER_CHAPTER = 12;
/** Studies listed on the card. */
const SHOWN = 24;
/** Chapters searched at once. */
const PARALLEL = 4;

/** The founder's studies on a person's life, newest first, or null for an unknown person. */
export async function getPersonStudies(userId: string, personId: string): Promise<AtlasPersonStudies | null> {
	const atlas = await getAtlas();
	const person = atlas.people.find((entry) => entry.id === personId);
	if (!person) return null;
	const events = atlas.events.filter((event) => event.people.includes(personId));
	const spans = (refs: readonly string[]) =>
		refs.flatMap((raw): ChapterSpan[] => {
			const ref = parseAtlasRef(BOOKS, raw);
			return ref ? [ref] : [];
		});
	const chapters = lifeChapters(
		events.map((event) => spans(event.refs)),
		spans(person.refs)
	);

	const found = new Map<string, { entry: VaultEntry; events: Set<number> }>();
	// A chapter with more than PER_CHAPTER studies has older ones left in the Vault.
	let capped = false;
	for (let at = 0; at < chapters.length; at += PARALLEL) {
		const batch = chapters.slice(at, at + PARALLEL);
		const results = await Promise.all(
			batch.map((chapter) =>
				searchVault(userId, { q: "", kinds: STUDY_KINDS, from: null, to: null, passage: chapter.key, topic: null, before: null, limit: PER_CHAPTER }, { meaning: false })
			)
		);
		results.forEach((result, index) => {
			if (result.nextBefore) capped = true;
			for (const entry of result.entries) {
				const seen = found.get(entry.id) ?? { entry, events: new Set<number>() };
				batch[index].events.forEach((event) => seen.events.add(event));
				found.set(entry.id, seen);
			}
		});
	}

	const all = [...found.values()].sort((a, b) => b.entry.date.localeCompare(a.entry.date));
	return {
		person: personId,
		chapters: chapters.map((chapter) => chapter.label),
		studies: all.slice(0, SHOWN).map(({ entry, events: touched }) => ({
			entry,
			events: [...touched].sort((a, b) => a - b).map((index) => ({ id: events[index].id, title: events[index].title })),
		})),
		more: capped || all.length > SHOWN,
	};
}
