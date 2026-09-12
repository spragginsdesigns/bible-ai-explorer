import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`
	);
	return factory(...names.map((name) => injected[name]));
}

// The real validator, so readNote shows exactly the properties the editor accepts.
const { validateProperties } = loadModule("../src/lib/note-links.ts", ["validateProperties"], {
	randomUUID: () => "uuid",
	Prisma: {},
	prisma: {},
});

const DB_NULL = Symbol("DbNull");

const insensitiveEquals = (value, filter) =>
	filter.mode === "insensitive" ? value.toLowerCase() === filter.equals.toLowerCase() : value === filter.equals;

function makeDb({ notes = [], folders = [], tags = [], noteTags = [] } = {}) {
	const state = {
		notes: notes.map((note) => ({
			isPinned: false,
			folderId: null,
			aliases: [],
			properties: null,
			htmlContent: "",
			plainText: "",
			wordCount: 0,
			updatedAt: new Date("2026-09-01T00:00:00Z"),
			...note,
		})),
		folders: folders.map((folder, index) => ({ sortOrder: index, ...folder })),
		tags: tags.map((tag, index) => ({ createdAt: index, color: "#000000", ...tag })),
		noteTags: [...noteTags],
		calls: [],
		links: [],
		embeddings: [],
	};
	const tagsFor = (noteId) =>
		state.noteTags
			.filter((link) => link.noteId === noteId)
			.map((link) => ({ tag: state.tags.find((tag) => tag.id === link.tagId) }));
	const folderFor = (note) => {
		const folder = state.folders.find((entry) => entry.id === note.folderId);
		return folder ? { name: folder.name } : null;
	};
	const prisma = {
		note: {
			findFirst: async ({ where }) => {
				state.calls.push(["note.findFirst", where]);
				const note = state.notes.find((entry) => entry.id === where.id && entry.userId === where.userId);
				return note ? { ...note, tags: tagsFor(note.id), folder: folderFor(note) } : null;
			},
			update: async ({ where, data }) => {
				state.calls.push(["note.update", where, data]);
				const note = state.notes.find((entry) => entry.id === where.id && entry.userId === where.userId);
				if (!note) {
					const error = new Error("Record not found");
					error.code = "P2025";
					throw error;
				}
				Object.assign(note, data);
				return { ...note, tags: tagsFor(note.id) };
			},
		},
		folder: {
			findFirst: async ({ where }) => {
				state.calls.push(["folder.findFirst", where]);
				return (
					state.folders
						.filter((folder) => folder.userId === where.userId && insensitiveEquals(folder.name, where.name))
						.sort((a, b) => a.sortOrder - b.sortOrder)[0] ?? null
				);
			},
			count: async ({ where }) => state.folders.filter((folder) => folder.userId === where.userId).length,
			create: async ({ data }) => {
				state.calls.push(["folder.create", data]);
				const folder = { id: `folder-${state.folders.length + 1}`, ...data };
				state.folders.push(folder);
				return folder;
			},
		},
		tag: {
			findMany: async ({ where }) => {
				state.calls.push(["tag.findMany", where]);
				return state.tags
					.filter((tag) => tag.userId === where.userId)
					.filter((tag) => where.OR.some((clause) => insensitiveEquals(tag.name, clause.name)))
					.sort((a, b) => a.createdAt - b.createdAt);
			},
			create: async ({ data }) => {
				state.calls.push(["tag.create", data]);
				const tag = { id: `tag-${state.tags.length + 1}`, createdAt: state.tags.length, ...data };
				state.tags.push(tag);
				return tag;
			},
		},
		noteTag: {
			createMany: async ({ data, skipDuplicates }) => {
				state.calls.push(["noteTag.createMany", data, skipDuplicates]);
				for (const row of data) {
					const exists = state.noteTags.some((link) => link.noteId === row.noteId && link.tagId === row.tagId);
					if (!exists) state.noteTags.push(row);
				}
				return { count: data.length };
			},
		},
	};
	return { prisma, state };
}

function loadNotesIo(prisma, state) {
	return loadModule(
		"../src/lib/notes-io.ts",
		["organizeUserNote", "patchUserNote", "readUserNote", "DEFAULT_TAG_COLOR"],
		{
			Prisma: { DbNull: DB_NULL },
			prisma,
			countWords: (text) => text.split(/\s+/).filter(Boolean).length,
			htmlToPlainText: (html) => html.replace(/<[^>]+>/g, ""),
			markdownToNoteHtml: (markdown) => (markdown.trim() ? `<p>${markdown.trim()}</p>` : ""),
			searchNoteEmbeddings: async () => [],
			syncNoteEmbeddings: async (note) => {
				state.embeddings.push(note);
			},
			syncNoteLinks: async (note) => {
				state.links.push(["sync", note]);
			},
			resolvePendingLinks: async (note) => {
				state.links.push(["resolve", note]);
			},
			validateProperties,
		}
	);
}

const romansNote = { id: "note-1", userId: "alice", title: "Romans 8 study" };

test("folderName matches an existing folder case-insensitively and creates nothing", async () => {
	const { prisma, state } = makeDb({
		notes: [romansNote],
		folders: [
			{ id: "folder-a", userId: "bob", name: "Romans" },
			{ id: "folder-b", userId: "alice", name: "Romans" },
		],
	});
	const { organizeUserNote } = loadNotesIo(prisma, state);
	const result = await organizeUserNote({ userId: "alice", noteId: "note-1", folderName: "  romans " });
	assert.equal(result.folder, "Romans");
	assert.equal(result.createdFolder, false);
	assert.equal(state.notes[0].folderId, "folder-b");
	assert.equal(state.calls.filter(([name]) => name === "folder.create").length, 0);
});

test("a folder that does not exist is created last in the user's folder order", async () => {
	const { prisma, state } = makeDb({
		notes: [romansNote],
		folders: [
			{ id: "folder-x", userId: "alice", name: "Church Notes" },
			{ id: "folder-y", userId: "bob", name: "Other" },
		],
	});
	const { organizeUserNote } = loadNotesIo(prisma, state);
	const result = await organizeUserNote({ userId: "alice", noteId: "note-1", folderName: "Romans" });
	assert.equal(result.createdFolder, true);
	assert.equal(result.folder, "Romans");
	const created = state.calls.find(([name]) => name === "folder.create")[1];
	assert.deepEqual(created, { userId: "alice", name: "Romans", sortOrder: 1 });
});

test("tags reuse existing names, create missing ones grey, and never drop tags already on the note", async () => {
	const { prisma, state } = makeDb({
		notes: [romansNote],
		tags: [
			{ id: "tag-fav", userId: "alice", name: "Favorite" },
			{ id: "tag-grace", userId: "alice", name: "Grace" },
			{ id: "tag-bob", userId: "bob", name: "Hope" },
		],
		noteTags: [{ noteId: "note-1", tagId: "tag-fav" }],
	});
	const { organizeUserNote, DEFAULT_TAG_COLOR } = loadNotesIo(prisma, state);
	const result = await organizeUserNote({
		userId: "alice",
		noteId: "note-1",
		tags: ["grace", "#hope", "GRACE", " "],
	});
	assert.deepEqual(result.createdTags, ["hope"]);
	assert.deepEqual([...result.tags].sort(), ["Favorite", "Grace", "hope"]);
	const createdTag = state.calls.find(([name]) => name === "tag.create")[1];
	assert.deepEqual(createdTag, { userId: "alice", name: "hope", color: DEFAULT_TAG_COLOR });
	assert.equal(DEFAULT_TAG_COLOR, "#6b7280");
	const [, rows, skipDuplicates] = state.calls.find(([name]) => name === "noteTag.createMany");
	assert.equal(skipDuplicates, true);
	assert.deepEqual(rows.map((row) => row.tagId), ["tag-grace", "tag-4"]);
	// Tags alone change no note column, so the note is not rewritten.
	assert.equal(state.calls.filter(([name]) => name === "note.update").length, 0);
});

test("rename and pin go through the shared patch and keep links and the index in step", async () => {
	const { prisma, state } = makeDb({ notes: [{ ...romansNote, plainText: "body" }] });
	const { organizeUserNote } = loadNotesIo(prisma, state);
	const result = await organizeUserNote({
		userId: "alice",
		noteId: "note-1",
		title: "More Than Conquerors in Romans 8",
		pinned: true,
	});
	assert.deepEqual(result, {
		success: true,
		noteId: "note-1",
		title: "More Than Conquerors in Romans 8",
		folder: null,
		tags: [],
		pinned: true,
		createdFolder: false,
		createdTags: [],
	});
	const [, where, data] = state.calls.find(([name]) => name === "note.update");
	assert.deepEqual(where, { id: "note-1", userId: "alice" });
	assert.deepEqual(data, { title: "More Than Conquerors in Romans 8", isPinned: true });
	assert.deepEqual(state.links.map(([kind]) => kind), ["resolve"]);
	assert.equal(state.embeddings.length, 1);
});

test("someone else's note, or a call that changes nothing, fails without writing", async () => {
	const { prisma, state } = makeDb({ notes: [romansNote], folders: [] });
	const { organizeUserNote } = loadNotesIo(prisma, state);
	await assert.rejects(
		organizeUserNote({ userId: "mallory", noteId: "note-1", folderName: "Stolen" }),
		/Note not found/
	);
	await assert.rejects(
		organizeUserNote({ userId: "alice", noteId: "note-1", title: " ", folderName: "", tags: [] }),
		/Nothing to change/
	);
	assert.equal(state.calls.some(([name]) => /create|update/.test(name)), false);
});

test("patchUserNote only sends the fields given, and defers embeddings when asked", async () => {
	const { prisma, state } = makeDb({ notes: [romansNote] });
	const { patchUserNote } = loadNotesIo(prisma, state);
	const deferred = [];
	await patchUserNote(
		"alice",
		"note-1",
		{ title: undefined, plainText: "new body", properties: null, isPinned: undefined },
		{ deferEmbeddings: (task) => deferred.push(task) }
	);
	const [, , data] = state.calls.find(([name]) => name === "note.update");
	assert.deepEqual(data, { plainText: "new body", properties: DB_NULL });
	assert.deepEqual(state.links.map(([kind]) => kind), ["sync"]);
	assert.equal(deferred.length, 1);
	await assert.rejects(patchUserNote("mallory", "note-1", { title: "x" }), (error) => error.code === "P2025");
});

test("readNote shows how the note is organized", async () => {
	const { prisma, state } = makeDb({
		notes: [
			{
				...romansNote,
				htmlContent: "<p>Study</p>",
				wordCount: 1,
				folderId: "folder-1",
				isPinned: true,
				aliases: ["Romans Eight"],
				properties: { preacher: "Nick Lewis", week: 1 },
			},
			{ id: "note-2", userId: "alice", title: "Broken", properties: { nested: { deep: true } } },
		],
		folders: [{ id: "folder-1", userId: "alice", name: "Church Notes" }],
		tags: [{ id: "tag-1", userId: "alice", name: "Favorite" }],
		noteTags: [{ noteId: "note-1", tagId: "tag-1" }],
	});
	const { readUserNote } = loadNotesIo(prisma, state);
	const note = await readUserNote("alice", "note-1");
	assert.deepEqual(note, {
		noteId: "note-1",
		title: "Romans 8 study",
		htmlContent: "<p>Study</p>",
		truncated: false,
		wordCount: 1,
		tags: ["Favorite"],
		folder: "Church Notes",
		pinned: true,
		aliases: ["Romans Eight"],
		properties: { preacher: "Nick Lewis", week: 1 },
		updatedAt: "2026-09-01T00:00:00.000Z",
	});
	const broken = await readUserNote("alice", "note-2");
	assert.equal(broken.folder, null);
	assert.equal(broken.properties, null);
	await assert.rejects(readUserNote("mallory", "note-1"), /Note not found/);
});

test("the PATCH route delegates to patchUserNote with waitUntil for embeddings", () => {
	const route = read("../src/app/api/notes/[id]/route.ts");
	assert.match(route, /patchUserNote\(/);
	assert.match(route, /deferEmbeddings: waitUntil/);
	assert.doesNotMatch(route, /prisma\.note\.update/);
});

test("the pin action is explicit: nothing about pinning leaves the pin alone", () => {
	const source = readFileSync(new URL("../src/lib/ai-tools.ts", import.meta.url), "utf8");
	const start = source.indexOf("const organizeNoteTool");
	const schema = source.slice(start, source.indexOf("return {", start));
	// A model fills every field of a schema, so a boolean arrived as false on
	// requests that never mentioned pinning and silently unpinned the note.
	assert.equal(schema.includes("pinned: z.boolean"), false);
	assert.ok(schema.includes('.enum(["pin", "unpin"])'));
	assert.ok(schema.includes('pin === "pin" ? true : pin === "unpin" ? false : undefined'));
});
