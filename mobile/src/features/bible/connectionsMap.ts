/**
 * Pure geometry and palette for the Connections map: every verse of the Bible
 * laid around one ring, Genesis 1:1 at the top running clockwise to
 * Revelation 22:21, with each cross-reference drawn as a chord between its
 * two verses.
 *
 * Mirrored byte for byte at mobile/src/features/bible/connectionsMap.ts
 * (tests/connections-map.test.mjs fails on drift). No imports, so the
 * web, Android and the logic tests all run the same file.
 */

export interface ConnectionSection {
	id: string;
	label: string;
	/** Chip label where the full one does not fit. */
	short: string;
	color: string;
	first: number;
	last: number;
}

/**
 * The ten sections of the canon, coloured as the arcs are drawn. Acts gets
 * its own colour so the bridge between the Gospels and the Epistles reads on
 * the baseline.
 */
export const CONNECTION_SECTIONS: readonly ConnectionSection[] = [
	{ id: "law", label: "Law", short: "Law", color: "#ff5c8a", first: 1, last: 5 },
	{ id: "history", label: "History", short: "History", color: "#ff8a3d", first: 6, last: 17 },
	{ id: "poetry", label: "Poetry & Wisdom", short: "Poetry", color: "#f5c542", first: 18, last: 22 },
	{ id: "major", label: "Major Prophets", short: "Major", color: "#e054d6", first: 23, last: 27 },
	{ id: "minor", label: "Minor Prophets", short: "Minor", color: "#b8cc3a", first: 28, last: 39 },
	{ id: "gospels", label: "Gospels", short: "Gospels", color: "#2cc9b8", first: 40, last: 43 },
	{ id: "acts", label: "Acts", short: "Acts", color: "#46d36e", first: 44, last: 44 },
	{ id: "pauline", label: "Pauline Epistles", short: "Paul", color: "#4a9dff", first: 45, last: 57 },
	{ id: "general", label: "General Epistles", short: "General", color: "#6fe3f5", first: 58, last: 65 },
	{ id: "revelation", label: "Revelation", short: "Revelation", color: "#a98bff", first: 66, last: 66 },
];

/** The section a book (canonical order 1-66) belongs to. */
export function connectionSectionOf(order: number): ConnectionSection {
	for (const section of CONNECTION_SECTIONS) {
		if (order >= section.first && order <= section.last) return section;
	}
	return CONNECTION_SECTIONS[CONNECTION_SECTIONS.length - 1];
}

/**
 * A section colour readable as text. The palette is tuned for the dark ring;
 * on a light background the pale ones (General's cyan, Poetry's gold) wash
 * out, so text darkens them by mixing toward black.
 */
export function sectionInk(color: string, isDark: boolean): string {
	if (isDark) return color;
	const value = Number.parseInt(color.slice(1), 16);
	const mix = (channel: number) => Math.round(channel * 0.62).toString(16).padStart(2, "0");
	return `#${mix((value >> 16) & 255)}${mix((value >> 8) & 255)}${mix(value & 255)}`;
}

/** One book's run around the ring: [order, first global verse index, verse count]. */
export type BaselineBook = [order: number, start: number, verses: number];

/** The book whose run contains a global verse index (0-based). */
export function bookAtIndex(books: readonly BaselineBook[], index: number): number {
	let low = 0;
	let high = books.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if (books[mid][1] <= index) low = mid;
		else high = mid - 1;
	}
	return books[low]?.[0] ?? 1;
}

/**
 * The ring: every verse of the Bible around one circle, clockwise from
 * Genesis 1:1 just right of twelve o'clock to Revelation 22:21 just left of
 * it. The small gap at the top is where the canon begins and ends.
 */
export interface RingFrame {
	cx: number;
	cy: number;
	/** Radius of the book ring's centre line; chords end just inside it. */
	r: number;
	total: number;
}

/** Radians left empty at twelve o'clock between Revelation and Genesis. */
export const RING_GAP = 0.06;

/** Angle of a global verse index (0 = Genesis 1:1), y-down screen radians. */
export function angleOfIndex(frame: RingFrame, index: number): number {
	const sweep = Math.PI * 2 - RING_GAP;
	return -Math.PI / 2 + RING_GAP / 2 + ((index + 0.5) / frame.total) * sweep;
}

/**
 * The global verse index under a screen angle, or null inside the gap at
 * twelve o'clock. The inverse of angleOfIndex, for taps on the ring.
 */
