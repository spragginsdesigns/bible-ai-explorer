/**
 * Pure rules for Concept Maps (LC-17654, docs/beta/maps.md): the shape of a
 * map, the passages every node and connection carries, the checks a map must
 * pass before it is shown or saved, and the tree layout the canvas draws.
 *
 * No imports on purpose: `tests/beta-maps.test.mjs` loads this file with
 * Node's type stripping, which cannot resolve `@/` paths. Anything that needs
 * the Bible's book list or text takes it as an argument (`MapBookIndex`,
 * `verseCount`), supplied by `passages.ts` in the app and by the test from
 * the bundled JSON.
 */

/* -------------------------------------------------------------------------
 * The map
 * ---------------------------------------------------------------------- */

/**
 * `topic` is an ordinary idea. A `question` is a passage Christians read
 * differently; its children are all `reading`s, shown side by side and
 * labelled as interpretations, none presented as settled.
 */
export type MapNodeKind = "topic" | "question" | "reading";
export const MAP_NODE_KINDS: readonly MapNodeKind[] = ["topic", "question", "reading"];

/** How a node hangs from its parent: a short relation and the verses that show it. */
export interface MapConnection {
	label: string;
	refs: string[];
}

export interface MapNode {
	id: string;
	/** Null only for the root, which is always the first node. */
	parentId: string | null;
	label: string;
	/** SureWord's short explanation. Never Scripture; the verses are in `refs`. */
	note: string;
	kind: MapNodeKind;
	/** Canonical passages ("Romans 5:12-21"), at least one. */
	refs: string[];
	/** The connection from the parent; null only for the root. */
	via: MapConnection | null;
}

/** A cross-link between two nodes that are not parent and child. */
export interface MapLink {
	id: string;
	from: string;
	to: string;
	label: string;
	refs: string[];
}

export type MapOrigin =
	| { kind: "library"; slug: string }
	| { kind: "generated"; theme: string }
	| { kind: "custom" };

export interface ConceptMap {
	version: 1;
	title: string;
	summary: string;
	topics: string[];
	nodes: MapNode[];
	links: MapLink[];
	origin: MapOrigin;
}

export const MAP_TITLE_MAX = 120;
export const MAP_SUMMARY_MAX = 400;
export const MAP_TOPICS_MAX = 8;
export const MAP_TOPIC_MAX = 60;
export const MAP_NODES_MIN = 2;
export const MAP_NODES_MAX = 80;
export const MAP_LINKS_MAX = 24;
export const NODE_LABEL_MAX = 64;
export const NODE_NOTE_MAX = 500;
export const NODE_REFS_MAX = 12;
export const CONNECTION_LABEL_MAX = 40;
export const CONNECTION_REFS_MAX = 6;
export const READINGS_MIN = 2;
export const READINGS_MAX = 4;
/** A generated or edited theme, as typed. */
export const THEME_MAX = 160;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

/* -------------------------------------------------------------------------
 * Passages
 * ---------------------------------------------------------------------- */

export interface MapBook {
	order: number;
	name: string;
	chapters: number;
}

/** Book lookup by any accepted name ("Romans", "Rom", "1 Cor", "Psalm"). */
export type MapBookIndex = {
	byName: (name: string) => MapBook | null;
	byOrder: (order: number) => MapBook | null;
};

/** One passage: a chapter, a verse, a verse range, or a range across chapters. */
export interface Passage {
	book: number;
	chapter: number;
	/** Absent for a whole chapter (or a whole chapter range). */
	verse?: number;
	/** Last chapter of a range; equals `chapter` within one chapter. */
	endChapter: number;
	/** Last verse; absent for whole chapters. */
	endVerse?: number;
}

/** Verses in a chapter, or null when the chapter does not exist. */
export type VerseCount = (book: number, chapter: number) => number | null;

const PASSAGE_TEXT_MAX = 48;

const PASSAGE_PATTERN =
	/^((?:[1-3]\s*)?[A-Za-z][A-Za-z.]*(?:\s+[A-Za-z][A-Za-z.]*)*)\s*\.?\s*(\d{1,3})(?:\s*:\s*(\d{1,3}))?(?:\s*[-–—]\s*(\d{1,3})(?:\s*:\s*(\d{1,3}))?)?$/;

/**
 * Parse "Romans 5:12-21", "John 3:16", "Psalm 23", "Matthew 26:57-27:26",
 * "Genesis 1-2" into a passage. Null when the book is unknown, the numbers
 * are out of order, or a chapter does not exist. Verse numbers are checked
 * against `verseCount` when it is given.
 */
export function parsePassage(input: string, books: MapBookIndex, verseCount?: VerseCount): Passage | null {
	const text = input.trim().replace(/\s+/g, " ");
	// The longest real reference ("1 Thessalonians 4:13-5:11") is far shorter; a cap keeps any input cheap to parse.
	if (text.length > PASSAGE_TEXT_MAX) return null;
	const match = PASSAGE_PATTERN.exec(text);
	if (!match) return null;
	const [, rawName, c1, v1, n2, n3] = match;
	const book = books.byName(rawName.replace(/\.$/, ""));
	if (!book) return null;
	// A one-chapter book is cited by verse: "Jude 24" is Jude 1:24 and "Jude 3-4" is
	// Jude 1:3-4, while "Jude 1" alone still means the whole book.
	if (book.chapters === 1 && v1 === undefined && n3 === undefined && (Number(c1) > 1 || n2 !== undefined)) {
		return parsePassage(`${rawName.replace(/\.$/, "")} 1:${c1}${n2 === undefined ? "" : `-${n2}`}`, books, verseCount);
	}
	const chapter = Number(c1);
	if (chapter < 1 || chapter > book.chapters) return null;
	let passage: Passage;
	if (v1 === undefined) {
		// "Genesis 1" or "Genesis 1-2" (a range of whole chapters); "Genesis 1-2:3" is malformed.
		if (n3 !== undefined) return null;
		const endChapter = n2 === undefined ? chapter : Number(n2);
		if (endChapter < chapter || endChapter > book.chapters) return null;
		passage = { book: book.order, chapter, endChapter };
	} else {
		const verse = Number(v1);
		let endChapter = chapter;
		let endVerse = verse;
		if (n2 !== undefined && n3 !== undefined) {
			endChapter = Number(n2);
			endVerse = Number(n3);
		} else if (n2 !== undefined) {
			endVerse = Number(n2);
		}
		if (verse < 1 || endVerse < 1) return null;
		if (endChapter < chapter || endChapter > book.chapters) return null;
		if (endChapter === chapter && endVerse < verse) return null;
		passage = { book: book.order, chapter, verse, endChapter, endVerse };
	}
	if (verseCount && !passageExists(passage, verseCount)) return null;
	return passage;
}

