import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

// notes-io.ts imports Prisma and the embedding/link sync modules, so evaluate
// its source with those dependencies stubbed instead of importing it.
function loadNotesIo(prisma) {
	const source = read("../src/lib/notes-io.ts")
		.replace(/^import[^\r\n]*(?:\r?\n|$)/gm, "")
		.replace(/^export\s+/gm, "");
	const factory = new Function(
		"prisma", "countWords", "htmlToPlainText", "markdownToNoteHtml",
		"searchNoteEmbeddings", "syncNoteEmbeddings", "resolvePendingLinks", "syncNoteLinks",
		`${stripTypeScriptTypes(source)}
return { appendMarkdownToNote, findMatchingNoteTitle, noteTitleSimilarity, normalizeNoteTitle };`
	);
	const noop = async () => {};
	return factory(
		prisma,
		(text) => text.split(/\s+/).filter(Boolean).length,
		(html) => html.replace(/<[^>]+>/g, ""),
		(markdown) => (markdown.trim() ? `<p>${markdown.trim()}</p>` : ""),
		async () => [],
		noop,
		noop,
		noop
	);
}

function makePrisma(notes) {
	const calls = { created: [], updated: [], listed: 0 };
	const prisma = {
		note: {
			findMany: async ({ where, take, select }) => {
				calls.listed += 1;
				assert.deepEqual(select, { id: true, title: true });
				return notes
					.filter((note) => note.userId === where.userId)
					.sort((a, b) => b.updatedAt - a.updatedAt)
					.slice(0, take)
					.map(({ id, title }) => ({ id, title }));
			},
			findFirst: async ({ where }) =>
				notes.find((note) => note.id === where.id && note.userId === where.userId) ?? null,
			update: async ({ where, data }) => {
				calls.updated.push({ id: where.id, data });
				return { id: where.id };
			},
			create: async ({ data }) => {
				calls.created.push(data);
				return { id: `new-${calls.created.length}`, title: data.title, aliases: [] };
			},
		},
	};
	return { prisma, calls };
}

const { findMatchingNoteTitle, noteTitleSimilarity, normalizeNoteTitle } = loadNotesIo(makePrisma([]).prisma);
const matches = (a, b) => findMatchingNoteTitle(a, [{ title: b }]) !== null;

test("an identical title matches", () => {
	assert.equal(noteTitleSimilarity("Favorite Bible Books", "Favorite Bible Books"), 1);
	assert.ok(matches("Favorite Bible Books", "Favorite Bible Books"));
});

test("case, spacing, punctuation and accents do not defeat a match", () => {
	assert.equal(normalizeNoteTitle("  Favorite   BIBLE books! "), "favorite bible books");
	assert.ok(matches("favorite bible books", "Favorite Bible Books"));
	assert.ok(matches("  Favorite   BIBLE books! ", "Favorite Bible Books"));
	assert.ok(matches("Favorite Bible Books", "Favorite Books of the Bible"));
	assert.ok(matches("My Favorite Bible Book", "Favorite Bible Books"));
	assert.ok(matches("Prière", "priere"));
	assert.ok(matches("Hallelujah - Psalm 150", "Hallelujah: Psalm 150"));
});

test("a clearly different title does not match", () => {
	assert.equal(matches("Family Prayers", "Putting Away Corrupt Speech"), false);
	assert.equal(matches("Favorite Hymns", "Favorite Bible Verses"), false);
	assert.equal(matches("Romans Study", "Romans Study Questions for Small Group"), false);
});

test("titles that differ only by a number never match, so a series stays separate", () => {
	assert.equal(matches("Romans 8", "Romans 9"), false);
	assert.equal(
		matches(
			"Following Jesus Week 1 The Call to Follow Nick Lewis FMBC",
			"Following Jesus Week 2 The Call to Follow Nick Lewis FMBC"
		),
		false
	);
	assert.ok(matches("8-16-26 Notes", "8/16/26 notes"));
});

test("rule: 'Favorite Bible Books' and 'Favorite Parts of the Bible' are NOT merged", () => {
	// They share only "favorite" and "bible" (overlap 2 of 4 words, 0.5). The
	// rule needs an identical normalized title or at least 75% word overlap,
	// because appending into the wrong note is worse than a near-duplicate.
	assert.equal(noteTitleSimilarity("Favorite Bible Books", "Favorite Parts of the Bible"), 0.5);
	assert.equal(matches("Favorite Bible Books", "Favorite Parts of the Bible"), false);
	// The production pair from 2026-08-17 (2 of 6 words) is further apart still.
	assert.equal(matches("Favorite Parts of the Bible", "Favorite Bible Books: The Gospels and James"), false);
});

