// One-time backfill: embed every existing note into the Neon pgvector table
// "NoteEmbedding". New/edited notes stay in sync via src/lib/note-embeddings.ts
// (this script mirrors its chunking; keep them in step).
//
//   node scripts/backfill-note-embeddings.mjs
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

const [{ db, users }] = await prisma.$queryRawUnsafe(
	'SELECT current_database() AS db, (SELECT count(*)::int FROM "User") AS users'
);
if (db !== "neondb" || users < 30) {
	console.error(`Refusing: connected to ${db} with ${users} users - not production neondb.`);
	process.exit(1);
}

// -- chunking, mirrored from src/lib/note-embeddings.ts --
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS_PER_NOTE = 24;
function chunkNoteText(title, plainText) {
	const body = plainText.trim();
	const heading = title.trim();
	if (!body && !heading) return [];
	if (!body) return [heading];
	const chunks = [];
	let start = 0;
	while (start < body.length && chunks.length < MAX_CHUNKS_PER_NOTE) {
		let end = Math.min(start + CHUNK_SIZE, body.length);
		if (end < body.length) {
			const window = body.slice(start, end);
			const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "));
			if (breakAt > CHUNK_SIZE * 0.5) end = start + breakAt + 1;
		}
		const piece = body.slice(start, end).trim();
		if (piece) chunks.push(heading ? `${heading}\n\n${piece}` : piece);
		if (end >= body.length) break;
		start = end - CHUNK_OVERLAP;
	}
	return chunks;
}

async function embedBatch(texts) {
	const res = await fetch("https://api.openai.com/v1/embeddings", {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${OPENAI_API_KEY}` },
		body: JSON.stringify({ model: "text-embedding-3-large", input: texts }),
	});
	if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
	const json = await res.json();
	return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

const notes = await prisma.note.findMany({
	select: { id: true, userId: true, title: true, plainText: true },
});
console.log(`${notes.length} notes to index`);

let chunksTotal = 0;
for (const note of notes) {
	const chunks = chunkNoteText(note.title, note.plainText ?? "");
	await prisma.$executeRawUnsafe('DELETE FROM "NoteEmbedding" WHERE "noteId" = $1', note.id);
	if (chunks.length === 0) continue;
	const embeddings = await embedBatch(chunks);
	const values = chunks
		.map((_, i) => `($1, ${i}, $2, $${3 + i}, '[${embeddings[i].join(",")}]'::halfvec(3072))`)
		.join(",");
	await prisma.$executeRawUnsafe(
		`INSERT INTO "NoteEmbedding" ("noteId","chunk","userId","content","embedding") VALUES ${values}`,
		note.id,
		note.userId,
		...chunks.map((c) => c.slice(0, 2000))
	);
	chunksTotal += chunks.length;
	console.log(`  ${note.id} "${note.title.slice(0, 40)}": ${chunks.length} chunks`);
}
const [{ count }] = await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM "NoteEmbedding"');
console.log(`Done. ${chunksTotal} chunks written; NoteEmbedding rows: ${count}`);
await prisma.$disconnect();