function passageExists(passage: Passage, verseCount: VerseCount): boolean {
	for (let chapter = passage.chapter; chapter <= passage.endChapter; chapter++) {
		if (verseCount(passage.book, chapter) === null) return false;
	}
	if (passage.verse === undefined) return true;
	const first = verseCount(passage.book, passage.chapter) ?? 0;
	const last = verseCount(passage.book, passage.endChapter) ?? 0;
	return passage.verse <= first && (passage.endVerse ?? passage.verse) <= last;
}

/** "Psalm" for one psalm, the book's own name otherwise. */
function displayBookName(book: MapBook, passage: Passage): string {
	return book.order === 19 && passage.endChapter === passage.chapter ? "Psalm" : book.name;
}

/** The canonical way a passage is written in a map: "Romans 5:12-21". */
export function formatPassage(passage: Passage, books: MapBookIndex): string {
	const book = books.byOrder(passage.book);
	const name = book ? displayBookName(book, passage) : `Book ${passage.book}`;
	if (passage.verse === undefined) {
		return passage.endChapter === passage.chapter
			? `${name} ${passage.chapter}`
			: `${name} ${passage.chapter}-${passage.endChapter}`;
	}
	const end = passage.endVerse ?? passage.verse;
	if (passage.endChapter !== passage.chapter) return `${name} ${passage.chapter}:${passage.verse}-${passage.endChapter}:${end}`;
	return end === passage.verse ? `${name} ${passage.chapter}:${passage.verse}` : `${name} ${passage.chapter}:${passage.verse}-${end}`;
}

/** The passage rewritten canonically, or null when it does not parse. */
export function canonicalPassage(input: string, books: MapBookIndex, verseCount?: VerseCount): string | null {
	const passage = parsePassage(input, books, verseCount);
	return passage ? formatPassage(passage, books) : null;
}

/** Every chapter the passage touches, with the verse span read in each. */
export function passageChapters(passage: Passage, verseCount: VerseCount): { chapter: number; from: number; to: number }[] {
	const out: { chapter: number; from: number; to: number }[] = [];
	for (let chapter = passage.chapter; chapter <= passage.endChapter; chapter++) {
		const count = verseCount(passage.book, chapter) ?? 0;
		const from = chapter === passage.chapter && passage.verse !== undefined ? passage.verse : 1;
		const to = chapter === passage.endChapter && passage.endVerse !== undefined ? Math.min(passage.endVerse, count) : count;
		if (count > 0 && from <= to) out.push({ chapter, from, to });
	}
	return out;
}

/** `/bible/chapter?...`, opening the reader at the passage's first verse. */
export function passageReaderHref(passage: Passage): string {
	const verse = passage.verse === undefined ? "" : `&verse=${passage.verse}`;
	return `/bible/chapter?book=${passage.book}&chapter=${passage.chapter}${verse}&translation=KJV`;
}

/**
 * Passage keys for the shared study store (`BetaItem.refs`, "45.5" and
 * "45.5.12"): every verse of every passage, so a lookup by any verse finds the
 * map. When that would pass the store's cap, ranges keep only their first
 * verse; every chapter key is always kept.
 */
export function mapStoreRefKeys(passages: readonly Passage[], verseCount: VerseCount, cap = 500): string[] {
	const chapters = new Set<string>();
	const firsts = new Set<string>();
	const verses = new Set<string>();
	for (const passage of passages) {
		for (const span of passageChapters(passage, verseCount)) {
			chapters.add(`${passage.book}.${span.chapter}`);
			if (passage.verse === undefined) continue;
			firsts.add(`${passage.book}.${span.chapter}.${span.from}`);
			for (let verse = span.from; verse <= span.to; verse++) verses.add(`${passage.book}.${span.chapter}.${verse}`);
		}
	}
	const full = new Set([...chapters, ...verses]);
	const chosen = full.size <= cap ? full : new Set([...chapters, ...firsts]);
	return [...chosen].slice(0, cap);
}

/* -------------------------------------------------------------------------
 * Checking a map
 * ---------------------------------------------------------------------- */