test("the best match wins, and an exact title beats a close one", () => {
	const candidates = [
		{ id: "close", title: "Favorite Books of the Bible Study" },
		{ id: "exact", title: "favorite bible books" },
	];
	assert.equal(findMatchingNoteTitle("Favorite Bible Books", candidates)?.id, "exact");
	assert.equal(findMatchingNoteTitle("", candidates), null);
	assert.equal(findMatchingNoteTitle("Favorite Bible Books", []), null);
});

const NOTES = [
	{ id: "n1", userId: "alice", title: "Favorite Bible Books", htmlContent: "<p>old</p>", plainText: "old", aliases: [], updatedAt: 2 },
	{ id: "n2", userId: "alice", title: "Family Prayers", htmlContent: "", plainText: "", aliases: [], updatedAt: 1 },
	{ id: "n3", userId: "bob", title: "Sermon Log", htmlContent: "", plainText: "", aliases: [], updatedAt: 3 },
];

test("a titled new-note save appends to the matching existing note when opted in", async () => {
	const { prisma, calls } = makePrisma(NOTES);
	const { appendMarkdownToNote } = loadNotesIo(prisma);
	const result = await appendMarkdownToNote({
		userId: "alice",
		markdown: "Gospels and James",
		title: "  favorite BIBLE books ",
		matchExistingTitle: true,
	});
	assert.equal(result.noteId, "n1");
	assert.equal(result.noteTitle, "Favorite Bible Books");
	assert.equal(result.created, false);
	assert.equal(result.matchedExisting, true);
	assert.equal(calls.created.length, 0);
	assert.equal(calls.updated.length, 1);
	assert.match(calls.updated[0].data.htmlContent, /^<p>old<\/p>\n<p>Gospels and James<\/p>$/);
});

test("no match, another user's note, or no opt-in still creates a new note", async () => {
	for (const options of [
		{ userId: "alice", title: "Putting Away Corrupt Speech", matchExistingTitle: true },
		{ userId: "alice", title: "Sermon Log", matchExistingTitle: true },
		{ userId: "alice", title: "Favorite Bible Books" },
	]) {
		const { prisma, calls } = makePrisma(NOTES);
		const { appendMarkdownToNote } = loadNotesIo(prisma);
		const result = await appendMarkdownToNote({ markdown: "content", ...options });
		assert.equal(result.created, true, options.title);
		assert.equal(result.matchedExisting, false, options.title);
		assert.equal(calls.created.length, 1, options.title);
		assert.equal(calls.created[0].title, options.title);
	}
});

test("an explicit noteId or an untitled save never runs the title match", async () => {
	const { prisma, calls } = makePrisma(NOTES);
	const { appendMarkdownToNote } = loadNotesIo(prisma);
	const explicit = await appendMarkdownToNote({
		userId: "alice", markdown: "x", noteId: "n2", title: "Favorite Bible Books", matchExistingTitle: true,
	});
	assert.equal(explicit.noteId, "n2");
	assert.equal(explicit.matchedExisting, false);
	const untitled = await appendMarkdownToNote({ userId: "alice", markdown: "x", matchExistingTitle: true });
	assert.equal(untitled.created, true);
	assert.equal(calls.listed, 0);
});

test("the addToNote tool opts into the title match and keeps its input schema", () => {
	const source = read("../src/lib/ai-tools.ts");
	const start = source.indexOf("const addToNoteTool = tool(");
	const end = source.indexOf("const readNoteTool = tool(");
	assert.ok(start > 0 && end > start);
	const block = source.slice(start, end);
	assert.match(block, /matchExistingTitle: true/);
	assert.match(block, /markdown: z\.string\(\)/);
	assert.match(block, /noteId: z\s*\.string\(\)\s*\.optional\(\)/);
	assert.match(block, /title: z\s*\.string\(\)\s*\.optional\(\)/);
});

test("placeholder titles never match, so a save cannot land in an empty untitled note", () => {
	assert.equal(noteTitleSimilarity("Untitled Note", "Untitled Note"), 0);
	assert.equal(matches("Untitled Note", "untitled note"), false);
	assert.equal(matches("Note from SureWord", "Note from SureWord"), false);
	assert.equal(matches("Romans 8 Study", "Untitled Note"), false);
});
