import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

function loadModule(path, names, injected) {
	const source = readFileSync(new URL(path, import.meta.url), "utf8")
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	return new Function(...Object.keys(injected), `${stripTypeScriptTypes(source, { mode: "transform" })}\nreturn { ${names.join(", ")} };`)(...Object.values(injected));
}

const operation = { id: "operation-1", userId: "alice", noteId: "source" };
const Prisma = {
	DbNull: null,
	join: (values) => values,
	sql: (strings, ...values) => ({ strings, values }),
};

// Contract coverage for the real adapters, helper and link functions. This
// deliberately supplies a fake transaction client; it does not prove Postgres
// row-lock scheduling or cancellation races against a real database.
function harness({ operationState = "running", failLinks = false } = {}) {
	let state = {
		notes: ["source", "target"].map((id) => ({
			id, userId: "alice", title: id === "target" ? "Romans Study" : "Panel",
			content: "<p>old</p>", htmlContent: "<p>old</p>", plainText: "old", wordCount: 1,
			aliases: [], properties: null, folderId: null, isPinned: false,
			updatedAt: new Date("2026-10-01T00:00:00Z"),
		})),
		folders: [], tags: [], noteTags: [],
	};
	const events = [];
	const indexed = [];
	let active = false;
	const record = (name) => {
		assert.equal(active, true, `${name} escaped the fenced transaction`);
		events.push(name);
	};
	const view = (note) => note ? {
		...note,
		folder: state.folders.find((folder) => folder.id === note.folderId) ?? null,
		tags: state.noteTags.filter((link) => link.noteId === note.id)
			.map((link) => ({ tag: state.tags.find((tag) => tag.id === link.tagId) })),
	} : null;
	const db = {
		note: {
			findFirst: async ({ where }) => {
				record(`note.read:${where.id}`);
				return view(state.notes.find((note) => note.id === where.id && note.userId === where.userId));
			},
			findMany: async ({ where }) => {
				record("note.list");
				return state.notes.filter((note) => note.userId === where.userId).map(view);
			},
			update: async ({ where, data }) => {
				record("note.update");
				const note = state.notes.find((note) => note.id === where.id && (!where.userId || note.userId === where.userId));
				assert.ok(note);
				Object.assign(note, data);
				return view(note);
			},
			create: async ({ data }) => {
				record("note.create");
				const note = { id: "created", aliases: [], updatedAt: new Date(), ...data };
				state.notes.push(note);
				return view(note);
			},
		},
		folder: {
			findFirst: async ({ where }) => {
				record("folder.read");
				return state.folders.find((folder) => folder.userId === where.userId &&
					(where.id ? folder.id === where.id : folder.name.toLowerCase() === where.name.equals.toLowerCase())) ?? null;
			},
			count: async () => { record("folder.count"); return state.folders.length; },
			create: async ({ data }) => {
				record("folder.create");
				const folder = { id: "folder", ...data };
				state.folders.push(folder);
				return folder;
			},
		},
		tag: {
			findMany: async () => { record("tag.list"); return []; },
			create: async ({ data }) => {
				record("tag.create");
				const tag = { id: `tag-${state.tags.length}`, ...data };
				state.tags.push(tag);
				return tag;
			},
		},
		noteTag: { createMany: async ({ data }) => { record("noteTag.create"); state.noteTags.push(...data); } },
		noteLink: {
			deleteMany: async () => { record("link.clear"); if (failLinks) throw new Error("link write failed"); },
			updateMany: async () => { record("link.resolve"); if (failLinks) throw new Error("link write failed"); },
		},
		$queryRaw: async (strings, ...values) => {
			if (strings.join("").includes('FROM "NoteAIOperation"')) {
				record("operation.lock");
				assert.match(strings.join(""), /FOR UPDATE/);
				assert.deepEqual(values, [operation.id, operation.userId, operation.noteId]);
				return [{ ...operation, state: operationState }];
			}
			record("link.lock");
			assert.match(strings.join(""), /pg_advisory_xact_lock/);
			return [];
		},
		$executeRaw: async (strings) => {
			record(strings.join("").includes("INSERT") ? "link.upsert" : "link.prune");
			if (failLinks) throw new Error("link write failed");
		},
	};
	const prisma = new Proxy({
		$transaction: async (write) => {
			assert.equal(active, false, "nested transaction");
			const before = structuredClone(state);
			events.push("begin");
			active = true;
			try {
				const result = await write(db);
				events.push("commit");
				return result;
			} catch (error) {
				state = before;
				events.push("rollback");
				throw error;
			} finally { active = false; }
		},
	}, { get: (target, key) => {
		if (key in target) return target[key];
		throw new Error(`Unfenced Prisma access: ${String(key)}`);
	} });
	const links = loadModule("../src/lib/note-links.ts", ["syncNoteLinks", "resolvePendingLinks", "validateProperties"], {
		Prisma, prisma, randomUUID: () => "link-id",
	});
	const { withNoteAIWrite } = loadModule("../src/lib/note-ai-operations.ts", ["withNoteAIWrite"], { Prisma, prisma });
	const api = loadModule("../src/lib/notes-io.ts", ["appendMarkdownToNote", "rewriteNote", "organizeUserNote", "patchUserNote"], {
		Prisma, prisma, withNoteAIWrite, ...links,
		countWords: (value) => value.split(/\s+/).filter(Boolean).length,
		htmlToPlainText: (value) => value.replace(/<[^>]+>/g, ""),
		markdownToNoteHtml: (value) => value.trim() ? `<p>${value}</p>` : "",
		searchNoteEmbeddings: async () => [],
		syncNoteEmbeddings: async (note) => {
			assert.equal(active, false, "embedding generation began inside transaction");
			assert.equal(events.at(-1), "commit");
			events.push("embedding");
			indexed.push(note);
		},
	});
	return { api, events, indexed, state: () => state };
}