export type MapRuleResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface MapCheckContext {
	books: MapBookIndex;
	/** When given, every verse must exist in the KJV. */
	verseCount?: VerseCount;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Single-spaced, trimmed text, or null when it is not a string. */
function cleanText(value: unknown): string | null {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : null;
}

/** Trimmed text keeping its line breaks (notes and summaries). */
function cleanProse(value: unknown): string | null {
	return typeof value === "string" ? value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : null;
}

function checkPassages(raw: unknown, max: number, where: string, context: MapCheckContext): MapRuleResult<string[]> {
	if (!Array.isArray(raw)) return { ok: false, error: `${where}: refs must be a list of passages` };
	const out: string[] = [];
	for (const item of raw) {
		const text = cleanText(item);
		const canonical = text ? canonicalPassage(text, context.books, context.verseCount) : null;
		if (!canonical) return { ok: false, error: `${where}: "${String(item).slice(0, 40)}" is not a passage in the KJV` };
		if (!out.includes(canonical)) out.push(canonical);
	}
	if (out.length === 0) return { ok: false, error: `${where}: needs at least one passage` };
	if (out.length > max) return { ok: false, error: `${where}: at most ${max} passages` };
	return { ok: true, value: out };
}

export function normalizeMapTopics(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	for (const item of raw) {
		const label = cleanText(item)?.toLowerCase();
		if (!label || label.length > MAP_TOPIC_MAX || out.includes(label)) continue;
		out.push(label);
		if (out.length === MAP_TOPICS_MAX) break;
	}
	return out;
}

function checkOrigin(raw: unknown): MapOrigin {
	if (isPlainObject(raw)) {
		if (raw.kind === "library" && typeof raw.slug === "string" && ID_PATTERN.test(raw.slug)) return { kind: "library", slug: raw.slug };
		if (raw.kind === "generated" && typeof raw.theme === "string") {
			const theme = cleanText(raw.theme)?.slice(0, THEME_MAX) ?? "";
			if (theme) return { kind: "generated", theme };
		}
	}
	return { kind: "custom" };
}

/**
 * The map as it may be shown and saved, or the first reason it may not.
 * Text is trimmed, passages are rewritten canonically, a node with no
 * connection label gets an empty one and a connection with no passages
 * borrows the node's first, so every node and every connection carries
 * verses. Structure is never repaired: a cycle, an orphan, a reading outside
 * a question or a question with fewer than two readings is an error.
 */
export function checkConceptMap(raw: unknown, context: MapCheckContext): MapRuleResult<ConceptMap> {
	if (!isPlainObject(raw)) return { ok: false, error: "a map must be an object" };
	const title = cleanText(raw.title);
	if (!title) return { ok: false, error: "the map needs a title" };
	if (title.length > MAP_TITLE_MAX) return { ok: false, error: `the title is longer than ${MAP_TITLE_MAX}` };
	const summary = cleanProse(raw.summary ?? "") ?? "";
	if (summary.length > MAP_SUMMARY_MAX) return { ok: false, error: `the summary is longer than ${MAP_SUMMARY_MAX}` };
	if (!Array.isArray(raw.nodes)) return { ok: false, error: "nodes must be a list" };
	if (raw.nodes.length < MAP_NODES_MIN) return { ok: false, error: `a map needs at least ${MAP_NODES_MIN} nodes` };
	if (raw.nodes.length > MAP_NODES_MAX) return { ok: false, error: `a map holds at most ${MAP_NODES_MAX} nodes` };

	const nodes: MapNode[] = [];
	const ids = new Set<string>();
	for (const [index, item] of raw.nodes.entries()) {
		if (!isPlainObject(item)) return { ok: false, error: `node ${index + 1} must be an object` };
		const id = typeof item.id === "string" ? item.id : "";
		if (!ID_PATTERN.test(id)) return { ok: false, error: `node ${index + 1} has a bad id` };
		if (ids.has(id)) return { ok: false, error: `two nodes share the id ${id}` };
		ids.add(id);
		const label = cleanText(item.label);
		if (!label) return { ok: false, error: `node ${id} needs a label` };
		if (label.length > NODE_LABEL_MAX) return { ok: false, error: `node ${id}: the label is longer than ${NODE_LABEL_MAX}` };
		const note = cleanProse(item.note ?? "") ?? "";
		if (note.length > NODE_NOTE_MAX) return { ok: false, error: `node ${id}: the note is longer than ${NODE_NOTE_MAX}` };
		const kind = (MAP_NODE_KINDS as readonly unknown[]).includes(item.kind) ? (item.kind as MapNodeKind) : item.kind === undefined ? "topic" : null;
		if (!kind) return { ok: false, error: `node ${id}: unknown kind` };
		const refs = checkPassages(item.refs, NODE_REFS_MAX, `node "${label}"`, context);
		if (!refs.ok) return refs;
		const parentId = item.parentId === null || item.parentId === undefined ? null : typeof item.parentId === "string" ? item.parentId : "";
		if (parentId === "") return { ok: false, error: `node ${id}: bad parentId` };
		if (index === 0 && parentId !== null) return { ok: false, error: "the first node must be the root" };
		if (index > 0 && parentId === null) return { ok: false, error: `node ${id} has no parent; only the first node is the root` };
		let via: MapConnection | null = null;
		if (parentId !== null) {
			const rawVia = isPlainObject(item.via) ? item.via : {};
			const viaLabel = cleanText(rawVia.label ?? "") ?? "";
			if (viaLabel.length > CONNECTION_LABEL_MAX) return { ok: false, error: `node "${label}": the connection label is longer than ${CONNECTION_LABEL_MAX}` };
			const rawViaRefs = Array.isArray(rawVia.refs) && rawVia.refs.length > 0 ? rawVia.refs : [refs.value[0]];
			const viaRefs = checkPassages(rawViaRefs, CONNECTION_REFS_MAX, `the connection to "${label}"`, context);
			if (!viaRefs.ok) return viaRefs;
			via = { label: viaLabel, refs: viaRefs.value };
		}
		nodes.push({ id, parentId, label, note, kind, refs: refs.value, via });
	}

	const byId = new Map(nodes.map((node) => [node.id, node]));
	const root = nodes[0];
	if (root.kind !== "topic") return { ok: false, error: "the root must be an ordinary node" };
	for (const node of nodes) {
		if (node.parentId === null) continue;
		const parent = byId.get(node.parentId);
		if (!parent) return { ok: false, error: `node "${node.label}" hangs from a node that does not exist` };
		if (node.kind === "reading" && parent.kind !== "question") return { ok: false, error: `the interpretation "${node.label}" must sit under a question` };
		if (parent.kind === "question" && node.kind !== "reading") return { ok: false, error: `under the question "${parent.label}" every node must be an interpretation` };
		if (parent.kind === "reading") return { ok: false, error: `the interpretation "${parent.label}" cannot have nodes under it` };
		// Walking up must reach the root without revisiting a node.
		const seen = new Set<string>([node.id]);
		let cursor: MapNode | undefined = parent;
		while (cursor && cursor.parentId !== null) {
			if (seen.has(cursor.id)) return { ok: false, error: `node "${node.label}" is part of a loop` };
			seen.add(cursor.id);
			cursor = byId.get(cursor.parentId);
		}
		if (cursor !== root) return { ok: false, error: `node "${node.label}" is not connected to the root` };
	}
	for (const node of nodes) {
		if (node.kind !== "question") continue;
		const readings = nodes.filter((child) => child.parentId === node.id).length;
		if (readings < READINGS_MIN) return { ok: false, error: `the question "${node.label}" needs at least ${READINGS_MIN} interpretations side by side` };
		if (readings > READINGS_MAX) return { ok: false, error: `the question "${node.label}" holds at most ${READINGS_MAX} interpretations` };
	}

	const rawLinks = raw.links === undefined ? [] : raw.links;
	if (!Array.isArray(rawLinks)) return { ok: false, error: "links must be a list" };
	if (rawLinks.length > MAP_LINKS_MAX) return { ok: false, error: `a map holds at most ${MAP_LINKS_MAX} links` };
	const links: MapLink[] = [];
	const linkIds = new Set<string>();
	const pairs = new Set<string>();
	for (const [index, item] of rawLinks.entries()) {
		if (!isPlainObject(item)) return { ok: false, error: `link ${index + 1} must be an object` };
		const id = typeof item.id === "string" ? item.id : "";
		if (!ID_PATTERN.test(id) || linkIds.has(id)) return { ok: false, error: `link ${index + 1} has a bad or repeated id` };
		linkIds.add(id);
		const from = typeof item.from === "string" ? byId.get(item.from) : undefined;
		const to = typeof item.to === "string" ? byId.get(item.to) : undefined;
		if (!from || !to) return { ok: false, error: `link ${id} joins a node that does not exist` };
		if (from.id === to.id) return { ok: false, error: `link ${id} joins a node to itself` };
		if (to.parentId === from.id || from.parentId === to.id) return { ok: false, error: `link ${id} repeats the line from "${from.label}" to "${to.label}"` };
		const pair = [from.id, to.id].sort().join(" ");
		if (pairs.has(pair)) return { ok: false, error: `"${from.label}" and "${to.label}" are linked twice` };
		pairs.add(pair);
		const label = cleanText(item.label ?? "") ?? "";
		if (!label) return { ok: false, error: `the link from "${from.label}" to "${to.label}" needs a label` };
		if (label.length > CONNECTION_LABEL_MAX) return { ok: false, error: `link ${id}: the label is longer than ${CONNECTION_LABEL_MAX}` };
		const refs = checkPassages(item.refs, CONNECTION_REFS_MAX, `the link from "${from.label}" to "${to.label}"`, context);
		if (!refs.ok) return refs;
		links.push({ id, from: from.id, to: to.id, label, refs: refs.value });
	}

	return {
		ok: true,
		value: { version: 1, title, summary, topics: normalizeMapTopics(raw.topics), nodes, links, origin: checkOrigin(raw.origin) },
	};
}

/* -------------------------------------------------------------------------
 * Reading a map
 * ---------------------------------------------------------------------- */

export function childrenOf(map: Pick<ConceptMap, "nodes">, id: string): MapNode[] {
	return map.nodes.filter((node) => node.parentId === id);
}

/** The node's ancestors, root first, not including the node. */
export function ancestorsOf(map: Pick<ConceptMap, "nodes">, id: string): MapNode[] {
	const byId = new Map(map.nodes.map((node) => [node.id, node]));
	const out: MapNode[] = [];
	let cursor = byId.get(id);
	while (cursor?.parentId) {
		cursor = byId.get(cursor.parentId);
		if (!cursor || out.includes(cursor)) break;
		out.unshift(cursor);
	}
	return out;
}

/** Ids of the node and everything beneath it. */
export function subtreeIds(map: Pick<ConceptMap, "nodes">, id: string): Set<string> {
	const out = new Set<string>([id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const node of map.nodes) {
			if (node.parentId && out.has(node.parentId) && !out.has(node.id)) {
				out.add(node.id);
				grew = true;
			}
		}
	}
	return out;
}

/**
 * "Focus a branch": the path down from the root to the node, then the
 * node's whole branch. Links survive only between nodes still shown.
 * Focusing the root returns the map unchanged.
 */
export function focusBranch(map: ConceptMap, id: string): ConceptMap {
	if (!map.nodes.some((node) => node.id === id) || map.nodes[0]?.id === id) return map;
	const keep = subtreeIds(map, id);
	for (const ancestor of ancestorsOf(map, id)) keep.add(ancestor.id);
	return {
		...map,
		nodes: map.nodes.filter((node) => keep.has(node.id)),
		links: map.links.filter((link) => keep.has(link.from) && keep.has(link.to)),
	};
}

/** Every passage in the map, nodes and connections, in map order, de-duplicated. */
export function mapPassageTexts(map: Pick<ConceptMap, "nodes" | "links">): string[] {
	const out = new Set<string>();
	for (const node of map.nodes) {
		for (const ref of node.refs) out.add(ref);
		for (const ref of node.via?.refs ?? []) out.add(ref);
	}
	for (const link of map.links) for (const ref of link.refs) out.add(ref);
	return [...out];
}

/**
 * The plain-text outline the Knowledge Vault indexes (`BetaItem.body`): the
 * title and summary, then every node as an indented line with its passages.
 */
export function mapOutlineText(map: ConceptMap): string {
	const lines = [map.title];
	if (map.summary) lines.push(map.summary);
	const walk = (id: string, depth: number) => {
		for (const node of childrenOf(map, id)) {
			const tag = node.kind === "question" ? " (Christians read this differently)" : node.kind === "reading" ? " (interpretation)" : "";
			const via = node.via?.label ? `${node.via.label}: ` : "";
			lines.push(`${"  ".repeat(depth)}- ${via}${node.label}${tag} [${node.refs.join("; ")}]${node.note ? ` ${node.note}` : ""}`);
			walk(node.id, depth + 1);
		}
	};
	const root = map.nodes[0];
	if (root) {
		lines.push(`${root.label} [${root.refs.join("; ")}]${root.note ? ` ${root.note}` : ""}`);
		walk(root.id, 1);
	}
	for (const link of map.links) {
		const from = map.nodes.find((node) => node.id === link.from)?.label;
		const to = map.nodes.find((node) => node.id === link.to)?.label;
		lines.push(`Link: ${from} - ${link.label} - ${to} [${link.refs.join("; ")}]`);
	}
	return lines.join("\n");
}

/** A fresh node id not used in the map: "n1", "n2", ... */
export function nextNodeId(map: Pick<ConceptMap, "nodes" | "links">, prefix = "n"): string {
	const used = new Set([...map.nodes.map((node) => node.id), ...map.links.map((link) => link.id)]);
	for (let i = 1; ; i++) {
		const id = `${prefix}${i}`;
		if (!used.has(id)) return id;
	}
}

/* -------------------------------------------------------------------------
 * Layout: a tidy tree, root on the left, branches to the right
 * ---------------------------------------------------------------------- */

export const LAYOUT = {
	nodeWidth: 212,
	nodeHeight: 88,
	/** Room between a parent and its children for the connection label. */
	gapX: 156,
	gapY: 18,
	/** Interpretations sit in a row, side by side, under a header strip. */
	readingGap: 14,
	readingHeader: 30,
	padding: 48,
	/** A line label pill: its widest (the canvas's max-w) and its height. */
	labelMaxWidth: 146,
	labelHeight: 24,
} as const;

/** About how wide a line label pill draws (12px bold text plus its padding), for keeping labels apart. */
export function labelPillWidth(text: string): number {
	return Math.min(LAYOUT.labelMaxWidth, Math.ceil(text.length * 7.2) + 24);
}

export interface PlacedNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	depth: number;
}

