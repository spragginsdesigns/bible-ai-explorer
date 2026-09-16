import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { tool } from "ai";
import { z } from "zod";

import { usedMemoryTools } from "../src/lib/memory-policy.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const MEMORY_CATEGORIES = ["profile", "prayer", "study", "preference", "general"];
const MAX_MEMORIES_PER_USER = 60;
const MAX_MEMORY_CONTENT_LENGTH = 500;

/** Imports may span lines, so the whole statement goes, not the first line. */
const stripImports = (source) =>
	source.replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export\s+/gm, "");

/**
 * The prayer helpers come from the shipped memory.ts rather than a copy here,
 * so "now + 3 days" cannot drift between the module and its tests. Nothing in
 * this module's top level touches Prisma or the model, so `z` is enough to
 * instantiate it.
 */
const memoryModule = new Function(
	"z", "console",
	`${stripTypeScriptTypes(stripImports(read("../src/lib/memory.ts")))}\nreturn { MEMORY_RECORD_SELECT, NOT_A_PRAYER, PRAYER_FOLLOW_UP_DAYS, asPrayerStatus, formatMemoryBlock, prayerDefaults, prayerStatusUpdate, toUserMemoryRecord };`
)(z, { error() {} });

const { PRAYER_FOLLOW_UP_DAYS, formatMemoryBlock, prayerDefaults } = memoryModule;
const DAY_MS = 24 * 60 * 60 * 1000;

function loadBuilder(prisma) {
	const factory = new Function(
		"tool", "z", "prisma", "MAX_MEMORIES_PER_USER", "MAX_MEMORY_CONTENT_LENGTH", "MEMORY_CATEGORIES",
		"MEMORY_RECORD_SELECT", "NOT_A_PRAYER", "prayerDefaults", "prayerStatusUpdate", "toUserMemoryRecord", "console",
		`${stripTypeScriptTypes(stripImports(read("../src/lib/memory-tools.ts")))}\nreturn buildMemoryTools;`
	);
	const builder = factory(
		tool, z, prisma, MAX_MEMORIES_PER_USER, MAX_MEMORY_CONTENT_LENGTH, MEMORY_CATEGORIES,
		memoryModule.MEMORY_RECORD_SELECT, memoryModule.NOT_A_PRAYER, memoryModule.prayerDefaults,
		memoryModule.prayerStatusUpdate, memoryModule.toUserMemoryRecord, { error() {} }
	);
	return builder("alice");
}

