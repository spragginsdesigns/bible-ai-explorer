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
import { parseEnv } from "node:util";
import { EMBEDDING_MODEL_ID, EMBEDDING_DIMENSIONS } from "../src/lib/embedding-index.ts";
import { assertBackfillTarget } from "./lib/backfill-target.mjs";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const env = parseEnv(fs.readFileSync(path.join(root, ".env.local"), "utf8"));
const { OPENAI_API_KEY, DATABASE_URL_UNPOOLED } = env;
if ((!OPENAI_API_KEY && !process.argv.includes("--check")) || !DATABASE_URL_UNPOOLED) {
	console.error("Missing OPENAI_API_KEY / DATABASE_URL_UNPOOLED in .env.local");
	process.exit(1);
}

const { PrismaClient } = require("@prisma/client");
assertBackfillTarget(DATABASE_URL_UNPOOLED);
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
if (process.argv.includes("--check")) {
	console.log("Target checks passed; no embedding calls or writes.");
	await prisma.$disconnect();
	process.exit(0);
}

const books = JSON.parse(fs.readFileSync(path.join(root, "src/data/books.json"), "utf8"));

async function embedBatch(texts) {
	const signal = AbortSignal.timeout(20000);
	for (let attempt = 1; attempt <= 2; attempt++) {
		const res = await fetch("https://api.openai.com/v1/embeddings", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_API_KEY}` },
			body: JSON.stringify({ model: EMBEDDING_MODEL_ID, dimensions: EMBEDDING_DIMENSIONS, input: texts }),
			signal,
		});
		if (res.ok) {
			const json = await res.json();
			const vectors = json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
			if (vectors.length !== texts.length || vectors.some(vector => !Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || vector.some(value => !Number.isFinite(value)))) throw new Error("Invalid verse embeddings.");
			return vectors;
		}
		if (attempt === 2 || !(res.status === 429 || res.status >= 500)) throw new Error(`Embedding provider returned HTTP ${res.status}.`);
		await new Promise((r) => setTimeout(r, 500));
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
					`(${book.order}, ${r.chapter}, ${r.verse}, '[${embeddings[j].join(",")}]'::halfvec(3072), '${EMBEDDING_MODEL_ID}', ${EMBEDDING_DIMENSIONS})`
			)
			.join(",");
		await prisma.$executeRawUnsafe(
			`INSERT INTO "VerseEmbedding" ("book","chapter","verse","embedding","modelId","dimensions") VALUES ${values}
			 ON CONFLICT ("book","chapter","verse") DO UPDATE SET "embedding" = EXCLUDED."embedding", "modelId" = EXCLUDED."modelId", "dimensions" = EXCLUDED."dimensions"`
		);
		done += slice.length;
	}
	console.log(`${book.name}: ${rows.length} verses (total ${done}, ${Math.round((Date.now() - started) / 1000)}s)`);
}

const [{ count }] = await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "VerseEmbedding"');
console.log(`Done. VerseEmbedding rows: ${count}`);
await prisma.$disconnect();