test("append reads its target and rebuilds links through the fenced client before indexing", async () => {
	const h = harness();
	const result = await h.api.appendMarkdownToNote({ userId: "alice", noteId: "target", markdown: "[[Panel]]", operation });
	assert.equal(result.noteId, "target"); // An operation can write another owned note.
	assert.equal(h.state().notes[1].plainText, "old\n\n[[Panel]]");
	assert.deepEqual(h.events, ["begin", "operation.lock", "note.read:source", "note.read:target", "note.update", "link.lock", "note.list", "link.upsert", "link.prune", "commit", "embedding"]);
});

test("append title matching and note creation stay inside their single operation transaction", async () => {
	for (const [title, created] of [["Romans Study", false], ["New Study", true]]) {
		const h = harness();
		const result = await h.api.appendMarkdownToNote({ userId: "alice", title, markdown: "[[Panel]]", matchExistingTitle: true, operation });
		assert.equal(result.created, created);
		assert.equal(h.events.filter((event) => event === "begin").length, 1);
		assert.ok(h.events.indexOf("note.list") > h.events.indexOf("operation.lock"));
		assert.equal(h.events.includes("link.resolve"), created);
	}
});

test("rewrite applies body, title, links and pending-link resolution before committing", async () => {
	const h = harness();
	const result = await h.api.rewriteNote({ userId: "alice", noteId: "target", title: "New title", markdown: "[[Panel]]", operation });
	assert.equal(result.previousWordCount, 1);
	assert.equal(h.state().notes[1].title, "New title");
	assert.ok(h.events.indexOf("link.resolve") < h.events.indexOf("commit"));
	assert.equal(h.indexed[0].title, "New title");
});