function makePrisma({ enabled = true, users = ["alice", "bob"], memories = [], fail = null } = {}) {
	const state = {
		users: new Map(users.map((id) => [id, { memoryEnabled: id === "alice" ? enabled : true }])),
		memories: memories.map((memory, index) => ({
			id: memory.id ?? `memory-${index + 1}`,
			userId: memory.userId ?? "alice",
			content: memory.content ?? `memory ${index + 1}`,
			category: memory.category ?? "general",
			status: memory.status ?? null,
			askedAt: memory.askedAt ?? null,
			followUpAfter: memory.followUpAfter ?? null,
			updatedAt: memory.updatedAt ?? index,
		})),
		calls: [],
		fail,
	};
	const maybeFail = (operation) => {
		if (state.fail === operation || state.fail === "all") throw new Error(`${operation} failed`);
	};
	const select = (memory) => ({
		id: memory.id,
		content: memory.content,
		category: memory.category,
		status: memory.status,
		askedAt: memory.askedAt,
		followUpAfter: memory.followUpAfter,
	});
	const matches = (memory, where) => {
		if (where.userId !== undefined && memory.userId !== where.userId) return false;
		if (where.id?.in && !where.id.in.includes(memory.id)) return false;
		if (where.id && typeof where.id === "string" && memory.id !== where.id) return false;
		if (where.category !== undefined && memory.category !== where.category) return false;
		if (where.status !== undefined && memory.status !== where.status) return false;
		if (where.content?.equals !== undefined) {
			const left = where.content.mode === "insensitive" ? memory.content.toLowerCase() : memory.content;
			const right = where.content.mode === "insensitive" ? where.content.equals.toLowerCase() : where.content.equals;
			if (left !== right) return false;
		}
		return true;
	};
	const tx = {
		$queryRaw: async () => { maybeFail("query"); },
		user: {
			findUnique: async ({ where }) => {
				maybeFail("user");
				const user = state.users.get(where.id);
				return user ? { memoryEnabled: user.memoryEnabled } : null;
			},
		},
		userMemory: {
			findMany: async ({ where, orderBy, take }) => {
				maybeFail("findMany");
				return state.memories.filter((memory) => matches(memory, where))
					.sort((a, b) => (orderBy?.updatedAt === "desc" ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt))
					.slice(0, take ?? state.memories.length).map(select);
			},
			findFirst: async ({ where }) => {
				maybeFail("findFirst");
				const memory = state.memories.find((candidate) => matches(candidate, where));
				return memory ? select(memory) : null;
			},
			count: async ({ where }) => {
				maybeFail("count");
				return state.memories.filter((memory) => matches(memory, where)).length;
			},
			create: async ({ data }) => {
				maybeFail("create");
				const memory = { status: null, askedAt: null, followUpAfter: null, ...data, id: `memory-${state.memories.length + 1}`, updatedAt: Date.now() };
				state.memories.push(memory);
				state.calls.push({ operation: "create", data });
				return select(memory);
			},
			updateMany: async ({ where, data }) => {
				maybeFail("updateMany");
				const matching = state.memories.filter((memory) => matches(memory, where));
				for (const memory of matching) Object.assign(memory, data, { updatedAt: Date.now() });
				if (matching.length) state.calls.push({ operation: "updateMany", where, data });
				return { count: matching.length };
			},
			deleteMany: async ({ where }) => {
				maybeFail("deleteMany");
				const before = state.memories.length;
				state.memories = state.memories.filter((memory) => !matches(memory, where));
				const count = before - state.memories.length;
				if (count) state.calls.push({ operation: "deleteMany", where });
				return { count };
			},
		},
	};
	return {
		state,
		user: tx.user,
		userMemory: tx.userMemory,
		$transaction: async (callback) => callback(tx),
	};
}

function loadExtractor(prisma, output, onGenerate) {
	const factory = new Function(
		"generateText", "Output", "z", "resolveModel", "prisma", "allowsMemoryUse", "console",
		`${stripTypeScriptTypes(stripImports(read("../src/lib/memory.ts")))}\nreturn extractAndStoreMemories;`
	);
	return factory(
		async () => {
			if (onGenerate) await onGenerate();
			return { output };
		},
		{ object: ({ schema }) => ({ schema }) },
		z,
		async () => ({ model: "fake-model", providerOptions: {} }),
		prisma,
		(value) => value === true
		,
		{ error() {} }
	);
}

const execute = (tools, name, input) => {
	if (!tools[name]) throw new Error(`missing ${name}; got ${Object.keys(tools).join(",")}`);
	return tools[name].execute(input);
};

test("own-user list, save, update, and delete work through real AI tools", async () => {
	const prisma = makePrisma({ memories: [{ id: "a1", userId: "alice", content: "Old note", category: "general" }, { id: "b1", userId: "bob", content: "Private Bob note", category: "prayer" }] });
	const tools = loadBuilder(prisma);
	assert.deepEqual(await execute(tools, "listMemories", {}), {
		success: true,
		memories: [{ id: "a1", content: "Old note", category: "general", status: null, askedAt: null, followUpAfter: null }],
	});
	const saved = await execute(tools, "saveMemory", { content: "  Likes tea  ", category: "preference" });
	assert.equal(saved.success, true);
	assert.equal(saved.created, true);
	const updated = await execute(tools, "updateMemory", { id: "a1", content: "Likes coffee", category: "preference" });
	assert.deepEqual(updated.memory, { id: "a1", content: "Likes coffee", category: "preference", status: null, askedAt: null, followUpAfter: null });
	assert.deepEqual(await execute(tools, "deleteMemories", { ids: ["a1"] }), { success: true, deleted: 1 });
	assert.equal(prisma.state.memories.some((memory) => memory.id === "a1"), false);
});

