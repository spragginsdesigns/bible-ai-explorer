import "server-only";

import { prisma } from "@/lib/prisma";
import { getChapterConnections, getVerseIndex } from "@/lib/bible/connections";
import { betaGraphItems, linkBetaItems, listOwnerBetaLinks } from "@/lib/beta/store";
import { moduleItemHref, moduleTitle, type SourceQuery } from "@/lib/beta/vault/sources";
import { readSafely } from "@/lib/beta/vault/search";
import { vaultBookName } from "@/lib/beta/vault/passages";
import type { VaultKind } from "@/lib/beta/vault/vault-rules";
import {
	SUGGESTED_LINK_KIND,
	buildGraph,
	chapterKeys,
	linkedKey,
	suggestConnections,
	type CrossRefInput,
	type GraphEntryInput,
	type StudyGraph,
	type Suggestion,
} from "@/lib/beta/graph/graph-rules";

/**
 * The Living Study Graph's server half (docs/beta/graph.md). Everything is
 * read where SureWord already keeps it: notes, chats, sermon studies,
 * highlights, Learn cards and reading through the Knowledge Vault's readers;
 * beta items and their links through the shared store; note wikilinks from
 * `NoteLink`; passage-to-passage edges from the bundled cross-references the
 * Connections ring draws (`getChapterConnections`), never recomputed.
 */

const READ_LIMITS: Partial<Record<VaultKind, number>> = { note: 400, chat: 150, sermon: 100, highlight: 400, verse: 200, reading: 300 };
/** Studied chapters checked for cross-references between them. */
const CROSSREF_CHAPTERS = 220;

export function chapterLabel(key: string): string {
	const [book, chapter, verse] = key.split(".").map(Number);
	const name = vaultBookName(book) ?? `Book ${book}`;
	return verse ? `${name} ${chapter}:${verse}` : `${name} ${chapter}`;
}

function chapterHref(key: string): string {
	const [book, chapter] = key.split(".");
	return `/bible/chapter?book=${book}&chapter=${chapter}`;
}

function libraryQuery(userId: string, limit: number): SourceQuery {
	return { userId, range: { since: null, until: null }, passage: null, topic: null, words: null, needles: [], limit };
}

/** Cross-references between any two of these chapters, verse pairs as passage keys. */
async function crossReferencesAmong(chapters: readonly string[]): Promise<{ from: string; to: string; verseKeys: [string, string][] }[]> {
	const wanted = new Set(chapters.slice(0, CROSSREF_CHAPTERS));
	const out = new Map<string, { from: string; to: string; verseKeys: [string, string][] }>();
	for (const key of wanted) {
		const [order, chapter] = key.split(".").map(Number);
		const data = await getChapterConnections(order, chapter).catch(() => null);
		if (!data) continue;
		for (const [verse, toOrder, toChapter, toVerse] of data.links) {
			const target = `${toOrder}.${toChapter}`;
			if (target === key || !wanted.has(target)) continue;
			const id = `${key}>${target}`;
			const entry = out.get(id) ?? { from: key, to: target, verseKeys: [] };
			if (entry.verseKeys.length < 40) entry.verseKeys.push([`${key}.${verse}`, `${target}.${toVerse}`]);
			out.set(id, entry);
		}
	}
	return [...out.values()];
}

export interface LoadedGraph extends StudyGraph {
	/** Studies that can be given suggestions (private items never are). */
	suggestable: string[];
}

