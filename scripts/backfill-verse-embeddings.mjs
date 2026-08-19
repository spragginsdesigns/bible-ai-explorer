// Embed every verse of the bundled KJV into the Neon pgvector table
// "VerseEmbedding" (text-embedding-3-large, halfvec(3072)).
//
//   node scripts/backfill-verse-embeddings.mjs
//
// Idempotent: re-running upserts. Reads OPENAI_API_KEY and
// DATABASE_URL_UNPOOLED from .env.local, overriding any inherited values
// (see CLAUDE.md - an inherited DATABASE_URL silently wins otherwise), and
// refuses to run unless the target database is the real production neondb.
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
const { OPENAI_API_KEY, DATABASE_URL_UNPOOLED } = env;
if (!OPENAI_API_KEY || !DATABASE_URL_UNPOOLED) {
	console.error("Missing OPENAI_API_KEY / DATABASE_URL_UNPOOLED in .env.local");
	process.exit(1);
}

const { PrismaClient } = require("@prisma/client");
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

async function embedBatch(texts) {
	for (let attempt = 1; attempt <= 4; attempt++) {
		const res = await fetch("https://api.openai.com/v1/embeddings", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_API_KEY}` },
			body: JSON.stringify({ model: "text-embedding-3-large", input: texts }),
		});
		if (res.ok) {
			const json = await res.json();
			return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
		}
		if (attempt === 4) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
		await new Promise((r) => setTimeout(r, 2000 * attempt));
	}
}

const BATCH = 400;
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
		const embeddings = await embedBatch(slice.map((r) => r.text));
		const values = slice
			.map(
				(r, j) =>
					`(${book.order}, ${r.chapter}, ${r.verse}, '[${embeddings[j].join(",")}]'::halfvec(3072))`
			)
			.join(",");
		await prisma.$executeRawUnsafe(
			`INSERT INTO "VerseEmbedding" ("book","chapter","verse","embedding") VALUES ${values}
			 ON CONFLICT ("book","chapter","verse") DO UPDATE SET "embedding" = EXCLUDED."embedding"`
		);
		done += slice.length;
	}
	console.log(`${book.name}: ${rows.length} verses (total ${done}, ${Math.round((Date.now() - started) / 1000)}s)`);
}

const [{ count }] = await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "VerseEmbedding"');
console.log(`Done. VerseEmbedding rows: ${count}`);
await prisma.$disconnect();
