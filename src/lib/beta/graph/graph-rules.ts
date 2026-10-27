/**
 * Pure rules for the Living Study Graph (LC-17646, docs/beta/graph.md): how a
 * founder's study becomes nodes and edges, where each node sits, which pairs
 * of studies are worth suggesting as connected (and why, in words a student
 * can check), how the graph is searched, and how a topic is followed across
 * books and over time.
 *
 * No imports on purpose: `tests/beta-graph.test.mjs` loads this file with
 * Node's type stripping. The server half, which reads SureWord's tables and
 * the bundled cross-references, is `graph.ts`.
 */

/** Things studied that get a node of their own. Highlights, Learn cards and reading fold into their passage. */
export const GRAPH_ENTRY_KINDS = ["note", "chat", "sermon", "study"] as const;
export type GraphEntryKind = (typeof GRAPH_ENTRY_KINDS)[number];
export type GraphNodeKind = "passage" | "topic" | GraphEntryKind;

export const GRAPH_KIND_LABEL: Record<GraphNodeKind, string> = {
	passage: "Passage",
	topic: "Topic",
	note: "Note",
	chat: "Chat",
	sermon: "Sermon study",
	study: "Study",
};

export const GRAPH_KIND_PLURAL: Record<GraphNodeKind, string> = {
	passage: "Passages",
	topic: "Topics",
	note: "Notes",
	chat: "Chats",
	sermon: "Sermon studies",
	study: "Studies",
};

export type GraphEdgeKind = "passage" | "topic" | "wikilink" | "link" | "suggested" | "crossref" | "contains";

/** The link kind a dismissed suggestion is kept as, so it is never offered again. Never drawn. */
export const DISMISSED_LINK_KIND = "not-related";
/** The link kind suggestions are made with. */
export const SUGGESTED_LINK_KIND = "related";

export interface GraphNode {
	id: string;
	kind: GraphNodeKind;
	label: string;
	/** A short line under the label: the module, a date, a verse count. */
	detail: string | null;
	/** Where it lives in SureWord; null for topics, which live nowhere but here. */
	href: string | null;
	/** ISO date it was last studied, for entries and passages. */
	date: string | null;
	/** Passages: book order and chapter. */
	book?: number;
	chapter?: number;
	/** Studies (beta items): owning module slug, and the raw item id for link actions. */
	module?: string;
	itemId?: string;
	/** Things folded into a passage: highlights, Learn cards and days read on it. */
	folded?: { kind: "highlight" | "verse" | "reading"; label: string; href: string; date: string }[];
	/** How many edges touch it (drawn size). */
	degree: number;
	x: number;
	y: number;
}

export interface GraphEdge {
	id: string;
	kind: GraphEdgeKind;
	source: string;
	target: string;
	/** Links and suggestions: why they connect. Cross-references: the verses. */
	reason?: string | null;
	/** Links and suggestions: the BetaLink id, for accept, dismiss and remove. */
	linkId?: string;
	/** Cross-references: up to three verse pairs, "Romans 5:1" -> "Galatians 2:16". */
	verses?: [string, string][];
	/** Wikilinks: the target links back too (a link and a backlink). */
	both?: boolean;
}

export interface StudyGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
	/** Nodes drawn, by kind (the page lists them; `truncated` says the cap was reached). */
	counts: Record<GraphNodeKind, number>;
	truncated: boolean;
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** One studied thing, as the server reads it (a Vault entry or a beta item). */
export interface GraphEntryInput {
	id: string;
	kind: GraphEntryKind | "highlight" | "verse" | "reading";
	title: string;
	detail?: string | null;
	href: string;
	date: string;
	refs: readonly string[];
	topics: readonly string[];
	module?: string;
	itemId?: string;
	parentItemId?: string | null;
}

export interface GraphLinkInput {
	id: string;
	fromId: string;
	toId: string;
	kind: string;
	reason: string | null;
	origin: string;
}

export interface CrossRefInput {
	/** Chapter keys "45.5" and "48.2". */
	from: string;
	to: string;
	verses: [string, string][];
}

