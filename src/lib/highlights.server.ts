import "server-only";

import { prisma } from "@/lib/prisma";
import { HIGHLIGHT_COLORS } from "@/lib/highlights";
import { getChapter, type TranslationId } from "@/lib/bible/translations";
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