test("cross-user IDs are rejected without leaks or mutations, including mixed deletion", async () => {
	const prisma = makePrisma({ memories: [{ id: "a1", userId: "alice", content: "Alice", category: "general" }, { id: "b1", userId: "bob", content: "Bob secret", category: "prayer" }] });
	const tools = loadBuilder(prisma);
	assert.deepEqual(await execute(tools, "updateMemory", { id: "b1", content: "stolen", category: "general" }), { success: false, error: "Memory not found. Read your memories again before editing." });
	assert.deepEqual(await execute(tools, "deleteMemories", { ids: ["a1", "b1"] }), { success: false, error: "Memory not found. Read your memories again before deleting; nothing was deleted." });
	assert.deepEqual(prisma.state.memories.map(({ id, content }) => ({ id, content })), [{ id: "a1", content: "Alice" }, { id: "b1", content: "Bob secret" }]);
});

test("disabled, missing, and unreadable preference fail closed", async () => {
	for (const setup of [{ enabled: false }, { users: ["bob"] }, { fail: "user" }, { fail: "query" }]) {
		const prisma = makePrisma({ memories: [{ id: "a1", content: "secret" }], ...setup });
		const tools = loadBuilder(prisma);
		const result = await execute(tools, "saveMemory", { content: "new", category: "general" });
		assert.equal(result.success, false);
		assert.equal(prisma.state.memories.length, 1);
	}
});

test("duplicate save is idempotent even at capacity", async () => {
	const memories = Array.from({ length: MAX_MEMORIES_PER_USER }, (_, index) => ({ id: `a${index}`, content: `note ${index}`, userId: "alice" }));
	const prisma = makePrisma({ memories });
	const tools = loadBuilder(prisma);
	const duplicate = await execute(tools, "saveMemory", { content: "note 0", category: "general" });
	assert.equal(duplicate.success, true);
	assert.equal(duplicate.created, false);
	assert.equal(prisma.state.memories.length, MAX_MEMORIES_PER_USER);
	const full = await execute(tools, "saveMemory", { content: "another", category: "general" });
	assert.deepEqual(full, { success: false, error: "Memory is full. Update a related memory or ask which memories the user wants removed." });
});

test("invalid schemas reject malformed tool input", async () => {
	const tools = loadBuilder(makePrisma());
	const cases = [
		["saveMemory", { content: "", category: "general" }],
		["saveMemory", { content: "ok", category: "invalid" }],
		["updateMemory", { id: "", content: "ok", category: "general" }],
		["deleteMemories", { ids: [] }],
		["deleteMemories", { ids: Array.from({ length: MAX_MEMORIES_PER_USER + 1 }, () => "a") }],
		["resolvePrayerRequest", { id: "", outcome: "answered" }],
		["resolvePrayerRequest", { id: "a1", outcome: "open" }],
		["resolvePrayerRequest", { id: "a1", outcome: "forgotten" }],
	];
	for (const [name, input] of cases) assert.equal(tools[name].inputSchema.safeParse(input).success, false, name);
});

test("read and mutation errors return failure results, never false success", async () => {
	for (const [name, input, fail] of [["listMemories", {}, "findMany"], ["saveMemory", { content: "x", category: "general" }, "create"], ["updateMemory", { id: "a1", content: "x", category: "general" }, "updateMany"], ["deleteMemories", { ids: ["a1"] }, "deleteMany"]]) {
		const prisma = makePrisma({ memories: [{ id: "a1", content: "old" }] });
		prisma.state.fail = fail;
		const result = await execute(loadBuilder(prisma), name, input);
		assert.equal(result.success, false, name);
	}
});

/* ------------------------------------------- prayer requests that come back */

