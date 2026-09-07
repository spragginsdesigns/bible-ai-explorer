// Load every verse of the bundled KJV into the Neon full-text table
// "KjvVerse", whose GENERATED tsvector column and GIN index back the
// findVerses tool and the keyword half of searchScripture.
//
//   node scripts/backfill-kjv-verses.mjs
//
// Idempotent: re-running upserts on (book, chapter, verse). Reads
// DATABASE_URL_UNPOOLED from .env.local, overriding any inherited value
// (see CLAUDE.md - an inherited DATABASE_URL silently wins otherwise), and
// refuses to run unless the target database is the real production neondb.
//
// The text written here is the same src/data/kjv/*.json the app quotes from
// (getVerseText), so a verse the model finds through the index is
// byte-identical to the verse it quotes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

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

// 500 rows x 4 bound parameters stays far under Postgres' 65535 per statement.
const BATCH = 500;
let done = 0;
const started = Date.now();

for (const book of books) {
	const chapters = JSON.parse(
		fs.readFileSync(path.join(root, "src/data/kjv", book.file), "utf8")
	);
	const rows = [];
	for (let c = 0; c < chapters.length; c++) {
		for (let v = 0; v < chapters[c].length; v++) {
			rows.push({ chapter: c + 1, verse: v + 1, text: chapters[c][v] });
		}
	}
	for (let i = 0; i < rows.length; i += BATCH) {
		const slice = rows.slice(i, i + BATCH);
		const values = Prisma.join(
			slice.map(
				(r) =>
					Prisma.sql`(${book.order}::int, ${r.chapter}::int, ${r.verse}::int, ${r.text}::text)`
			)
		);
		await prisma.$executeRaw`
			INSERT INTO "KjvVerse" ("book", "chapter", "verse", "text")
			VALUES ${values}
			ON CONFLICT ("book", "chapter", "verse") DO UPDATE SET "text" = EXCLUDED."text"
		`;
		done += slice.length;
	}
	console.log(`${book.name}: ${rows.length} verses (${done} total)`);
}

const [{ count }] = await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "KjvVerse"');
console.log(`Done in ${Math.round((Date.now() - started) / 1000)}s. "KjvVerse" holds ${count} rows.`);
await prisma.$disconnect();
