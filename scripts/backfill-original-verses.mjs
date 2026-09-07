// Load every verse of the bundled original-language Bible into the Neon table
// "OriginalVerse": the Westminster Leningrad Codex for books 1-39 and
// Scrivener's 1894 Textus Receptus for books 40-66. Its GIN indexes on the
// GENERATED tsvector and on the Strong's array back original-language word
// search and Strong's-number lookup.
//
//   node scripts/backfill-original-verses.mjs
//
// Idempotent: re-running upserts on (book, chapter, verse). Reads
// DATABASE_URL_UNPOOLED from .env.local, overriding any inherited value
// (see CLAUDE.md - an inherited DATABASE_URL silently wins otherwise), and
// refuses to run unless the target database is the real production neondb.
//
// Rows are keyed by the ORIGINAL versification, which is not the KJV's. The
// kjv columns carry the alignment, and are null where the original has a
// verse the KJV does not number (the 66 Psalm superscriptions). Every book is
// reconciled chapter by chapter against src/data/kjv before a single row is
// written: if any chapter has no alignment rule the run aborts rather than
// writing a partial index.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { versePlain, verseStrongs } from "./lib/original-text-normalize.mjs";
import { alignToKjv, unmappedChapters } from "./lib/original-versification.mjs";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const env = {};
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/)) {
	const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*)"?\s*$/);
	if (match) env[match[1]] = match[2].trim();
}
const { DATABASE_URL_UNPOOLED } = env;
if (!DATABASE_URL_UNPOOLED) {
	console.error("Missing DATABASE_URL_UNPOOLED in .env.local");
	process.exit(1);
}

const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL_UNPOOLED } } });

// Refuse to write anywhere but real production (identified by data, not name).
const [{ db, users }] = await prisma.$queryRawUnsafe(
	'SELECT current_database() AS db, (SELECT count(*)::int FROM "User") AS users'
);
if (db !== "neondb" || users < 30) {
	console.error(`Refusing: connected to ${db} with ${users} users - not production neondb.`);
	process.exit(1);
}
console.log(`Target: ${db} (${users} users)`);

const books = JSON.parse(fs.readFileSync(path.join(root, "src/data/books.json"), "utf8"));

// Build every row in memory first. The whole corpus is about 31k rows, and
// building it up front means the alignment check below can abort the run
// before any write rather than halfway through Malachi.
/** @type {{book: number, chapter: number, verse: number, language: string, text: string, plain: string, strongs: string[], kjvBook: number|null, kjvChapter: number|null, kjvVerse: number|null}[]} */
const rows = [];
/** @type {string[]} */
const unmappedReport = [];
/** @type {Map<string, number>} */
const nullsByBook = new Map();
const perLanguage = { Hebrew: 0, Greek: 0 };

for (const book of books) {
	const original = JSON.parse(
		fs.readFileSync(path.join(root, "src/data/originals", book.file), "utf8")
	);
	const kjv = JSON.parse(fs.readFileSync(path.join(root, "src/data/kjv", book.file), "utf8"));
	const originalCounts = original.map((chapter) => chapter.length);
	const kjvCounts = kjv.map((chapter) => chapter.length);

	const unmapped = unmappedChapters(book.order, originalCounts, kjvCounts);
	if (unmapped.length > 0) {
		unmappedReport.push(`  ${book.name} (book ${book.order}): chapters ${unmapped.join(", ")}`);
	}

	const align = alignToKjv(book.order, originalCounts, kjvCounts);
	const language = book.order <= 39 ? "Hebrew" : "Greek";
	let nulls = 0;

	for (let c = 0; c < original.length; c++) {
		for (let v = 0; v < original[c].length; v++) {
			const words = original[c][v];
			if (!words || words.length === 0) continue;
			const target = align(c + 1, v + 1);
			if (!target) nulls++;
			rows.push({
				book: book.order,
				chapter: c + 1,
				verse: v + 1,
				language,
				// The verse exactly as bundled, pointing and all, so what the
				// index holds is what src/lib/bible/originals.ts renders.
				text: words.map((word) => word[0]).join(" "),
				plain: versePlain(language, words),
				strongs: verseStrongs(words),
				kjvBook: target ? book.order : null,
				kjvChapter: target ? target.chapter : null,
				kjvVerse: target ? target.verse : null,
			});
			perLanguage[language]++;
		}
	}
	if (nulls > 0) nullsByBook.set(book.name, nulls);
}

if (unmappedReport.length > 0) {
	console.error("\nChapters with no alignment rule (would be written with a null KJV mapping):");
	console.error(unmappedReport.join("\n"));
	console.error(
		"\nRefusing to seed. Add an override to scripts/lib/original-versification.mjs first."
	);
	process.exit(1);
}
console.log("Alignment: every chapter of all 66 books is accounted for.");

// 400 rows x 10 bound parameters stays far under Postgres' 65535 per statement.
const BATCH = 400;
let done = 0;
const started = Date.now();

for (let i = 0; i < rows.length; i += BATCH) {
	const slice = rows.slice(i, i + BATCH);
	const values = Prisma.join(
		slice.map(
			(r) =>
				Prisma.sql`(${r.book}::int, ${r.chapter}::int, ${r.verse}::int, ${r.language}::text, ${r.text}::text, ${r.plain}::text, ${r.strongs}::text[], ${r.kjvBook}::int, ${r.kjvChapter}::int, ${r.kjvVerse}::int)`
		)
	);
	await prisma.$executeRaw`
		INSERT INTO "OriginalVerse" ("book", "chapter", "verse", "language", "text", "plain", "strongs", "kjvBook", "kjvChapter", "kjvVerse")
		VALUES ${values}
		ON CONFLICT ("book", "chapter", "verse") DO UPDATE SET
			"language" = EXCLUDED."language",
			"text" = EXCLUDED."text",
			"plain" = EXCLUDED."plain",
			"strongs" = EXCLUDED."strongs",
			"kjvBook" = EXCLUDED."kjvBook",
			"kjvChapter" = EXCLUDED."kjvChapter",
			"kjvVerse" = EXCLUDED."kjvVerse"
	`;
	done += slice.length;
	if (done % 4000 === 0 || done === rows.length) {
		console.log(`  ${done} / ${rows.length} rows`);
	}
}

const [{ count }] = await prisma.$queryRawUnsafe(
	'SELECT count(*)::int AS count FROM "OriginalVerse"'
);
const [{ nullCount }] = await prisma.$queryRawUnsafe(
	'SELECT count(*)::int AS "nullCount" FROM "OriginalVerse" WHERE "kjvVerse" IS NULL'
);

console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s.`);
console.log(`Rows by language: Hebrew ${perLanguage.Hebrew}, Greek ${perLanguage.Greek}`);
console.log("Rows with no KJV mapping, by book:");
if (nullsByBook.size === 0) {
	console.log("  none");
} else {
	for (const [name, n] of nullsByBook) console.log(`  ${name}: ${n}`);
	console.log(
		"  (these are the WLC's numbered Psalm superscriptions, which the KJV prints unnumbered)"
	);
}
console.log(`"OriginalVerse" holds ${count} rows, ${nullCount} of them with a null KJV mapping.`);
await prisma.$disconnect();