/** Whole days from now; `|| 0` because strict equality rejects -0. */
const daysFromNow = (value) => Math.round((value.getTime() - Date.now()) / DAY_MS) || 0;

test("every path that creates a prayer memory starts it open and due in three days", async () => {
	const prisma = makePrisma();
	const tools = loadBuilder(prisma);
	const saved = await execute(tools, "saveMemory", { content: "Asked for prayer for their dad's surgery", category: "prayer" });
	assert.equal(saved.memory.status, "open");
	const [row] = prisma.state.memories;
	assert.equal(daysFromNow(row.askedAt), 0);
	assert.equal(daysFromNow(row.followUpAfter), PRAYER_FOLLOW_UP_DAYS);
	assert.equal(saved.memory.askedAt, row.askedAt.toISOString(), "clients get ISO strings, not Dates");

	const plain = await execute(tools, "saveMemory", { content: "Prefers the KJV", category: "preference" });
	assert.deepEqual(
		[plain.memory.status, plain.memory.askedAt, plain.memory.followUpAfter],
		[null, null, null],
		"only prayer rows carry the three columns",
	);
});

test("a memory becoming a prayer request starts being carried, and leaving stops it", async () => {
	const prisma = makePrisma({ memories: [{ id: "a1", content: "Their dad is ill", category: "general" }] });
	const tools = loadBuilder(prisma);
	const carried = await execute(tools, "updateMemory", { id: "a1", content: "Asked for prayer for their dad", category: "prayer" });
	assert.equal(carried.memory.status, "open");
	assert.equal(daysFromNow(prisma.state.memories[0].followUpAfter), PRAYER_FOLLOW_UP_DAYS);

	const rewritten = await execute(tools, "updateMemory", { id: "a1", content: "Asked for prayer for their dad again", category: "prayer" });
	assert.equal(rewritten.memory.askedAt, carried.memory.askedAt, "editing the wording does not restart the request");

	const laidDown = await execute(tools, "updateMemory", { id: "a1", content: "Their dad recovered", category: "general" });
	assert.deepEqual([laidDown.memory.status, laidDown.memory.askedAt, laidDown.memory.followUpAfter], [null, null, null]);
});

test("resolvePrayerRequest answers or closes one open request and stops its follow-up", async () => {
	for (const outcome of ["answered", "closed"]) {
		const prisma = makePrisma({ memories: [{ id: "a1", content: "Their dad's surgery", category: "prayer", ...prayerDefaults(new Date()) }] });
		const tools = loadBuilder(prisma);
		const result = await execute(tools, "resolvePrayerRequest", { id: "a1", outcome });
		assert.equal(result.success, true, outcome);
		assert.equal(result.outcome, outcome);
		assert.deepEqual(result.memory, {
			id: "a1",
			content: "Their dad's surgery",
			category: "prayer",
			status: outcome,
			askedAt: prisma.state.memories[0].askedAt.toISOString(),
			followUpAfter: null,
		});
		assert.equal(prisma.state.memories[0].followUpAfter, null, "a resolved request never comes back");
	}
});

test("resolvePrayerRequest refuses anything that is not this user's open prayer request", async () => {
	const error = "That is not one of the user's open prayer requests. Read your memories again.";
	const now = new Date();
	const rows = [
		{ id: "a1", content: "Not a prayer", category: "study" },
		{ id: "a2", content: "Already answered", category: "prayer", status: "answered", askedAt: now },
		{ id: "b1", userId: "bob", content: "Bob's request", category: "prayer", ...prayerDefaults(now) },
	];
	for (const id of ["a1", "a2", "b1", "missing"]) {
		const prisma = makePrisma({ memories: rows });
		const result = await execute(loadBuilder(prisma), "resolvePrayerRequest", { id, outcome: "answered" });
		assert.deepEqual(result, { success: false, error }, id);
		assert.deepEqual(prisma.state.memories.map((memory) => memory.status), [null, "answered", "open"]);
	}
});

