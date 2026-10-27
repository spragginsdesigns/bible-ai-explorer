import "server-only";

import { generateText, Output } from "ai";
import { z } from "zod";
import { stripDashes } from "@/lib/ai/plain-dashes";
import { resolveModel } from "@/lib/ai/provider";
import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { findVersesFullText } from "@/lib/bible/verse-fulltext";
import { bibleVersePlainText } from "@/lib/bible/verseMarkup";
import { searchScripture } from "@/lib/scripture-search";
import { interpretationGuidance, quotationGuidance, systemPrompt, trustedContextGuidance } from "@/utils/systemPrompt";
import { assembleGeneratedMap, formatPassage, THEME_MAX, type ConceptMap, type GeneratedDraft, type PoolVerse } from "./map-rules";
import { checkMapAgainstKjv, MAP_BOOKS } from "./passages";

/**
 * "Generate a map for any theme" (LC-17654, docs/beta/maps.md). Runs only
 * when a founder asks, never in the background, and the map is built from
 * retrieved verses, never from the model's memory:
 *
 * 1. Plan: the model names the searches the theme needs and the books it is
 *    about, and whether faithful Christians genuinely read the theme
 *    differently (the question and its readings, each with its own search,
 *    LC-17678). It writes no content here.
 * 2. Retrieve: SureWord's own retrieval (`searchScripture`, pgvector plus
 *    keyword blending) for each search, and the KJV full-text index inside
 *    each named book. Every verse's text comes from the bundled KJV.
 * 3. Build: the model draws the map citing only pool ids ("V12"). A citation
 *    outside the pool is dropped, and a node left with no verse is removed.
 *    A theme the plan flagged keeps one question of readings; any other keeps
 *    none.
 * 4. Check: the assembled map passes `checkConceptMap` with every verse
 *    checked against the bundled KJV before anyone sees it.
 */

const PLAN_TIMEOUT_MS = 60_000;
const BUILD_TIMEOUT_MS = 180_000;
/** Verses offered to the model; enough for a rich map, small enough to read closely. */
const POOL_MAX = 96;
const SEARCH_HITS = 10;
const BOOK_HITS = 8;
const BOOKS_MAX = 3;

export class MapGenerationError extends Error {
	constructor(message: string, readonly status: 422 | 502) {
		super(message);
		this.name = "MapGenerationError";
	}
}

/* -------------------------------------------------------------------------
 * The model's two halves
 * ---------------------------------------------------------------------- */

// Every field required, nullable for "none": OpenAI strict schemas reject `.optional()`.
const planSchema = z.object({
	answerable: z.boolean().describe("False only when Scripture does not speak to this theme, or it asks for something harmful"),
	reason: z.string().nullable().describe("When not answerable, one plain sentence saying why; otherwise null"),
	title: z.string().describe("A short title for the map, at most 8 words"),
	books: z.array(z.string()).max(4).describe("Bible books the theme names or is clearly about, e.g. [\"Acts\"]; empty when it spans the whole Bible"),
	searches: z
		.array(
			z.object({
				meaning: z.string().describe("What the wanted verses say, as a plain phrase, for a search by meaning over the whole KJV"),
				words: z.string().describe("Two to four distinctive words those KJV verses use, for an exact word search inside the named books"),
			}),
		)
		.min(3)
		.max(8),
	disagreement: z
		.object({
			question: z.string().describe("The question faithful Christians answer differently, as one short plain question of at most 7 words, e.g. \"What are the thousand years of Revelation 20?\""),
			readings: z
				.array(
					z.object({
						reading: z.string().describe("One reading, stated fairly in one plain sentence as its holders would put it"),
						meaning: z.string().describe("What the verses its holders cite say, as a plain phrase, for a search by meaning over the whole KJV"),
						words: z.string().describe("Two to four distinctive words those KJV verses use, for an exact word search inside the named books"),
					}),
				)
				.min(2)
				.max(3),
		})
		.nullable()
		.describe("Only when faithful Christians genuinely read this theme's passages differently; otherwise null"),
});

