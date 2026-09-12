import "server-only";

import { prisma } from "@/lib/prisma";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import { getChapter, type TranslationId } from "@/lib/bible/translations";
import { resolveReference } from "@/lib/bible/books";
import { getKjvBookName } from "@/utils/kjvBible";

/** One highlighted verse, resolved to a reference, a colour name and its text. */
export interface HighlightedVerse {
	reference: string;
	book: string;
	chapter: number;
	verse: number;
	/** "#RRGGBB" as stored. */
	color: string;
	/** Preset name for that hex ("Yellow"), or null for a custom colour. */
	colorName: string | null;
	text?: string;
	highlightedAt: string;
}

export interface HighlightQuery {
	translation: TranslationId;
	/** Canonical book order, 1-66. */
	book?: number;
	chapter?: number;
	limit?: number;
}

export interface HighlightListing {
	/** How many highlights match the filter in total, before `limit`. */
	total: number;
	highlights: HighlightedVerse[];
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

function colorNameFor(hex: string): string | null {
	const normalized = hex.trim().toLowerCase();
	return HIGHLIGHT_COLORS.find((preset) => preset.hex.toLowerCase() === normalized)?.name ?? null;
}

/**
 * The user's highlighted verses, newest first, with the verse text filled in
 * from the requested translation. Chapters are loaded once each rather than
 * once per verse, so a book full of highlights is still a handful of reads.
 */
export async function listUserHighlights(
	userId: string,
	query: HighlightQuery,
): Promise<HighlightListing> {
	const where = {
		userId,
		translation: query.translation,
		...(query.book !== undefined ? { book: query.book } : {}),
		...(query.book !== undefined && query.chapter !== undefined ? { chapter: query.chapter } : {}),
	};
	const take = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

	const [total, rows] = await Promise.all([
		prisma.verseHighlight.count({ where }),
		prisma.verseHighlight.findMany({
			where,
			orderBy: { updatedAt: "desc" },
			take,
			select: { book: true, chapter: true, verse: true, color: true, updatedAt: true },
		}),
	]);

	// One getChapter per distinct chapter; a missing or unreachable chapter just
	// leaves that verse without text rather than failing the whole listing.
	const chapterKeys = [...new Set(rows.map((row) => `${row.book}:${row.chapter}`))];
	const chapters = new Map<string, string[]>();
	await Promise.all(
		chapterKeys.map(async (key) => {
			const [book, chapter] = key.split(":").map(Number);
			try {
				chapters.set(key, await getChapter(query.translation, book, chapter));
			} catch {
				// Leave it unset: the reference and colour still answer the question.
			}
		}),
	);

	const highlights = rows.map((row): HighlightedVerse => {
		const book = getKjvBookName(row.book) ?? `Book ${row.book}`;
		const text = chapters.get(`${row.book}:${row.chapter}`)?.[row.verse - 1];
		return {
			reference: `${book} ${row.chapter}:${row.verse}`,
			book,
			chapter: row.chapter,
			verse: row.verse,
			color: row.color,
			colorName: colorNameFor(row.color),
			...(text ? { text } : {}),
			highlightedAt: row.updatedAt.toISOString(),
		};
	});

	return { total, highlights };
}

/** A ready-to-read block for the model, so it quotes highlights word for word. */
export function formatHighlightsForModel(
	listing: HighlightListing,
	translation: TranslationId,
	scope: string,
): string {
	if (listing.highlights.length === 0) {
		return `The user has no highlighted verses ${scope}.`;
	}
	const lines = listing.highlights.map((highlight) => {
		const colour = highlight.colorName ?? highlight.color;
		const text = highlight.text ? ` - "${highlight.text}"` : "";
		return `- ${highlight.reference} (${colour})${text}`;
	});
	const shown =
		listing.total > listing.highlights.length
			? `Showing the ${listing.highlights.length} most recent of ${listing.total} highlights ${scope}`
			: `All ${listing.total} highlights ${scope}`;
	return `${shown} (${translation}):\n${lines.join("\n")}`;
}

/** One verse of one translation: the unique key a highlight lives under. */
export interface HighlightKey {
	translation: string;
	/** Canonical book order, 1-66. */
	book: number;
	chapter: number;
	verse: number;
}

/**
 * Create or replace the user's highlight on one verse (one highlight per verse
 * per translation, so a re-pick just changes the colour). Shared by
 * PUT /api/highlights and the highlightVerse chat tool so both write the same
 * row the reader renders.
 */
export function upsertUserHighlight(userId: string, key: HighlightKey & { color: string }) {
	const { translation, book, chapter, verse, color } = key;
	return prisma.verseHighlight.upsert({
		where: {
			userId_translation_book_chapter_verse: { userId, translation, book, chapter, verse },
		},
		update: { color },
		create: { userId, translation, book, chapter, verse, color },
	});
}

/** A range longer than this is almost certainly a model slip, not a request. */
export const MAX_HIGHLIGHT_VERSES = 10;

/** Yellow: the reader's first preset, and what "mark this" means without a colour. */
export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0];