test("organize fences folder/tag creation, assignment and internal patch in one transaction", async () => {
	const h = harness();
	const result = await h.api.organizeUserNote({ userId: "alice", noteId: "target", folderName: "Studies", tags: ["Romans"], title: "Filed", pinned: true, operation });
	assert.deepEqual({ folder: result.folder, tags: result.tags, pinned: result.pinned }, { folder: "Studies", tags: ["Romans"], pinned: true });
	for (const event of ["folder.create", "tag.create", "noteTag.create", "note.update", "link.resolve"]) {
		assert.ok(h.events.indexOf(event) > h.events.indexOf("operation.lock"));
		assert.ok(h.events.indexOf(event) < h.events.indexOf("commit"));
	}
	assert.equal(h.events.filter((event) => event === "begin").length, 1);
});

test("patch fences metadata and empty-link deletion and defers embeddings only after commit", async () => {
	const h = harness();
	let deferred = false;
	await h.api.patchUserNote("alice", "target", { title: "Patched", plainText: "body", aliases: ["Alias"], properties: { topic: "faith" } }, {
		operation,
		deferEmbeddings: (task) => { deferred = true; assert.ok(task instanceof Promise); },
	});
	assert.equal(deferred, true);
	assert.deepEqual(h.state().notes[1].properties, { topic: "faith" });
	assert.ok(h.events.indexOf("link.clear") < h.events.indexOf("commit"));
});

const mutations = [
	(api, op) => api.appendMarkdownToNote({ userId: "alice", noteId: "target", markdown: "body", operation: op }),
	(api, op) => api.rewriteNote({ userId: "alice", noteId: "target", markdown: "body", operation: op }),
	(api, op) => api.organizeUserNote({ userId: "alice", noteId: "target", tags: ["Faith"], operation: op }),
	(api, op) => api.patchUserNote("alice", "target", { title: "Changed" }, { operation: op }),
];

test("cancelled or settled operations reject every adapter before note mutations or embeddings", async () => {
	for (const operationState of ["cancelled", "settled"]) for (const mutate of mutations) {
		const h = harness({ operationState });
		await assert.rejects(mutate(h.api, operation), /no longer permits changes/);
		assert.deepEqual(h.events, ["begin", "operation.lock", "rollback"]);
		assert.equal(h.indexed.length, 0);
	}
});

test("operation/user mismatches reject before opening a transaction", async () => {
	for (const mutate of mutations) {
		const h = harness();
		await assert.rejects(mutate(h.api, { ...operation, userId: "bob" }), /does not belong to this user/);
		assert.deepEqual(h.events, []);
	}
});

test("a fenced link error escapes the adapter and prevents embedding scheduling", async () => {
	const h = harness({ failLinks: true });
	await assert.rejects(h.api.rewriteNote({ userId: "alice", noteId: "target", markdown: "[[Panel]]", operation }), /link write failed/);
	assert.equal(h.events.at(-1), "rollback");
	assert.equal(h.state().notes[1].plainText, "old");
	assert.equal(h.indexed.length, 0);
});

test("link helpers keep standalone errors best-effort but propagate supplied-client errors", async () => {
	const errors = [];
	const db = {
		$queryRaw: async () => [],
		noteLink: {
			deleteMany: async () => { throw new Error("delete failed"); },
			updateMany: async () => { throw new Error("resolve failed"); },
		},
	};
	const links = loadModule("../src/lib/note-links.ts", ["syncNoteLinks", "resolvePendingLinks"], {
		Prisma, prisma: db, randomUUID: () => "id", console: { error: (...args) => errors.push(args) },
	});
	const note = { userId: "alice", noteId: "target", plainText: "", title: "Title", aliases: [] };
	await links.syncNoteLinks(note);
	await links.resolvePendingLinks(note);
	assert.equal(errors.length, 2);
	await assert.rejects(links.syncNoteLinks(note, db), /delete failed/);
	await assert.rejects(links.resolvePendingLinks(note, db), /resolve failed/);
	assert.equal(errors.length, 2);
});