export async function loadStudyGraph(userId: string): Promise<LoadedGraph> {
	const kinds = Object.keys(READ_LIMITS) as VaultKind[];
	const [lists, items, links, wikilinks, index] = await Promise.all([
		Promise.all(kinds.map((kind) => readSafely(kind, libraryQuery(userId, READ_LIMITS[kind]!)))),
		betaGraphItems(userId),
		listOwnerBetaLinks(userId),
		prisma.noteLink.findMany({ where: { userId, targetNoteId: { not: null } }, select: { sourceNoteId: true, targetNoteId: true }, take: 4000 }),
		getVerseIndex(),
	]);
	const entries: GraphEntryInput[] = [];
	// Studies first, then notes, chats and sermons, then what folds into passages, so a cap drops the least.
	for (const item of items) {
		entries.push({
			id: `study:${item.id}`,
			kind: "study",
			title: item.title,
			detail: `${moduleTitle(item.module)} · ${item.kind.replace(/-/g, " ")}`,
			href: moduleItemHref(item.module, item.id),
			date: item.updatedAt.toISOString(),
			refs: item.refs,
			// A private item is shown by its title, passages and dates only (docs/beta/README.md).
			topics: item.private ? [] : item.topics,
			module: item.module,
			itemId: item.id,
			parentItemId: item.parentId,
		});
	}
	const byKind = new Map(kinds.map((kind, i) => [kind, lists[i]]));
	for (const kind of ["note", "chat", "sermon", "highlight", "verse", "reading"] as const) {
		for (const entry of byKind.get(kind) ?? []) {
			entries.push({ id: entry.id, kind, title: entry.title, detail: entry.detail ?? null, href: entry.href, date: entry.date, refs: entry.refs, topics: entry.topics });
		}
	}
	const chapters = [...new Set(entries.flatMap((entry) => chapterKeys(entry.refs)))];
	const crossRefs: CrossRefInput[] = (await crossReferencesAmong(chapters)).map((ref) => ({
		from: ref.from,
		to: ref.to,
		verses: ref.verseKeys.slice(0, 3).map(([a, b]) => [chapterLabel(a), chapterLabel(b)] as [string, string]),
	}));
	const graph = buildGraph({
		entries,
		wikilinks: wikilinks.map((link) => [link.sourceNoteId, link.targetNoteId!] as [string, string]),
		links: links.map((link) => ({ id: link.id, fromId: link.fromId, toId: link.toId, kind: link.kind, reason: link.reason, origin: link.origin })),
		crossRefs,
		chapterLabel,
		chapterHref,
		chapterPosition: (key) => {
			const [book, chapter] = key.split(".").map(Number);
			const start = index.chapterStart.get(book)?.[chapter - 1];
			return start === undefined ? 0 : start / index.total;
		},
	});
	return { ...graph, suggestable: items.filter((item) => !item.private).map((item) => item.id) };
}

/**
 * Suggests connections between the owner's studies, from their own passages,
 * topics and the cross-references between them, and keeps each as a
 * `BetaLink` with `origin: "suggested"` and its reason. Only when the founder
 * asks: for the whole graph, or for one study (`itemId`).
 */
export async function suggestStudyConnections(userId: string, itemId?: string | null): Promise<Suggestion[]> {
	const [items, links] = await Promise.all([betaGraphItems(userId), listOwnerBetaLinks(userId)]);
	const studies = items.filter((item) => !item.private);
	if (itemId && !studies.some((item) => item.id === itemId)) return [];
	const linked = new Set(links.map((link) => linkedKey(link.fromId, link.toId)));
	const chapters = [...new Set(studies.flatMap((item) => chapterKeys(item.refs)))];
	const suggestions = suggestConnections({
		studies: studies.map((item) => ({ itemId: item.id, title: item.title, refs: item.refs, topics: item.topics, updatedAt: item.updatedAt.toISOString(), parentItemId: item.parentId })),
		crossRefs: await crossReferencesAmong(chapters),
		linked,
		focusItemId: itemId ?? null,
		label: chapterLabel,
	});
	const kept: Suggestion[] = [];
	for (const suggestion of suggestions) {
		const link = await linkBetaItems(userId, { fromId: suggestion.fromId, toId: suggestion.toId, kind: SUGGESTED_LINK_KIND, reason: suggestion.reason, origin: "suggested" });
		if (link) kept.push(suggestion);
	}
	return kept;
}