test("a second resolvePrayerRequest on the same request changes nothing", async () => {
	const prisma = makePrisma({ memories: [{ id: "a1", content: "Their dad's surgery", category: "prayer", ...prayerDefaults(new Date()) }] });
	const tools = loadBuilder(prisma);
	assert.equal((await execute(tools, "resolvePrayerRequest", { id: "a1", outcome: "answered" })).success, true);
	const again = await execute(tools, "resolvePrayerRequest", { id: "a1", outcome: "closed" });
	assert.equal(again.success, false);
	assert.equal(prisma.state.memories[0].status, "answered");
});

test("a prayer tool failure never reports success", async () => {
	for (const fail of ["updateMany", "findFirst"]) {
		const prisma = makePrisma({ memories: [{ id: "a1", content: "Their dad's surgery", category: "prayer", ...prayerDefaults(new Date()) }] });
		prisma.state.fail = fail;
		const result = await execute(loadBuilder(prisma), "resolvePrayerRequest", { id: "a1", outcome: "answered" });
		assert.equal(result.success, false, fail);
	}
});

test("the memory block says where each prayer request stands, and says nothing extra about the rest", () => {
	const block = formatMemoryBlock([
		{ id: "a1", content: "Asked for prayer for their dad", category: "prayer", status: "open", askedAt: "2026-09-01T00:00:00.000Z", followUpAfter: "2026-09-04T00:00:00.000Z" },
		{ id: "a2", content: "Asked for prayer about a job", category: "prayer", status: "answered", askedAt: "2026-08-01T00:00:00.000Z", followUpAfter: null },
		{ id: "a3", content: "Asked for prayer about a move", category: "prayer", status: "closed", askedAt: "2026-08-01T00:00:00.000Z", followUpAfter: null },
		{ id: "a4", content: "An older prayer row with no status", category: "prayer", status: null, askedAt: null, followUpAfter: null },
		{ id: "a5", content: "Prefers the KJV", category: "preference", status: null, askedAt: null, followUpAfter: null },
	]);
	assert.match(block, /- Asked for prayer for their dad \(a prayer request they asked you to carry\)$/m);
	assert.match(block, /- Asked for prayer about a job \(an answered prayer\)$/m);
	assert.match(block, /- Asked for prayer about a move \(a prayer request they have laid down\)$/m);
	assert.match(block, /- An older prayer row with no status$/m);
	assert.match(block, /- Prefers the KJV$/m);
});

test("the extractor opens a prayer it adds and resolves one the user reported in passing", async () => {
	const prisma = makePrisma({ memories: [{ id: "a1", content: "Asked for prayer for their dad's surgery", category: "prayer", ...prayerDefaults(new Date()) }] });
	const extract = loadExtractor(prisma, {
		remove: [],
		update: [{ id: "a1", content: "Asked for prayer for their dad's surgery", status: "answered" }],
		add: [{ content: "Asked for prayer about a job interview", category: "prayer" }],
	});
	await extract({ userId: "alice", userText: "Dad's surgery went well. Pray about my interview?" });
	const [resolved, added] = prisma.state.memories;
	assert.equal(resolved.status, "answered");
	assert.equal(resolved.followUpAfter, null);
	assert.equal(added.status, "open");
	assert.equal(daysFromNow(added.followUpAfter), PRAYER_FOLLOW_UP_DAYS);
});

test("the extractor never sets a status on a memory that is not a prayer request", async () => {
	const prisma = makePrisma({ memories: [{ id: "a1", content: "Studying Romans", category: "study" }] });
	const extract = loadExtractor(prisma, { remove: [], update: [{ id: "a1", content: "Studying Romans 8", status: "closed" }], add: [] });
	await extract({ userId: "alice", userText: "I finished Romans" });
	assert.deepEqual(
		[prisma.state.memories[0].content, prisma.state.memories[0].status],
		["Studying Romans 8", null],
	);
});