/** A frame around a question's interpretations. */
export interface PlacedReadingGroup {
	questionId: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PlacedEdge {
	/**
	 * The child's id for a tree connection, the link's id for a cross-link,
	 * "<question id>:readings" for the line into a question's interpretations.
	 */
	id: string;
	kind: "tree" | "link" | "group";
	from: string;
	to: string;
	path: string;
	/** Where the connection's label sits. */
	labelX: number;
	labelY: number;
	/**
	 * "end": right-aligned just before the child. "middle": centered on the curve.
	 * "start": left-aligned just right of a column, for a link between two nodes in it,
	 * so the label never covers that column's nodes.
	 */
	labelAnchor: "end" | "middle" | "start";
}

export interface MapLayout {
	width: number;
	height: number;
	nodes: Map<string, PlacedNode>;
	groups: PlacedReadingGroup[];
	edges: PlacedEdge[];
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
	const mid = (x1 + x2) / 2;
	return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

/** The point halfway along `curve`'s cubic (t = 0.5). */
function curveMidpoint(x1: number, y1: number, x2: number, y2: number): { x: number; y: number } {
	return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

/**
 * Positions for every node, connection and interpretation group. Pure and
 * deterministic: the same map always draws the same way, so a saved map
 * looks as it did when it was saved.
 */
export function layoutConceptMap(map: Pick<ConceptMap, "nodes" | "links">): MapLayout {
	const { nodeWidth: W, nodeHeight: H, gapX, gapY, readingGap, readingHeader, padding } = LAYOUT;
	const kids = new Map<string, MapNode[]>();
	for (const node of map.nodes) {
		if (!node.parentId) continue;
		const list = kids.get(node.parentId) ?? [];
		list.push(node);
		kids.set(node.parentId, list);
	}
	const readingsOf = (node: MapNode) => (node.kind === "question" ? kids.get(node.id) ?? [] : []);
	const groupSize = (count: number) => ({ width: count * W + (count - 1) * readingGap, height: H + readingHeader });

	// Height of each node's block (the node and everything to its right).
	const blocks = new Map<string, number>();
	const measure = (node: MapNode, guard: Set<string>): number => {
		if (guard.has(node.id)) return H;
		guard.add(node.id);
		let block: number;
		if (node.kind === "question") {
			block = Math.max(H, groupSize(readingsOf(node).length).height);
		} else {
			const children = kids.get(node.id) ?? [];
			block = children.length
				? Math.max(H, children.reduce((sum, child) => sum + measure(child, guard), 0) + gapY * (children.length - 1))
				: H;
		}
		blocks.set(node.id, block);
		return block;
	};

	const nodes = new Map<string, PlacedNode>();
	const groups: PlacedReadingGroup[] = [];
	const edges: PlacedEdge[] = [];
	let maxX = 0;
	let maxY = 0;

	const place = (node: MapNode, depth: number, top: number) => {
		const block = blocks.get(node.id) ?? H;
		const x = padding + depth * (W + gapX);
		const y = top + (block - H) / 2;
		nodes.set(node.id, { id: node.id, x, y, width: W, height: H, depth });
		maxX = Math.max(maxX, x + W);
		maxY = Math.max(maxY, y + H);
		const cy = y + H / 2;
		if (node.kind === "question") {
			const readings = readingsOf(node);
			const size = groupSize(readings.length);
			const gx = x + W + gapX;
			const gy = cy - size.height / 2;
			groups.push({ questionId: node.id, x: gx - 10, y: gy - 6, width: size.width + 20, height: size.height + 16 });
			readings.forEach((reading, index) => {
				const rx = gx + index * (W + readingGap);
				const ry = gy + readingHeader;
				nodes.set(reading.id, { id: reading.id, x: rx, y: ry, width: W, height: H, depth: depth + 1 });
			});
			edges.push({ id: `${node.id}:readings`, kind: "group", from: node.id, to: node.id, path: curve(x + W, cy, gx - 10, cy), labelX: gx - 18, labelY: cy, labelAnchor: "end" });
			maxX = Math.max(maxX, gx + size.width + 10);
			maxY = Math.max(maxY, gy + size.height + 10);
			return;
		}
		let cursor = top;
		for (const child of kids.get(node.id) ?? []) {
			const childBlock = blocks.get(child.id) ?? H;
			place(child, depth + 1, cursor);
			const placed = nodes.get(child.id);
			if (placed) {
				const ccy = placed.y + H / 2;
				edges.push({ id: child.id, kind: "tree", from: node.id, to: child.id, path: curve(x + W, cy, placed.x, ccy), labelX: placed.x - 10, labelY: ccy, labelAnchor: "end" });
			}
			cursor += childBlock + gapY;
		}
	};

	const root = map.nodes[0];
	if (root) {
		measure(root, new Set());
		place(root, 0, padding);
	}

	// What a link label must not cover: the nodes, the tree's line labels, and the reading frames.
	type Box = { x: number; y: number; w: number; h: number };
	const LH = LAYOUT.labelHeight;
	const viaLabel = new Map(map.nodes.map((node) => [node.id, node.via?.label ?? ""]));
	const taken: Box[] = [...nodes.values()].map((node) => ({ x: node.x, y: node.y, w: node.width, h: node.height }));
	for (const edge of edges) {
		const text = edge.kind === "tree" ? viaLabel.get(edge.to) : "";
		if (text) taken.push({ x: edge.labelX - labelPillWidth(text), y: edge.labelY - LH / 2, w: labelPillWidth(text), h: LH });
	}
	for (const group of groups) taken.push({ x: group.x, y: group.y, w: group.width, h: group.height });
	const covers = (box: Box) => taken.some((other) => box.x < other.x + other.w && other.x < box.x + box.w && box.y < other.y + other.h && other.y < box.y + box.h);

	for (const link of map.links) {
		const a = nodes.get(link.from);
		const b = nodes.get(link.to);
		if (!a || !b) continue;
		// Leave from the side facing the other node.
		const forward = b.x >= a.x + a.width || (b.x > a.x && b.y !== a.y);
		const x1 = forward ? a.x + a.width : a.x;
		const x2 = forward ? b.x : b.x + b.width;
		const sameColumn = Math.abs(a.x - b.x) < 1;
		const y1 = a.y + (sameColumn ? (b.y > a.y ? a.height : 0) : a.height / 2);
		const y2 = b.y + (sameColumn ? (b.y > a.y ? 0 : b.height) : b.height / 2);
		const sx1 = sameColumn ? a.x + a.width - 28 : x1;
		const sx2 = sameColumn ? b.x + b.width - 28 : x2;
		const path = sameColumn
			? `M ${sx1} ${y1} C ${sx1 + 70} ${y1 + (y2 - y1) / 3}, ${sx2 + 70} ${y2 - (y2 - y1) / 3}, ${sx2} ${y2}`
			: curve(x1, y1, x2, y2);
		const mid = sameColumn ? { x: a.x + a.width + 8, y: (y1 + y2) / 2 } : curveMidpoint(x1, y1, x2, y2);
		if (sameColumn) {
			// The curve runs almost straight down beside the column, so the label can slide along it,
			// staying between the two ends, to the nearest place that covers nothing.
			const width = labelPillWidth(link.label);
			const at = (y: number): Box => ({ x: mid.x, y: y - LH / 2, w: width, h: LH });
			const top = Math.min(y1, y2) + LH;
			const bottom = Math.max(y1, y2) - LH;
			for (let step = 0; covers(at(mid.y)) && step <= bottom - top; step += 6) {
				if (mid.y - step >= top && !covers(at(mid.y - step))) mid.y -= step;
				else if (mid.y + step <= bottom && !covers(at(mid.y + step))) mid.y += step;
			}
			taken.push(at(mid.y));
		}
		edges.push({ id: link.id, kind: "link", from: link.from, to: link.to, path, labelX: mid.x, labelY: mid.y, labelAnchor: sameColumn ? "start" : "middle" });
		// Room for the widest label (146px) on the side it extends to.
		maxX = Math.max(maxX, mid.x + (sameColumn ? 150 : 80));
	}

	return { width: Math.ceil(maxX + padding), height: Math.ceil(maxY + padding), nodes, groups, edges };
}

/* -------------------------------------------------------------------------
 * Pan and zoom
 * ---------------------------------------------------------------------- */

export interface MapView {
	x: number;
	y: number;
	scale: number;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

export function clampScale(scale: number): number {
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/** The view that shows the whole map inside a viewport, never zoomed past 100%. */
export function fitView(layout: Pick<MapLayout, "width" | "height">, viewport: { width: number; height: number }): MapView {
	const scale = clampScale(Math.min(1, viewport.width / layout.width, viewport.height / layout.height));
	return {
		scale,
		x: (viewport.width - layout.width * scale) / 2,
		y: (viewport.height - layout.height * scale) / 2,
	};
}

/**
 * The first view of a map: the whole map when it is readable that way,
 * otherwise readable text with the root at the left edge, vertically
 * centered, so the reader starts at the beginning and pans right.
 */
export function initialView(layout: MapLayout, viewport: { width: number; height: number }, rootId: string, readable = 0.72): MapView {
	const fit = fitView(layout, viewport);
	if (fit.scale >= readable) return fit;
	const scale = clampScale(Math.min(0.9, Math.max(readable, fit.scale)));
	const root = layout.nodes.get(rootId);
	const rootCenter = root ? root.y + root.height / 2 : layout.height / 2;
	const left = root ? root.x - 16 : 0;
	return { scale, x: -left * scale + 8, y: viewport.height / 2 - rootCenter * scale };
}

/** Zoom by `factor` keeping the map point under (px, py) in place. */
export function zoomAround(view: MapView, factor: number, px: number, py: number): MapView {
	const scale = clampScale(view.scale * factor);
	const ratio = scale / view.scale;
	return { scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
}

/** The smallest pan that brings a node fully into the viewport (with a margin, and its own one at the bottom). */
export function panToReveal(view: MapView, node: Pick<PlacedNode, "x" | "y" | "width" | "height">, viewport: { width: number; height: number }, margin = 24, bottomMargin = margin): MapView {
	const left = node.x * view.scale + view.x;
	const top = node.y * view.scale + view.y;
	const right = left + node.width * view.scale;
	const bottom = top + node.height * view.scale;
	let dx = 0;
	let dy = 0;
	if (left < margin) dx = margin - left;
	else if (right > viewport.width - margin) dx = Math.max(margin - left, viewport.width - margin - right);
	if (top < margin) dy = margin - top;
	else if (bottom > viewport.height - bottomMargin) dy = Math.max(margin - top, viewport.height - bottomMargin - bottom);
	return dx || dy ? { ...view, x: view.x + dx, y: view.y + dy } : view;
}

/**
 * Arrow-key travel through the tree: right to the first child, left to the
 * parent, up and down between siblings (side by side interpretations included).
 */
export function neighbourNode(map: Pick<ConceptMap, "nodes">, id: string, key: "ArrowRight" | "ArrowLeft" | "ArrowUp" | "ArrowDown"): string | null {
	const node = map.nodes.find((item) => item.id === id);
	if (!node) return null;
	if (key === "ArrowRight") return childrenOf(map, id)[0]?.id ?? null;
	if (key === "ArrowLeft") return node.parentId;
	if (!node.parentId) return null;
	const siblings = childrenOf(map, node.parentId);
	const index = siblings.findIndex((item) => item.id === id);
	const next = siblings[index + (key === "ArrowDown" ? 1 : -1)];
	return next?.id ?? null;
}

/* -------------------------------------------------------------------------
 * Assembling a generated map
 * ---------------------------------------------------------------------- */

/** One retrieved verse the model may cite, by its pool id ("V12"). */
export interface PoolVerse {
	id: string;
	book: number;
	chapter: number;
	verse: number;
}

/** What the model returns: every passage named by pool id, never by its own reference. */
export interface GeneratedDraft {
	title: string;
	summary: string;
	topics: string[];
	nodes: {
		id: string;
		parent: string | null;
		label: string;
		note: string;
		kind: string;
		verses: string[];
		connection: string;
		connectionVerses: string[];
	}[];
	links: { from: string; to: string; label: string; verses: string[] }[];
}

/** Consecutive verses of one chapter become one range; order follows the Bible. */
export function versesToPassages(verses: readonly Pick<PoolVerse, "book" | "chapter" | "verse">[]): Passage[] {
	const sorted = [...new Map(verses.map((v) => [`${v.book}.${v.chapter}.${v.verse}`, v])).values()].sort(
		(a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse,
	);
	const out: Passage[] = [];
	for (const v of sorted) {
		const last = out[out.length - 1];
		if (last && last.book === v.book && last.chapter === v.chapter && last.endVerse === v.verse - 1) {
			last.endVerse = v.verse;
		} else {
			out.push({ book: v.book, chapter: v.chapter, verse: v.verse, endChapter: v.chapter, endVerse: v.verse });
		}
	}
	return out;
}

/** Cut to `max` characters at a word boundary. */
function clip(text: unknown, max: number): string {
	const value = cleanText(text) ?? "";
	if (value.length <= max) return value;
	const cut = value.slice(0, max + 1);
	const space = cut.lastIndexOf(" ");
	return (space > max * 0.6 ? cut.slice(0, space) : value.slice(0, max)).replace(/[\s,;:]+$/, "");
}

/**
 * The model's draft as a raw map for `checkConceptMap`, or null when nothing
 * usable is left. Passages come only from the retrieved pool: a pool id the
 * model invented is dropped, and a node left with no verse is removed (its
 * children move up to the nearest node that stays). Structure the model got
 * wrong is repaired rather than rejected: a second root, a loop or an orphan
 * hangs from the root, a question with fewer than two readings becomes an
 * ordinary node, and a reading outside a question becomes one too.
 * `maxQuestions` keeps the first that many questions and makes the rest
 * ordinary nodes: 1 for a theme the plan found Christians read differently,
 * 0 for any other, so no question is invented (LC-17678).
 */
export function assembleGeneratedMap(draft: GeneratedDraft, pool: readonly PoolVerse[], books: MapBookIndex, theme: string, maxQuestions = Number.POSITIVE_INFINITY): Record<string, unknown> | null {
	const byPoolId = new Map(pool.map((verse) => [verse.id.toUpperCase(), verse]));
	const passagesFor = (ids: readonly unknown[], max: number): string[] => {
		const verses = ids.flatMap((id) => {
			const hit = typeof id === "string" ? byPoolId.get(id.trim().toUpperCase()) : undefined;
			return hit ? [hit] : [];
		});
		return versesToPassages(verses).slice(0, max).map((passage) => formatPassage(passage, books));
	};

	interface Draft { rawId: string; id: string; parent: string | null; label: string; note: string; kind: MapNodeKind; refs: string[]; via: MapConnection }
	const used = new Set<string>();
	const idOf = new Map<string, string>();
	const nodes: Draft[] = [];
	const dropped = new Map<string, string | null>();
	for (const [index, raw] of (draft.nodes ?? []).entries()) {
		const rawId = String(raw.id ?? `n${index + 1}`);
		let id = rawId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `n${index + 1}`;
		if (!/^[a-z0-9]/.test(id)) id = `n${id}`;
		while (used.has(id)) id = `${id}-${index + 1}`;
		const parent = raw.parent === null || raw.parent === undefined ? null : String(raw.parent);
		const label = clip(raw.label, NODE_LABEL_MAX);
		const refs = passagesFor(raw.verses ?? [], NODE_REFS_MAX);
		if (idOf.has(rawId)) continue;
		if (!label || refs.length === 0) {
			dropped.set(rawId, parent);
			continue;
		}
		used.add(id);
		idOf.set(rawId, id);
		const kind = (MAP_NODE_KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as MapNodeKind) : "topic";
		nodes.push({
			rawId,
			id,
			parent,
			label,
			note: clip(raw.note, NODE_NOTE_MAX),
			kind,
			refs,
			via: { label: clip(raw.connection, CONNECTION_LABEL_MAX), refs: passagesFor(raw.connectionVerses ?? [], CONNECTION_REFS_MAX) },
		});
	}
	if (nodes.length < MAP_NODES_MIN) return null;

	// Parents: through dropped nodes to the nearest kept one, else the root.
	const root =
		nodes.find((node) => node.parent === null) ??
		nodes.find((node) => node.parent !== null && !idOf.has(node.parent) && !dropped.has(node.parent)) ??
		nodes[0];
	const resolveParent = (rawParent: string | null): string | null => {
		const seen = new Set<string>();
		let cursor = rawParent;
		while (cursor !== null && !idOf.has(cursor) && dropped.has(cursor) && !seen.has(cursor)) {
			seen.add(cursor);
			cursor = dropped.get(cursor) ?? null;
		}
		return cursor !== null && idOf.has(cursor) ? (idOf.get(cursor) as string) : null;
	};
	for (const node of nodes) {
		if (node === root) {
			node.parent = null;
			continue;
		}
		const parent = resolveParent(node.parent);
		node.parent = parent && parent !== node.id ? parent : root.id;
	}
	const byId = new Map(nodes.map((node) => [node.id, node]));
	// Loops and anything not reaching the root hang from the root.
	for (const node of nodes) {
		if (node === root) continue;
		const seen = new Set<string>([node.id]);
		let cursor = node.parent ? byId.get(node.parent) : undefined;
		while (cursor && cursor !== root && cursor.parent && !seen.has(cursor.id)) {
			seen.add(cursor.id);
			cursor = byId.get(cursor.parent);
		}
		if (cursor !== root) node.parent = root.id;
	}
	root.kind = "topic";

	// Questions hold two to four readings and nothing else; readings live only under questions.
	for (let pass = 0; pass < 4; pass++) {
		let changed = false;
		for (const node of nodes) {
			const parent = node.parent ? byId.get(node.parent) : undefined;
			if (node.kind === "reading" && parent?.kind !== "question") {
				node.kind = "topic";
				changed = true;
			}
			if (parent?.kind === "reading") {
				const question = parent.parent ? byId.get(parent.parent) : undefined;
				node.parent = question?.parent ?? root.id;
				changed = true;
			}
			if (parent?.kind === "question" && node.kind !== "reading") {
				node.parent = parent.parent ?? root.id;
				changed = true;
			}
		}
		for (const node of nodes) {
			if (node.kind !== "question") continue;
			const readings = nodes.filter((child) => child.parent === node.id);
			if (readings.length < READINGS_MIN || node === root) {
				node.kind = "topic";
				for (const reading of readings) reading.kind = "topic";
				changed = true;
			} else if (readings.length > READINGS_MAX) {
				for (const extra of readings.slice(READINGS_MAX)) extra.parent = node.parent ?? root.id;
				for (const extra of readings.slice(READINGS_MAX)) extra.kind = "topic";
				changed = true;
			}
		}
		if (!changed) break;
	}
	// Only once the structure is settled, so a question still being repaired cannot take the place of a sound one.
	let questions = 0;
	for (const node of nodes) {
		if (node.kind !== "question" || questions++ < maxQuestions) continue;
		node.kind = "topic";
		for (const reading of nodes.filter((child) => child.parent === node.id)) reading.kind = "topic";
	}

	// Pre-order from the root, so the map reads top to bottom as it was meant.
	const ordered: Draft[] = [];
	const visit = (node: Draft) => {
		if (ordered.length >= MAP_NODES_MAX || ordered.includes(node)) return;
		ordered.push(node);
		for (const child of nodes.filter((item) => item.parent === node.id)) visit(child);
	};
	visit(root);

	const kept = new Set(ordered.map((node) => node.id));
	const pairs = new Set<string>();
	const links: Record<string, unknown>[] = [];
	for (const raw of draft.links ?? []) {
		const from = idOf.get(String(raw.from));
		const to = idOf.get(String(raw.to));
		if (!from || !to || from === to || !kept.has(from) || !kept.has(to)) continue;
		if (byId.get(to)?.parent === from || byId.get(from)?.parent === to) continue;
		const pair = [from, to].sort().join(" ");
		const label = clip(raw.label, CONNECTION_LABEL_MAX);
		const refs = passagesFor(raw.verses ?? [], CONNECTION_REFS_MAX);
		if (pairs.has(pair) || !label || refs.length === 0) continue;
		pairs.add(pair);
		links.push({ id: `link-${links.length + 1}`, from, to, label, refs });
		if (links.length >= MAP_LINKS_MAX) break;
	}

	return {
		version: 1,
		title: clip(draft.title, MAP_TITLE_MAX) || clip(theme, MAP_TITLE_MAX),
		summary: clip(draft.summary, MAP_SUMMARY_MAX),
		topics: normalizeMapTopics(draft.topics),
		nodes: ordered.map((node) => ({
			id: node.id,
			parentId: node.parent,
			label: node.label,
			note: node.note,
			kind: node.kind,
			refs: node.refs,
			via: node.parent === null ? null : node.via,
		})),
		links,
		origin: { kind: "generated", theme: clip(theme, THEME_MAX) },
	};
}
