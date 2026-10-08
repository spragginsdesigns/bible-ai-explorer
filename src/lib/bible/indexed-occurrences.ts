import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getKjvBookName } from "@/utils/kjvBible";

/** Exact normalized names, bounded rows and a true database count. */
export async function indexedOccurrences(name: string, limit = 8) {
	const normalized = name.toLowerCase().replace(/([a-z])-(?=[a-z])/g, "$1").replace(/[^a-z0-9 ]/g, " ").trim();
	if (!normalized) return { total: 0, verses: [] };
	const query = normalized.split(/\s+/).map(word => `'${word}'`).join(" <-> ");
	const phrase = ` ${normalized} `;
	const predicate = Prisma.sql`"search" @@ to_tsquery('simple', ${query}) AND (' ' || regexp_replace(regexp_replace(lower("text"), '([a-z])-([a-z])', '\\1\\2', 'g'), '[^a-z0-9 ]', ' ', 'g') || ' ') LIKE ${`%${phrase}%`}`;
	const [counts, rows] = await Promise.all([
		prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM "KjvVerse" WHERE ${predicate}`,
		prisma.$queryRaw<{ book: number; chapter: number; verse: number; text: string }[]>`SELECT "book", "chapter", "verse", "text" FROM "KjvVerse" WHERE ${predicate} ORDER BY "book", "chapter", "verse" LIMIT ${Math.max(1, Math.min(20, limit))}`,
	]);
	return { total: Number(counts[0]?.total ?? 0), verses: rows.map(row => ({ reference: `${getKjvBookName(row.book)} ${row.chapter}:${row.verse}`, text: row.text })) };
}