export interface BuildInput {
	entries: readonly GraphEntryInput[];
	/** Note wikilinks resolved to note ids: [sourceNoteId, targetNoteId]. */
	wikilinks: readonly [string, string][];
	links: readonly GraphLinkInput[];
	crossRefs: readonly CrossRefInput[];
	/** "45.5" -> "Romans 5". */
	chapterLabel: (key: string) => string;
	/** "45.5" -> where it sits around the ring, 0 (Genesis 1) to 1 (Revelation 22). */
	chapterPosition: (key: string) => number;
	/** "45.5" -> the reader's address. */
	chapterHref: (key: string) => string;
	maxNodes?: number;
}

export const GRAPH_MAX_NODES = 700;

/** The chapter keys ("45.5") a list of passage keys touches, in Bible order. */
export function chapterKeys(refs: readonly string[]): string[] {
	const out = new Set<string>();
	for (const ref of refs) {
		const parts = ref.split(".");
		if (parts.length >= 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) out.add(`${Number(parts[0])}.${Number(parts[1])}`);
	}
	return [...out].sort(compareKeys);
}

export function compareKeys(a: string, b: string): number {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return d;
	}
	return 0;
}

export function topicKey(label: string): string {
	return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function pairId(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Nodes and edges, before layout (x and y are zero). Entries keep their order (newest first) when the cap bites. */
export function buildGraph(input: BuildInput): StudyGraph {
	const max = input.maxNodes ?? GRAPH_MAX_NODES;
	const nodes = new Map<string, GraphNode>();
	const edges = new Map<string, GraphEdge>();
	const counts: Record<GraphNodeKind, number> = { passage: 0, topic: 0, note: 0, chat: 0, sermon: 0, study: 0 };
	let truncated = false;
	const itemNode = new Map<string, string>();
	const noteNode = new Map<string, string>();

	const addEdge = (edge: Omit<GraphEdge, "id">) => {
		if (edge.source === edge.target || !nodes.has(edge.source) || !nodes.has(edge.target)) return;
		const id = `${edge.kind}:${pairId(edge.source, edge.target)}`;
		if (!edges.has(id)) edges.set(id, { id, ...edge });
	};
	const ensurePassage = (key: string, date: string | null): GraphNode | null => {
		const id = `passage:${key}`;
		let node = nodes.get(id);
		if (!node) {
			if (nodes.size >= max) {
				truncated = true;
				return null;
			}
			const [book, chapter] = key.split(".").map(Number);
			node = { id, kind: "passage", label: input.chapterLabel(key), detail: null, href: input.chapterHref(key), date, book, chapter, folded: [], degree: 0, x: 0, y: 0 };
			nodes.set(id, node);
			counts.passage++;
		} else if (date && (!node.date || date > node.date)) node.date = date;
		return node;
	};
	const ensureTopic = (label: string): GraphNode | null => {
		const key = topicKey(label);
		if (!key) return null;
		const id = `topic:${key}`;
		let node = nodes.get(id);
		if (!node) {
			if (nodes.size >= max) {
				truncated = true;
				return null;
			}
			node = { id, kind: "topic", label: key, detail: null, href: null, date: null, degree: 0, x: 0, y: 0 };
			nodes.set(id, node);
			counts.topic++;
		}
		return node;
	};

	for (const entry of input.entries) {
		const chapters = chapterKeys(entry.refs);
		if (entry.kind === "highlight" || entry.kind === "verse" || entry.kind === "reading") {
			// Verse-level study belongs to its passage: it widens the passage, not the graph.
			for (const key of chapters) {
				const passage = ensurePassage(key, entry.date);
				if (passage && (passage.folded?.length ?? 0) < 40) passage.folded?.push({ kind: entry.kind, label: entry.detail ? `${entry.title} · ${entry.detail}` : entry.title, href: entry.href, date: entry.date });
				if (passage && entry.kind === "highlight") for (const topic of entry.topics) {
					const node = ensureTopic(topic);
					if (node) addEdge({ kind: "topic", source: passage.id, target: node.id });
				}
			}
			continue;
		}
		if (nodes.has(entry.id)) continue;
		if (nodes.size >= max) {
			truncated = true;
			continue;
		}
		const node: GraphNode = {
			id: entry.id,
			kind: entry.kind,
			label: entry.title,
			detail: entry.detail ?? null,
			href: entry.href,
			date: entry.date,
			...(entry.module && { module: entry.module }),
			...(entry.itemId && { itemId: entry.itemId }),
			degree: 0,
			x: 0,
			y: 0,
		};
		nodes.set(entry.id, node);
		counts[entry.kind]++;
		if (entry.itemId) itemNode.set(entry.itemId, entry.id);
		if (entry.kind === "note") noteNode.set(entry.id.slice("note:".length), entry.id);
		for (const key of chapters) {
			const passage = ensurePassage(key, entry.date);
			if (passage) addEdge({ kind: "passage", source: node.id, target: passage.id });
		}
		for (const topic of entry.topics) {
			const t = ensureTopic(topic);
			if (t) addEdge({ kind: "topic", source: node.id, target: t.id });
		}
	}

	for (const entry of input.entries) {
		if (!entry.itemId || !entry.parentItemId) continue;
		const child = itemNode.get(entry.itemId);
		const parent = itemNode.get(entry.parentItemId);
		if (child && parent) addEdge({ kind: "contains", source: parent, target: child });
	}
	for (const [from, to] of input.wikilinks) {
		const a = noteNode.get(from);
		const b = noteNode.get(to);
		if (!a || !b || a === b) continue;
		const existing = edges.get(`wikilink:${pairId(a, b)}`);
		if (existing) {
			if (existing.source !== a) existing.both = true;
		} else addEdge({ kind: "wikilink", source: a, target: b });
	}
	for (const link of input.links) {
		if (link.kind === DISMISSED_LINK_KIND) continue;
		const a = itemNode.get(link.fromId);
		const b = itemNode.get(link.toId);
		if (!a || !b) continue;
		const kind: GraphEdgeKind = link.origin === "suggested" ? "suggested" : "link";
		const id = `${kind}:${link.id}`;
		if (!edges.has(id)) edges.set(id, { id, kind, source: a, target: b, reason: link.reason, linkId: link.id });
	}
	for (const ref of input.crossRefs) addEdge({ kind: "crossref", source: `passage:${ref.from}`, target: `passage:${ref.to}`, verses: ref.verses.slice(0, 3) });

	for (const edge of edges.values()) {
		nodes.get(edge.source)!.degree++;
		nodes.get(edge.target)!.degree++;
	}
	// The founder's passages, evenly spaced around the ring in Bible order: the canon's own
	// proportions would crowd most study into the New Testament's last quarter of the circle.
	const passages = [...nodes.values()].filter((node) => node.kind === "passage");
	const canonical = new Map(passages.map((node) => [node.id, input.chapterPosition(`${node.book}.${node.chapter}`)]));
	passages.sort((a, b) => canonical.get(a.id)! - canonical.get(b.id)! || compareKeys(`${a.book}.${a.chapter}`, `${b.book}.${b.chapter}`));
	const positions = new Map(passages.map((node, i) => [node.id, i / Math.max(passages.length, 1)]));
	const out = { nodes: [...nodes.values()], edges: [...edges.values()], counts, truncated };
	layoutGraph(out, positions);
	return out;
}

// ---------------------------------------------------------------------------
// Layout: passages on a ring in Bible order (as the Connections ring lays out
// every verse), everything else drawn inside toward what it touches.
// ---------------------------------------------------------------------------

export const GRAPH_RADIUS = 1000;

/** A small deterministic generator, so the same study lays out the same way every visit. */
function seeded(text: string): () => number {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	return () => {
		h = Math.imul(h ^ (h >>> 15), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		h ^= h >>> 16;
		return (h >>> 0) / 4294967296;
	};
}

/** Places every node in place (mutates x and y). Passages sit on the ring at their canonical position. */
export function layoutGraph(graph: Pick<StudyGraph, "nodes" | "edges">, positions: ReadonlyMap<string, number>, iterations = 220): void {
	const R = GRAPH_RADIUS;
	const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
	const fixed = graph.nodes.map((node) => node.kind === "passage");
	const xs = new Float64Array(graph.nodes.length);
	const ys = new Float64Array(graph.nodes.length);
	graph.nodes.forEach((node, i) => {
		if (fixed[i]) {
			// Genesis just right of twelve o'clock, clockwise to Revelation, like the ring.
			const angle = -Math.PI / 2 + 2 * Math.PI * (0.004 + 0.992 * (positions.get(node.id) ?? 0));
			xs[i] = R * Math.cos(angle);
			ys[i] = R * Math.sin(angle);
		}
	});
	const neighbours: number[][] = graph.nodes.map(() => []);
	for (const edge of graph.edges) {
		const a = index.get(edge.source);
		const b = index.get(edge.target);
		if (a === undefined || b === undefined) continue;
		neighbours[a].push(b);
		neighbours[b].push(a);
	}
	// Start each free node at the centre of what it touches, jittered; loose ones start near the middle.
	graph.nodes.forEach((node, i) => {
		if (fixed[i]) return;
		const rand = seeded(node.id);
		const anchored = neighbours[i].filter((j) => fixed[j]);
		if (anchored.length) {
			xs[i] = anchored.reduce((sum, j) => sum + xs[j], 0) / anchored.length * 0.72 + (rand() - 0.5) * 120;
			ys[i] = anchored.reduce((sum, j) => sum + ys[j], 0) / anchored.length * 0.72 + (rand() - 0.5) * 120;
		} else {
			xs[i] = (rand() - 0.5) * R * 0.8;
			ys[i] = (rand() - 0.5) * R * 0.8;
		}
	});
	const free = graph.nodes.map((_, i) => i).filter((i) => !fixed[i]);
	if (!free.length) {
		graph.nodes.forEach((node, i) => ((node.x = Math.round(xs[i])), (node.y = Math.round(ys[i]))));
		return;
	}
	// Roomy for a small graph, tighter as it grows; zoom does the rest.
	const spacing = Math.max(70, Math.min(240, (R * 2) / Math.sqrt(free.length)));
	const cell = spacing * 2;
	for (let step = 0; step < iterations; step++) {
		const heat = 1 - step / iterations;
		const dx = new Float64Array(graph.nodes.length);
		const dy = new Float64Array(graph.nodes.length);
		// Repulsion between free nodes, only within two spacings (a grid keeps it near linear).
		const grid = new Map<string, number[]>();
		for (const i of free) {
			const key = `${Math.floor(xs[i] / cell)},${Math.floor(ys[i] / cell)}`;
			const bucket = grid.get(key);
			if (bucket) bucket.push(i);
			else grid.set(key, [i]);
		}
		for (const i of free) {
			const gx = Math.floor(xs[i] / cell);
			const gy = Math.floor(ys[i] / cell);
			for (let ox = -1; ox <= 1; ox++)
				for (let oy = -1; oy <= 1; oy++)
					for (const j of grid.get(`${gx + ox},${gy + oy}`) ?? []) {
						if (j <= i) continue;
						let ddx = xs[i] - xs[j];
						let ddy = ys[i] - ys[j];
						let dist2 = ddx * ddx + ddy * ddy;
						if (dist2 < 1) {
							ddx = (i % 7) - 3 || 1;
							ddy = (j % 5) - 2 || 1;
							dist2 = ddx * ddx + ddy * ddy;
						}
						if (dist2 > cell * cell) continue;
						const force = (spacing * spacing) / dist2;
						const dist = Math.sqrt(dist2);
						dx[i] += (ddx / dist) * force;
						dy[i] += (ddy / dist) * force;
						dx[j] -= (ddx / dist) * force;
						dy[j] -= (ddy / dist) * force;
					}
		}
		// Springs toward what each node touches.
		for (const i of free) {
			for (const j of neighbours[i]) {
				const ddx = xs[j] - xs[i];
				const ddy = ys[j] - ys[i];
				const pull = fixed[j] ? 0.035 : 0.06;
				dx[i] += ddx * pull;
				dy[i] += ddy * pull;
			}
			// Keep everything inside the ring.
			const r = Math.hypot(xs[i], ys[i]);
			const limit = R * 0.86;
			if (r > limit) {
				dx[i] -= (xs[i] / r) * (r - limit) * 0.5;
				dy[i] -= (ys[i] / r) * (r - limit) * 0.5;
			}
		}
		const cap = spacing * (0.2 + 1.3 * heat);
		for (const i of free) {
			const len = Math.hypot(dx[i], dy[i]);
			const scale = len > cap ? cap / len : 1;
			xs[i] += dx[i] * scale;
			ys[i] += dy[i] * scale;
		}
	}
	// Last, push apart any two that still sit on top of each other, so every dot keeps a visible part to tap.
	const minDist = spacing * 0.7;
	for (let pass = 0; pass < 6; pass++) {
		const grid = new Map<string, number[]>();
		graph.nodes.forEach((_, i) => {
			const key = `${Math.floor(xs[i] / minDist)},${Math.floor(ys[i] / minDist)}`;
			const bucket = grid.get(key);
			if (bucket) bucket.push(i);
			else grid.set(key, [i]);
		});
		let moved = false;
		for (const i of free) {
			const gx = Math.floor(xs[i] / minDist);
			const gy = Math.floor(ys[i] / minDist);
			for (let ox = -1; ox <= 1; ox++)
				for (let oy = -1; oy <= 1; oy++)
					for (const j of grid.get(`${gx + ox},${gy + oy}`) ?? []) {
						if (j === i || (!fixed[j] && j < i)) continue;
						const ddx = xs[i] - xs[j];
						const ddy = ys[i] - ys[j];
						const dist = Math.hypot(ddx, ddy) || 1;
						if (dist >= minDist) continue;
						const push = (minDist - dist) / (fixed[j] ? 1 : 2);
						const ux = dist === 1 && !ddx && !ddy ? 1 : ddx / dist;
						const uy = dist === 1 && !ddx && !ddy ? 0 : ddy / dist;
						xs[i] += ux * push;
						ys[i] += uy * push;
						if (!fixed[j]) {
							xs[j] -= ux * push;
							ys[j] -= uy * push;
						}
						moved = true;
					}
			const r = Math.hypot(xs[i], ys[i]);
			if (r > R * 0.9) {
				xs[i] *= (R * 0.9) / r;
				ys[i] *= (R * 0.9) / r;
			}
		}
		if (!moved) break;
	}
	graph.nodes.forEach((node, i) => {
		node.x = Math.round(xs[i]);
		node.y = Math.round(ys[i]);
	});
}

// ---------------------------------------------------------------------------
// Suggested connections between studies (beta items)
// ---------------------------------------------------------------------------

export interface SuggestionStudy {
	itemId: string;
	title: string;
	/** Passage keys as the store keeps them (chapter and verse keys). */
	refs: readonly string[];
	topics: readonly string[];
	updatedAt: string;
	parentItemId?: string | null;
}

export interface SuggestionInput {
	studies: readonly SuggestionStudy[];
	/** Cross-references between chapter keys, with their verse pairs as passage keys: [["45.5.1", "48.2.16"]]. */
	crossRefs: readonly { from: string; to: string; verseKeys: [string, string][] }[];
	/** Pairs of item ids already linked in either direction, any kind (dismissals included). */
	linked: ReadonlySet<string>;
	/** Only pairs that include this item. */
	focusItemId?: string | null;
	/** "45.5" or "45.5.1" -> "Romans 5" / "Romans 5:1". */
	label: (key: string) => string;
	max?: number;
}

export interface Suggestion {
	fromId: string;
	toId: string;
	score: number;
	reason: string;
}

export const SUGGESTION_MAX = 8;
/** A shared topic, a shared chapter, or a cross-reference both studies name at the verse. */
export const SUGGESTION_MIN_SCORE = 2;

export function linkedKey(a: string, b: string): string {
	return pairId(a, b);
}

function list(items: readonly string[]): string {
	if (items.length <= 1) return items[0] ?? "";
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Pairs of studies worth connecting, best first, each with a reason built
 * only from what both studies actually hold: the topics they share, the
 * chapters they both study, and cross-references (the same bundled set the
 * Connections ring draws) between verses each of them names. The newer study
 * is the one the reason starts from, so "today's study" reads as touching an
 * earlier one.
 */
export function suggestConnections(input: SuggestionInput): Suggestion[] {
	const max = input.max ?? SUGGESTION_MAX;
	const crossByChapter = new Map<string, [string, string][]>();
	for (const ref of input.crossRefs) {
		const key = pairId(ref.from, ref.to);
		const pairs = crossByChapter.get(key) ?? [];
		for (const [a, b] of ref.verseKeys) pairs.push(ref.from < ref.to ? [a, b] : [b, a]);
		crossByChapter.set(key, pairs);
	}
	const prepared = input.studies.map((study) => ({
		study,
		chapters: new Set(chapterKeys(study.refs)),
		verses: new Set(study.refs.filter((ref) => ref.split(".").length === 3)),
		topics: new Set(study.topics.map(topicKey).filter(Boolean)),
	}));
	const out: Suggestion[] = [];
	for (let i = 0; i < prepared.length; i++) {
		for (let j = i + 1; j < prepared.length; j++) {
			let a = prepared[i];
			let b = prepared[j];
			if (input.focusItemId && a.study.itemId !== input.focusItemId && b.study.itemId !== input.focusItemId) continue;
			if (input.linked.has(pairId(a.study.itemId, b.study.itemId))) continue;
			if (a.study.parentItemId === b.study.itemId || b.study.parentItemId === a.study.itemId) continue;
			// The newer study speaks first.
			if (a.study.updatedAt < b.study.updatedAt) [a, b] = [b, a];
			const topics = [...a.topics].filter((topic) => b.topics.has(topic)).sort();
			const chapters = [...a.chapters].filter((key) => b.chapters.has(key)).sort(compareKeys);
			const verseCross: [string, string][] = [];
			let chapterCross = 0;
			for (const ca of a.chapters) {
				for (const cb of b.chapters) {
					if (ca === cb) continue;
					const pairs = crossByChapter.get(pairId(ca, cb));
					if (!pairs?.length) continue;
					chapterCross++;
					for (const [x, y] of pairs) {
						if (a.verses.has(x) && b.verses.has(y)) verseCross.push([x, y]);
						else if (a.verses.has(y) && b.verses.has(x)) verseCross.push([y, x]);
					}
				}
			}
			const uniqueCross = [...new Map(verseCross.map((pair) => [pair.join("|"), pair])).values()];
			// A cross-reference only between their chapters is named by its first verse pair, the newer study's side first.
			let chapterExample: [string, string] | null = null;
			if (chapterCross && !uniqueCross.length) {
				outer: for (const ca of a.chapters) {
					for (const cb of b.chapters) {
						const first = ca === cb ? undefined : crossByChapter.get(pairId(ca, cb))?.[0];
						if (!first) continue;
						chapterExample = first[0].startsWith(`${ca}.`) ? first : [first[1], first[0]];
						break outer;
					}
				}
			}
			const score = topics.length * 3 + chapters.length * 2 + Math.min(uniqueCross.length, 3) * 2 + (chapterCross && !uniqueCross.length ? 1 : 0);
			if (score < SUGGESTION_MIN_SCORE) continue;
			const parts: string[] = [];
			if (topics.length) parts.push(`both are about ${list(topics.slice(0, 3))}`);
			if (chapters.length) parts.push(`both study ${list(chapters.slice(0, 3).map(input.label))}`);
			if (uniqueCross.length) {
				const [x, y] = uniqueCross[0];
				parts.push(`${input.label(x)} and ${input.label(y)} are cross-references${uniqueCross.length > 1 ? ` (${uniqueCross.length} in all)` : ""}`);
			} else if (chapterExample && !chapters.length) {
				parts.push(`their chapters meet in a cross-reference (${input.label(chapterExample[0])} and ${input.label(chapterExample[1])})`);
			}
			const reason = `“${a.study.title}” and “${b.study.title}”: ${parts.join("; ")}.`;
			out.push({ fromId: a.study.itemId, toId: b.study.itemId, score, reason: reason.length > 1000 ? `${reason.slice(0, 997)}…` : reason });
		}
	}
	// A source inside a study is not offered the partner its parent already has (suggested now or linked before).
	const parentOf = new Map(input.studies.filter((study) => study.parentItemId).map((study) => [study.itemId, study.parentItemId!]));
	const offered = new Set(out.map((suggestion) => pairId(suggestion.fromId, suggestion.toId)));
	const covered = (child: string, other: string) => {
		const parent = parentOf.get(child);
		return !!parent && (offered.has(pairId(parent, other)) || input.linked.has(pairId(parent, other)));
	};
	return out
		.filter((suggestion) => !covered(suggestion.fromId, suggestion.toId) && !covered(suggestion.toId, suggestion.fromId))
		.sort((x, y) => y.score - x.score || x.reason.localeCompare(y.reason))
		.slice(0, max);
}

// ---------------------------------------------------------------------------
// Search and following a topic
// ---------------------------------------------------------------------------

function fold(text: string): string {
	return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Nodes whose label (or detail) holds every word typed, best first: label starts, then label holds, then detail holds. */
export function searchGraph(nodes: readonly GraphNode[], query: string, max = 8): GraphNode[] {
	const words = fold(query).split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	const scored: { node: GraphNode; score: number }[] = [];
	for (const node of nodes) {
		const label = fold(node.label);
		const detail = fold(node.detail ?? "");
		if (!words.every((word) => label.includes(word) || detail.includes(word))) continue;
		const score = (label.startsWith(words[0]) ? 4 : 0) + (words.every((word) => label.includes(word)) ? 2 : 0) + (node.kind === "passage" || node.kind === "topic" ? 1 : 0) + Math.min(node.degree, 20) / 100;
		scored.push({ node, score });
	}
	return scored.sort((a, b) => b.score - a.score || a.node.label.localeCompare(b.node.label)).slice(0, max).map(({ node }) => node);
}

export interface TopicTrail {
	topic: string;
	/** Books the topic reaches through its studies, in Bible order, with their chapters. */
	books: { book: number; name: string; passages: GraphNode[] }[];
	/** Everything studied on the topic, oldest first, grouped by month ("2026-03"). */
	months: { month: string; nodes: GraphNode[] }[];
}

/** A topic followed across books (through what is studied on it) and over time. */
export function followTopic(graph: Pick<StudyGraph, "nodes" | "edges">, topicId: string, bookName: (order: number) => string): TopicTrail | null {
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const topic = byId.get(topicId);
	if (!topic || topic.kind !== "topic") return null;
	const touching = new Set<string>();
	for (const edge of graph.edges) {
		if (edge.kind !== "topic") continue;
		if (edge.source === topicId) touching.add(edge.target);
		if (edge.target === topicId) touching.add(edge.source);
	}
	const passages = new Map<string, GraphNode>();
	const studied: GraphNode[] = [];
	for (const id of touching) {
		const node = byId.get(id);
		if (!node) continue;
		if (node.kind === "passage") passages.set(id, node);
		else studied.push(node);
	}
	const studiedIds = new Set(studied.map((node) => node.id));
	for (const edge of graph.edges) {
		if (edge.kind !== "passage") continue;
		const [entry, passage] = studiedIds.has(edge.source) ? [edge.source, edge.target] : studiedIds.has(edge.target) ? [edge.target, edge.source] : [null, null];
		if (!entry || !passage) continue;
		const node = byId.get(passage);
		if (node?.kind === "passage") passages.set(passage, node);
	}
	const books = new Map<number, GraphNode[]>();
	for (const node of passages.values()) {
		const list = books.get(node.book ?? 0) ?? [];
		list.push(node);
		books.set(node.book ?? 0, list);
	}
	const months = new Map<string, GraphNode[]>();
	for (const node of studied.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))) {
		const month = (node.date ?? "").slice(0, 7) || "undated";
		const list = months.get(month) ?? [];
		list.push(node);
		months.set(month, list);
	}
	return {
		topic: topic.label,
		books: [...books.entries()].sort((a, b) => a[0] - b[0]).map(([book, list]) => ({ book, name: bookName(book), passages: list.sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0)) })),
		months: [...months.entries()].map(([month, nodes]) => ({ month, nodes })),
	};
}

/** Every node one edge away, with the edge, for the detail panel. Suggestions first, then links, then the rest by kind. */
export function neighbourhood(graph: Pick<StudyGraph, "nodes" | "edges">, nodeId: string): { node: GraphNode; edge: GraphEdge }[] {
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const order: Record<GraphEdgeKind, number> = { suggested: 0, link: 1, wikilink: 2, contains: 3, crossref: 4, passage: 5, topic: 6 };
	const out: { node: GraphNode; edge: GraphEdge }[] = [];
	for (const edge of graph.edges) {
		const other = edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : null;
		const node = other ? byId.get(other) : undefined;
		if (node) out.push({ node, edge });
	}
	return out.sort((a, b) => order[a.edge.kind] - order[b.edge.kind] || a.node.label.localeCompare(b.node.label));
}