const draftSchema = z.object({
	title: z.string().describe("The map's title, at most 8 words"),
	summary: z.string().describe("One or two plain sentences on what the map shows"),
	topics: z.array(z.string()).max(6).describe("Three to six short lowercase topic labels"),
	nodes: z
		.array(
			z.object({
				id: z.string().describe("A short id such as n1"),
				parent: z.string().nullable().describe("The parent node's id; null only for the one root"),
				label: z.string().describe("At most 7 plain words"),
				note: z.string().describe("One or two plain sentences, at most 40 words, explaining the idea as the cited verses state it"),
				kind: z.enum(["topic", "question", "reading"]),
				verses: z.array(z.string()).min(1).max(5).describe("Ids of supplied verses that support this node, like V12"),
				connection: z.string().describe("Two to four words for how this node relates to its parent, or an empty string"),
				connectionVerses: z.array(z.string()).max(3).describe("Ids of supplied verses that show that relation; may be empty"),
			}),
		)
		.min(5)
		.max(40),
	links: z
		.array(
			z.object({
				from: z.string(),
				to: z.string(),
				label: z.string().describe("Two to five words"),
				verses: z.array(z.string()).min(1).max(3),
			}),
		)
		.max(5),
});

const PLAN_TASK = `CURRENT TASK: A founder asked SureWord to build a concept map: an interactive diagram of a biblical theme in which every idea opens the verses behind it. You are not writing the map yet. Plan the Scripture searches that will retrieve the verses it needs.

- answerable: false only when Scripture does not speak to the theme at all, or the request is harmful. Then reason says why in one plain sentence. A narrow, hard or disputed biblical theme is still answerable.
- books: the books the theme names or clearly means ("the Holy Spirit in Acts" means Acts; "faith and works in James and Romans" means James and Romans). Empty when the theme spans the Bible.
- searches: three to eight searches that together cover the theme's main parts, each different. When the theme is about particular books, cover each major passage or episode in those books where the theme appears, in the order they come, so none is missed. When the theme sets passages or books side by side, one search must find the verses where they seem to pull against each other most sharply, so the map can face them. "meaning" describes what the wanted verses say, for a search by meaning over the whole KJV. "words" gives two to four distinctive words the KJV itself uses in those verses (its own forms: "Holy Ghost", "justified", "faith without works"), for an exact word search inside the named books.
- disagreement: whether faithful, Bible-believing Christians genuinely read the passages at the heart of this theme differently, so that a fair map must set more than one reading side by side. Decide from the theme's own words. Give a disagreement when they name a matter Christians read differently, for example: faith and works, or James's "justified by works" beside Paul's "justified by faith"; the millennium or the thousand years of Revelation 20; election or predestination; baptism; the gifts of the Spirit, tongues or prophecy, and whether they continue; whether a believer can fall away. A theme that names one of these matters gets a disagreement even when it is limited to a book ("baptism in Acts", "the gifts of the Spirit in Acts", "election in Romans"), because those are the very passages Christians read differently. Then give the question plainly and two or three readings, each a fair statement its own holders would accept (what they conclude, not merely what one book says), with a search for the verses they cite. Every reading stays inside SureWord's foundation (one God in three persons, the deity of Christ, salvation by grace through faith and not by works, His bodily resurrection and return); never make the foundation itself the question. Null when the theme's words name something broader (the Holy Spirit in Acts, the church in Acts, the book of Revelation, the life of Paul, the work of Christ), even when a disputed question sits inside it, because the founder can map the narrower theme. Null for most themes. Never invent a disagreement to fill the field.
- Plain text, no markdown.`;

