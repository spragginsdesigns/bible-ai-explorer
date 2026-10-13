import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { chunkNoteText, noteEmbeddingHash, writeNoteIndex, EMBEDDING_DIMENSIONS } from "../src/lib/embedding-index.ts";

const vector = () => [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)];
const source = { userId: "alice", noteId: "note", title: "Grace", plainText: "Saved by grace through faith." };
function database(note = source) {
	const state = { note: { ...note, embeddingSourceHash: null }, writes: [], failDelete: false };
	const tx = {
		$queryRaw: async (strings, ...values) => {
			assert.match(strings.join(""), /FOR UPDATE/);
			return state.note && state.note.noteId === values[0] && state.note.userId === values[1] ? [{...state.note}] : [];
		},
		$executeRaw: async (strings, ...values) => {
			const sql = Prisma.sql(strings, ...values);
			if (sql.sql.includes("SET LOCAL")) return;
			if (state.failDelete && sql.sql.includes("DELETE")) throw Error("write failed");
			state.writes.push(sql);
			if (sql.sql.includes('UPDATE "Note"')) state.note.embeddingSourceHash = sql.values[0];
		},
	};
	const client = { $transaction: async callback => {
		const before = [...state.writes]; const oldHash = state.note?.embeddingSourceHash;
		try { return await callback(tx); } catch (error) { state.writes = before; if (state.note) state.note.embeddingSourceHash = oldHash; throw error; }
	} };
	return { client, state };
}

test("newer edits defeat old embedding jobs and foreign/deleted notes cannot be indexed", async () => {
	for (const changed of [{...source,plainText:"newer edit"},{...source,userId:"bob"},null]) {
		const db = database(); db.state.note = changed && {...changed,embeddingSourceHash:null};
		assert.equal(await writeNoteIndex(db.client, source, [source.plainText], [vector()]), "stale");
		assert.equal(db.state.writes.length, 0);
	}
});

test("successful indexing stamps the source and duplicate work does not rewrite it", async () => {
	const db = database(); const chunks = chunkNoteText(source.title, source.plainText);
	assert.equal(await writeNoteIndex(db.client, source, chunks, chunks.map(vector)), "indexed");
	assert.equal(db.state.note.embeddingSourceHash, noteEmbeddingHash(source.title, source.plainText));
	assert.equal(db.state.writes.length, 3);
	assert.equal(await writeNoteIndex(db.client, source, chunks, chunks.map(vector)), "unchanged");
	assert.equal(db.state.writes.length, 3);
	assert.equal(db.state.writes[0].values.includes("text-embedding-3-large"), true);
});

test("an empty latest note deletes chunks under the same source lock", async () => {
	const empty = {...source,title:"",plainText:""}; const db = database(empty);
	assert.equal(await writeNoteIndex(db.client, empty, [], []), "indexed");
	assert.equal(db.state.writes.length, 2);
	assert.match(db.state.writes[0].sql,/DELETE/);
	assert.equal(db.state.note.embeddingSourceHash,noteEmbeddingHash("",""));
});

test("maintenance can repair a stamped index while still refusing an older source snapshot", async()=>{
	const db=database(); db.state.note.embeddingSourceHash=noteEmbeddingHash(source.title,source.plainText);
	assert.equal(await writeNoteIndex(db.client,source,[source.plainText],[vector()],{force:true}),"indexed");
	db.state.note.plainText="newer source";
	assert.equal(await writeNoteIndex(db.client,source,[source.plainText],[vector()],{force:true}),"stale");
	assert.equal(db.state.writes.length,3);
});

test("invalid or incomplete vectors and transaction failures retain the existing index", async () => {
	const db = database();
	assert.throws(()=>writeNoteIndex(db.client,source,["chunk"],[]),/Invalid note vectors/);
	assert.throws(()=>writeNoteIndex(db.client,source,["chunk"],[[NaN]]),/Invalid note vectors/);
	db.state.failDelete = true;
	await assert.rejects(writeNoteIndex(db.client, source, [source.plainText], [vector()]),/write failed/);
	assert.equal(db.state.writes.length,0);assert.equal(db.state.note.embeddingSourceHash,null);
});

test("hashes distinguish title/body boundaries and chunking preserves bounded overlapping content", () => {
	assert.notEqual(noteEmbeddingHash("a","b\nc"),noteEmbeddingHash("a\nb","c"));
	assert.equal(noteEmbeddingHash(" Grace "," faith "),noteEmbeddingHash("Grace","faith"));
	assert.deepEqual(chunkNoteText("Title",""),["Title"]);assert.deepEqual(chunkNoteText("",""),[]);
	const chunks=chunkNoteText("Title","x".repeat(50000));assert.equal(chunks.length,24);assert.ok(chunks.every(c=>c.startsWith("Title\n\n")&&c.length<=1207));
});