/**
 * A colour the user named ("green"), a "#RRGGBB" hex, or nothing for the
 * default. An unknown name throws rather than falling back, so the assistant
 * says so instead of silently marking the verse yellow.
 */
export function resolveHighlightColor(input: string | undefined): { hex: string; name: string | null } {
	const trimmed = input?.trim();
	if (!trimmed) return { hex: DEFAULT_HIGHLIGHT_COLOR.hex, name: DEFAULT_HIGHLIGHT_COLOR.name };
	const preset = HIGHLIGHT_COLORS.find((color) => color.name.toLowerCase() === trimmed.toLowerCase());
	if (preset) return { hex: preset.hex, name: preset.name };
	if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
		const hex = trimmed.toUpperCase();
		return { hex, name: colorNameFor(hex) };
	}
	throw new Error(
		`"${trimmed}" is not a highlight colour. Use one of: ${HIGHLIGHT_COLORS.map((color) => color.name).join(", ")}.`
	);
}

export interface VerseRange {
	book: number;
	chapter: number;
	verse: number;
	endChapter: number;
	endVerse: number;
}

// resolveReference resolves a range to its first verse only, so the tail is
// read here. Dashes are escapes so the class survives tooling that flattens them.
const RANGE_TAIL = /[-\u2013\u2014]\s*(\d+)(?:\s*:\s*(\d+))?\s*$/;

/**
 * "Romans 8:28", "Romans 8:28-30" or "John 3:36-4:2" as a verse range. Throws
 * a message the model can relay when the reference is not a Bible verse, names
 * a whole chapter, or runs backwards.
 */
export function parseVerseRange(reference: string): VerseRange {
	const start = resolveReference(reference);
	if (!start) {
		throw new Error(`"${reference}" is not a Bible reference I can find. Give the book, chapter and verse, e.g. "Romans 8:28".`);
	}
	if (start.verse === undefined) {
		throw new Error(`"${reference}" names a whole chapter. Say which verse or verses to mark, e.g. "Romans 8:28-30".`);
	}
	const tail = reference.trim().match(RANGE_TAIL);
	let endChapter = start.chapter;
	let endVerse = start.verse;
	if (tail) {
		if (tail[2] !== undefined) {
			endChapter = Number.parseInt(tail[1], 10);
			endVerse = Number.parseInt(tail[2], 10);
		} else {
			endVerse = Number.parseInt(tail[1], 10);
		}
	}
	if (endChapter < start.chapter || (endChapter === start.chapter && endVerse < start.verse)) {
		throw new Error(`"${reference}" runs backwards. Give the first verse before the last.`);
	}
	return { book: start.order, chapter: start.chapter, verse: start.verse, endChapter, endVerse };
}