const BUILD_TASK = `CURRENT TASK: Build a concept map of the theme below from the numbered King James verses supplied, and from nothing else. A founder will explore it by tapping each idea to read its verses, so every node must be true to the verses it cites.

RULES:
- Cite verses only by their supplied ids (V1, V2, ...). Every node cites one to five of them. Never cite a verse that was not supplied and never lean on a verse you remember but were not given. If the supplied verses do not cover part of the theme, leave that part out rather than filling it from memory.
- Shape: one root (parent null) naming the theme, with three to six main branches under it, each holding two to five children; about 15 to 30 nodes in all. Order the branches the way the theme unfolds: the order of events for a story or a book, a logical order for a doctrine.
- label: at most 7 plain words, no verse numbers. note: one or two plain sentences, at most 40 words, explaining the idea as the cited verses state it. A note is your explanation, never Scripture, so put no words in quotation marks, and it speaks of the passages themselves, never of the supplied list, its ids or these instructions (never write "supplied"). When a note says who speaks or acts, name the person the cited verse itself names; never move words from one speaker to another.
- Where the supplied verses seem to pull against each other within the theme, cite both and show how they fit together; never leave the harder verse out.
- connection: two to four plain words a reader would use for how a node follows from its parent ("fulfilled in", "the sign", "for example", "then"), or an empty string when the line needs no label; connectionVerses: ids that show that relation, or an empty list.
- links: up to four cross-links between nodes in different branches, only where the supplied verses connect them, each with a short label and its verse ids.
- Interpretations: the prompt says whether faithful, Bible-believing Christians read this theme differently. When it names a question, add exactly one node of kind "question" whose label asks that question in at most 7 words, under the branch it belongs to or under the root, with one child of kind "reading" for each reading named. The question's note says plainly what its passages say and where readers part ways. A reading's label names what its holders conclude, never just a book or a speaker; its note states that reading fairly and plainly, as its holders would; it cites the supplied verses its holders lean on. Give every reading the same care, and never present one as settled. Never set SureWord's foundation (one God in three persons, the deity of Christ, salvation by grace through faith and not by works, His bodily resurrection and return) as one reading among others; every reading stays inside it. When the prompt says there is no such question, add no question and no reading. Every other node is kind "topic".
- topics: three to six short lowercase labels.
- Plain text everywhere: no markdown, no dashes.`;

type Disagreement = z.infer<typeof planSchema>["disagreement"];

/** The plan's answer to "do Christians read this theme differently?", as the build step's instruction. */
function readingsBrief(disagreement: Disagreement): string {
	if (!disagreement) return "WHERE CHRISTIANS READ THIS THEME DIFFERENTLY: no such question. Add no question and no reading.";
	const readings = disagreement.readings.map((reading, index) => `${index + 1}. ${reading.reading}`).join("\n");
	return `WHERE CHRISTIANS READ THIS THEME DIFFERENTLY: ${disagreement.question}\nTHE READINGS TO SET SIDE BY SIDE:\n${readings}`;
}

function instructions(task: string): string {
	return [systemPrompt, quotationGuidance("KJV"), interpretationGuidance, trustedContextGuidance, task].join("\n\n");
}

/* -------------------------------------------------------------------------
 * Retrieval
 * ---------------------------------------------------------------------- */

interface PoolEntry extends PoolVerse {
	reference: string;
	text: string;
}

export interface GeneratedMapResult {
	map: ConceptMap;
	retrieval: { searches: number; verses: number; books: string[]; degraded: boolean };
}

/** Books the plan named, as canonical orders, at most three. */
function scopedBooks(names: readonly string[]): number[] {
	const orders: number[] = [];
	for (const name of names) {
		const order = MAP_BOOKS.byName(name.trim())?.order;
		if (order && !orders.includes(order)) orders.push(order);
		if (orders.length === BOOKS_MAX) break;
	}
	return orders;
}

async function retrievePool(theme: string, searches: readonly { meaning: string; words: string }[], books: number[], signal: AbortSignal): Promise<{ pool: PoolEntry[]; degraded: boolean }> {
	let degraded = false;
	const coordinates = (reference: string) => {
		const resolved = resolveReference(reference);
		return resolved?.verse ? { book: resolved.order, chapter: resolved.chapter, verse: resolved.verse } : null;
	};
	const semantic = async (query: string) => {
		const result = await searchScripture(query, SEARCH_HITS, "KJV", signal).catch(() => null);
		if (!result) return [];
		if (result.degraded) degraded = true;
		return result.verses.flatMap((verse) => {
			const at = coordinates(verse.reference);
			return at ? [at] : [];
		});
	};
	const exact = async (words: string, book: number) =>
		(await findVersesFullText(words, BOOK_HITS, { book }).catch(() => [])).map((hit) => ({ book: hit.book, chapter: hit.chapter, verse: hit.verse }));

	// One list per search, plus the theme itself. A search's exact hits inside the named
	// books come before its meaning hits from the whole Bible, because the theme asked for those books.
	const lists = await Promise.all([
		semantic(theme),
		...searches.map(async (search) => [
			...(books.length ? (await Promise.all(books.map((book) => exact(search.words, book)))).flat() : []),
			...(await semantic(search.meaning)),
		]),
	]);
	// Round robin, so every search is represented before any one fills the pool.
	const chosen = new Map<string, { book: number; chapter: number; verse: number }>();
	for (let i = 0; chosen.size < POOL_MAX && lists.some((list) => i < list.length); i++) {
		for (const list of lists) {
			const at = list[i];
			if (!at) continue;
			const key = `${at.book}.${at.chapter}.${at.verse}`;
			if (!chosen.has(key)) chosen.set(key, at);
			if (chosen.size >= POOL_MAX) break;
		}
	}
	const sorted = [...chosen.values()].sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse);
	const pool: PoolEntry[] = [];
	for (const at of sorted) {
		const verses = await getKjvChapter(at.book, at.chapter).catch(() => null);
		const text = verses?.[at.verse - 1];
		if (!text) continue;
		pool.push({
			id: `V${pool.length + 1}`,
			...at,
			reference: formatPassage({ book: at.book, chapter: at.chapter, verse: at.verse, endChapter: at.chapter, endVerse: at.verse }, MAP_BOOKS),
			text: bibleVersePlainText(text).trim(),
		});
	}
	return { pool, degraded };
}