export function indexAtAngle(frame: RingFrame, angle: number): number | null {
	const sweep = Math.PI * 2 - RING_GAP;
	let offset = angle - (-Math.PI / 2 + RING_GAP / 2);
	offset = ((offset % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
	if (offset > sweep) return null;
	return Math.min(frame.total - 1, Math.max(0, Math.floor((offset / sweep) * frame.total)));
}

export function pointAt(frame: RingFrame, angle: number, radius: number): { x: number; y: number } {
	return { x: frame.cx + Math.cos(angle) * radius, y: frame.cy + Math.sin(angle) * radius };
}

/**
 * A chord between two verses, bowed toward the centre. Links between near
 * verses hug the rim and links across the canon sweep through the middle,
 * which is what makes the circle readable at a glance.
 */
export function chordPath(frame: RingFrame, a: number, b: number, inset = 0): string {
	const radius = frame.r - inset;
	const angleA = angleOfIndex(frame, a);
	const angleB = angleOfIndex(frame, b);
	const p = pointAt(frame, angleA, radius);
	const q = pointAt(frame, angleB, radius);
	// Pull the control point from the chord's midpoint toward the centre.
	const mx = (p.x + q.x) / 2;
	const my = (p.y + q.y) / 2;
	const pull = 0.82;
	const ctrlX = mx + (frame.cx - mx) * pull;
	const ctrlY = my + (frame.cy - my) * pull;
	return `M${p.x.toFixed(1)} ${p.y.toFixed(1)}Q${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
}

/**
 * The arc of the ring covering global indexes [start, end), as a stroke path
 * (draw it with a wide strokeWidth for the band). `trim` shaves radians off
 * both ends so neighbouring books read as separate segments.
 */
export function ringArcPath(frame: RingFrame, start: number, end: number, radius: number, trim = 0): string {
	const rawFrom = angleOfIndex(frame, start - 0.5);
	const rawTo = angleOfIndex(frame, end - 0.5);
	// Short books (Obadiah, 2 John, Jude) span less than two trims; shave a
	// fraction of their arc instead so every book still draws.
	const shave = Math.min(trim, (rawTo - rawFrom) * 0.2);
	const from = rawFrom + shave;
	const to = rawTo - shave;
	if (to <= from) return "";
	const p = pointAt(frame, from, radius);
	const q = pointAt(frame, to, radius);
	const large = to - from > Math.PI ? 1 : 0;
	return `M${p.x.toFixed(1)} ${p.y.toFixed(1)}A${radius.toFixed(1)} ${radius.toFixed(1)} 0 ${large} 1 ${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
}

/** Where a section's ring segment begins and ends: [firstIndex, endIndex). */
export function sectionSpan(books: readonly BaselineBook[], section: ConnectionSection): [number, number] {
	let start = Number.POSITIVE_INFINITY;
	let end = 0;
	for (const [order, bookStart, verses] of books) {
		if (order < section.first || order > section.last) continue;
		start = Math.min(start, bookStart);
		end = Math.max(end, bookStart + verses);
	}
	return [start === Number.POSITIVE_INFINITY ? 0 : start, end];
}

export interface ArcBatch {
	key: string;
	color: string;
	d: string;
}

/**
 * Join arcs that share a colour into one path each. A chapter can carry well
 * over a thousand links, and a few long paths draw far faster than a thousand
 * small ones on every platform.
 */
export function batchArcs(arcs: Iterable<{ color: string; d: string }>): ArcBatch[] {
	const byColor = new Map<string, string[]>();
	for (const arc of arcs) {
		const list = byColor.get(arc.color);
		if (list) list.push(arc.d);
		else byColor.set(arc.color, [arc.d]);
	}
	return [...byColor.entries()].map(([color, parts]) => ({ key: color, color, d: parts.join("") }));
}

/** One cross-reference from the chapter: [fromVerse, toOrder, toChapter, toVerse, toIndex]. */
export type ChapterLink = [verse: number, order: number, chapter: number, toVerse: number, index: number];

/** The overview's weighted bin pairs: [leftBin, rightBin, weight]. */
export type OverviewPair = [a: number, b: number, weight: number];

/** How many links in a set land in each section, in canon order. */
export function sectionCounts(orders: Iterable<number>): Map<string, number> {
	const counts = new Map<string, number>();
	for (const order of orders) {
		const id = connectionSectionOf(order).id;
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return counts;
}

export interface ConnectionExplanation {
	/** The thread through all the passages; may still be streaming. */
	summary: string;
	/** One entry per "REFERENCE :: explanation" line, in answer order. */
	items: { reference: string; text: string }[];
}

/**
 * Split the explain answer (see connectionsSystemPrompt) into the summary and
 * one card per passage. Tolerant of a stream cut mid-line: while streaming, a
 * last line without the separator is held back until it gains one. Pass
 * `complete` once the answer has finished so that line is kept.
 */
export function parseConnectionExplanation(raw: string, complete = false): ConnectionExplanation {
	const summary: string[] = [];
	const items: { reference: string; text: string }[] = [];
	const lines = raw.split(/\r?\n/);
	lines.forEach((line, at) => {
		const trimmed = line.trim().replace(/^[-*•]\s*/, "");
		if (!trimmed) return;
		const split = trimmed.indexOf("::");
		if (split > 0) {
			const reference = trimmed.slice(0, split).replace(/\*/g, "").trim();
			items.push({ reference, text: trimmed.slice(split + 2).trim() });
		} else if (!complete && items.length > 0 && at === lines.length - 1) {
			// The next passage's reference, still arriving: wait for its "::".
		} else if (items.length > 0) {
			// A wrapped continuation belongs to the passage above it.
			const last = items[items.length - 1];
			last.text = `${last.text} ${trimmed}`.trim();
		} else {
			summary.push(trimmed);
		}
	});
	return { summary: summary.join(" "), items };
}

/**
 * The prompt the "Ask why these connect" button sends to chat. The verse
 * itself rides as an attachment; the prompt names the links so the answer
 * walks through them instead of choosing its own.
 */
export function connectionsAskPrompt(reference: string, linked: readonly string[]): string {
	const shown = linked.slice(0, 10);
	const list = shown.join(", ");
	return `How does ${reference} connect to ${list}? Walk me through what ties these passages together in the King James Bible.`;
}