/**
 * Every verse a range covers, in order, stopping at MAX_HIGHLIGHT_VERSES. A
 * range end past the last verse of its chapter is clamped to the chapter
 * rather than refused ("Romans 8:38-45" marks 38 and 39); a start verse that
 * does not exist is refused.
 */
export async function expandVerseRange(
	range: VerseRange,
	verseCount: (chapter: number) => Promise<number>,
	max: number = MAX_HIGHLIGHT_VERSES
): Promise<{ verses: { chapter: number; verse: number }[]; capped: boolean }> {
	const verses: { chapter: number; verse: number }[] = [];
	for (let chapter = range.chapter; chapter <= range.endChapter; chapter++) {
		const count = await verseCount(chapter);
		const first = chapter === range.chapter ? range.verse : 1;
		if (chapter === range.chapter && first > count) {
			throw new Error(`That chapter has only ${count} verses, so verse ${first} does not exist.`);
		}
		const last = chapter === range.endChapter ? Math.min(range.endVerse, count) : count;
		for (let verse = first; verse <= last; verse++) {
			if (verses.length === max) return { verses, capped: true };
			verses.push({ chapter, verse });
		}
	}
	return { verses, capped: false };
}

/** What highlightVerse hands back; the receipt reads reference, book number, chapter and verse. */
export interface HighlightVerseResult {
	success: true;
	/** What was actually marked, e.g. "Romans 8:28-30" (after clamping and the cap). */
	reference: string;
	book: string;
	/** Canonical book order, 1-66, for the receipt's chapter target. */
	bookNumber: number;
	chapter: number;
	verse: number;
	endChapter: number;
	endVerse: number;
	verseCount: number;
	/** True when the requested range was longer than MAX_HIGHLIGHT_VERSES. */
	capped: boolean;
	/** "#RRGGBB" as stored. */
	color: string;
	/** Preset name for that hex, or null for a custom colour. */
	colorName: string | null;
	translation: TranslationId;
}

function formatRange(book: string, verses: readonly { chapter: number; verse: number }[]): string {
	const first = verses[0];
	const last = verses[verses.length - 1];
	if (first.chapter === last.chapter && first.verse === last.verse) return `${book} ${first.chapter}:${first.verse}`;
	if (first.chapter === last.chapter) return `${book} ${first.chapter}:${first.verse}-${last.verse}`;
	return `${book} ${first.chapter}:${first.verse}-${last.chapter}:${last.verse}`;
}

/**
 * Mark one verse or a short range in the user's reader, in the translation
 * they read. Verse counts come from the bundled KJV for every translation: the
 * NKJV keeps the KJV's versification, and it spares a network fetch per chapter.
 */
export async function highlightReference(options: {
	userId: string;
	reference: string;
	color?: string;
	translation: TranslationId;
}): Promise<HighlightVerseResult> {
	const color = resolveHighlightColor(options.color);
	const range = parseVerseRange(options.reference);
	const { verses, capped } = await expandVerseRange(range, async (chapter) => {
		try {
			return (await getChapter("KJV", range.book, chapter)).length;
		} catch {
			return 0;
		}
	});
	if (verses.length === 0) {
		throw new Error(`"${options.reference}" does not name a verse that exists.`);
	}

	const book = getKjvBookName(range.book) ?? `Book ${range.book}`;
	// One transaction: a range is marked whole or not at all.
	await prisma.$transaction(
		verses.map((key) =>
			upsertUserHighlight(options.userId, {
				translation: options.translation,
				book: range.book,
				chapter: key.chapter,
				verse: key.verse,
				color: color.hex,
			})
		)
	);

	const first = verses[0];
	const last = verses[verses.length - 1];
	return {
		success: true,
		reference: formatRange(book, verses),
		book,
		bookNumber: range.book,
		chapter: first.chapter,
		verse: first.verse,
		endChapter: last.chapter,
		endVerse: last.verse,
		verseCount: verses.length,
		capped,
		color: color.hex,
		colorName: color.name,
		translation: options.translation,
	};
}