/* -------------------------------------------------------------------------
 * Generation
 * ---------------------------------------------------------------------- */

/** `signal` is the founder's request: closing or cancelling it stops the model calls too, so nothing is spent on a map nobody will see. */
export async function generateConceptMap(userId: string, rawTheme: string, signal?: AbortSignal): Promise<GeneratedMapResult> {
	const within = (ms: number) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
	const theme = rawTheme.replace(/\s+/g, " ").trim().slice(0, THEME_MAX);
	const planModel = await resolveModel({ userId, utility: true });
	const { output: plan } = await generateText({
		model: planModel.model,
		providerOptions: planModel.providerOptions,
		output: Output.object({ schema: planSchema }),
		instructions: instructions(PLAN_TASK),
		prompt: `THEME: ${theme}`,
		abortSignal: within(PLAN_TIMEOUT_MS),
	});
	if (!plan.answerable) {
		throw new MapGenerationError(stripDashes(plan.reason?.trim() || "Scripture does not speak to that theme directly. Try a biblical theme."), 422);
	}

	const books = scopedBooks(plan.books);
	const disagreement = plan.disagreement;
	const retrievalSignal = within(45_000);
	// Each reading gets its own search, so the verses its holders cite are in the pool beside the others'.
	const { pool, degraded } = await retrievePool(theme, [...plan.searches, ...(disagreement?.readings ?? [])], books, retrievalSignal);
	if (pool.length < 6) throw new MapGenerationError("Too few verses came back for that theme to build a map. Try wording it another way.", 422);

	const buildModel = await resolveModel({ userId, structured: true });
	const scope = books.length ? `\nBOOKS THE THEME IS ABOUT: ${books.map((order) => bookByOrder(order)?.name).join(", ")}. Build the map mainly from these books; use other books only where they directly explain them.` : "";
	const { output: draft } = await generateText({
		model: buildModel.model,
		providerOptions: buildModel.providerOptions,
		output: Output.object({ schema: draftSchema }),
		instructions: instructions(BUILD_TASK),
		prompt: `THEME: ${theme}${scope}\nSUGGESTED TITLE: ${plan.title}\n${readingsBrief(disagreement)}\n\nSUPPLIED VERSES (KJV), id | reference | text:\n${pool.map((verse) => `${verse.id} | ${verse.reference} | ${verse.text}`).join("\n")}`,
		abortSignal: within(BUILD_TIMEOUT_MS),
	});

	const plain = (text: string) => stripDashes(text);
	const cleaned: GeneratedDraft = {
		title: plain(draft.title),
		summary: plain(draft.summary),
		topics: draft.topics,
		nodes: draft.nodes.map((node) => ({ ...node, label: plain(node.label), note: plain(node.note), connection: plain(node.connection) })),
		links: draft.links.map((link) => ({ ...link, label: plain(link.label) })),
	};
	const raw = assembleGeneratedMap(cleaned, pool, MAP_BOOKS, theme, disagreement ? 1 : 0);
	if (!raw) throw new MapGenerationError("The map came back without enough verses behind it. Please try again.", 502);
	const checked = await checkMapAgainstKjv(raw);
	if (!checked.ok) {
		console.error("concept map failed its check:", checked.error);
		throw new MapGenerationError("The map came back in a shape SureWord could not check. Please try again.", 502);
	}
	return { map: checked.value, retrieval: { searches: plan.searches.length, verses: pool.length, books: books.map((order) => bookByOrder(order)?.name ?? ""), degraded } };
}