test("the extractor loses to a prayer request resolved during the same turn", async () => {
	const prisma = makePrisma({ memories: [{ id: "a1", content: "Their dad's surgery", category: "prayer", ...prayerDefaults(new Date()) }] });
	const extract = loadExtractor(
		prisma,
		{ remove: [], update: [{ id: "a1", content: "Their dad's surgery", status: "closed" }], add: [] },
		() => { prisma.state.memories[0].status = "answered"; },
	);
	await extract({ userId: "alice", userText: "that one is done" });
	assert.equal(prisma.state.memories[0].status, "answered", "the tool's outcome stands");
});

test("explicit memory tool attempts own the turn, including failures", () => {
	for (const type of ["tool-listMemories", "tool-saveMemory", "tool-updateMemory", "tool-deleteMemories"]) {
		assert.equal(usedMemoryTools([{ type }, { type: "text" }]), true, type);
	}
	assert.equal(usedMemoryTools([{ type: "tool-saveMemory", state: "error" }]), true);
	assert.equal(usedMemoryTools([{ type: "text" }, { type: "tool-other" }]), false);
});

test("both chat routes gate background extraction on explicit memory tools", () => {
	for (const route of ["../src/app/api/ask-question/route.ts", "../src/app/api/note-ai/route.ts"]) {
		const source = read(route);
		assert.match(source, /import \{ usedMemoryTools \} from ["']@\/lib\/memory-policy["']/);
		assert.match(source, /!usedMemoryTools\(options\.responseMessage\.parts\)/);
	}
});

test("background extraction skips stale deletion, edit, or addition snapshots", async () => {
	for (const mutate of [
		(state) => { state.memories[0].content = "newer user edit"; },
		(state) => { state.memories.push({ id: "a2", userId: "alice", content: "newer memory", category: "general", updatedAt: 2 }); },
		(state) => { state.memories.splice(0, 1); },
	]) {
		const prisma = makePrisma({ memories: [{ id: "a1", content: "old", category: "general" }] });
		let expected;
		const extract = loadExtractor(prisma, { remove: ["a1"], update: [{ id: "a1", content: "corrected" }], add: [{ content: "new fact", category: "study" }] }, () => {
			mutate(prisma.state);
			expected = prisma.state.memories.map(({ id, content }) => ({ id, content }));
		});
		await extract({ userId: "alice", userText: "remember this" });
		assert.deepEqual(prisma.state.memories.map(({ id, content }) => ({ id, content })), expected);
	}
});

test("background extraction rechecks the toggle after generation", async () => {
	const prisma = makePrisma({ memories: [{ id: "a1", content: "old" }] });
	const extract = loadExtractor(prisma, { remove: ["a1"], update: [], add: [] }, () => {
		prisma.state.users.get("alice").memoryEnabled = false;
	});
	await extract({ userId: "alice", userText: "forget it" });
	assert.equal(prisma.state.memories.length, 1);
});

test("unchanged extraction applies scoped changes and deduplicates additions", async () => {
	const prisma = makePrisma({ memories: [{ id: "a1", content: "old", category: "general" }] });
	const extract = loadExtractor(prisma, {
		remove: [],
		update: [{ id: "a1", content: "updated" }],
		add: [
			{ content: " Updated ", category: "study" },
			{ content: "New fact", category: "study" },
			{ content: "new fact", category: "study" },
		],
	});
	await extract({ userId: "alice", userText: "update memory" });
	assert.deepEqual(prisma.state.memories.map(({ id, content, category }) => ({ id, content, category })), [
		{ id: "a1", content: "updated", category: "general" },
		{ id: "memory-2", content: "New fact", category: "study" },
	]);
});

test("removals are deduplicated before capacity and delete operations", async () => {
	const prisma = makePrisma({ memories: [{ id: "a1", content: "old", category: "general" }] });
	const extract = loadExtractor(prisma, { remove: ["a1", "a1"], update: [], add: [{ content: "replacement", category: "general" }] });
	await extract({ userId: "alice", userText: "replace memory" });
	assert.deepEqual(prisma.state.memories.map(({ content }) => content), ["replacement"]);
});
