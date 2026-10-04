/* Web notes parity with Android.
 *
 * The web notes screen re-implements Android's pure note helpers (wikilink
 * targets, property/alias rules, card timestamps) and its persisted library
 * cache. These tests run both clients' modules side by side so the two cannot
 * drift, and pin the cache merge that keeps a background refetch from undoing
 * a local edit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function load(relative, mocks = {}) {
	const filename = path.resolve(relative);
	const module = { exports: {} };
	const localRequire = createRequire(filename);
	const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
	}).outputText;
	new Function("require", "module", "exports", source)(
		(id) => (id in mocks ? mocks[id] : localRequire(id)),
		module,
		module.exports
	);
	return module.exports;
}

const webLinks = load("src/components/notes/wikilinks.ts");
const nativeLinks = load("mobile/src/features/notes/wikilinks.ts");
const webProps = load("src/components/notes/notePropertyRules.ts");
const nativeProps = load("mobile/src/features/notes/noteProperties.ts");
const webTime = load("src/components/notes/noteTime.ts");
const nativeUtils = load("mobile/src/features/notes/utils.ts");
const cache = load("src/components/notes/notesCache.ts");
const types = load("src/types/notes.ts");

function makeNote(id, title, extra = {}) {
	return {
		id,
		title,
		content: "",
		htmlContent: "",
		plainText: "",
		folderId: null,
		tagIds: [],
		aliases: [],
		properties: null,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		isPinned: false,
		wordCount: 0,
		...extra,
	};
}

test("wikilink formatting strips [ ] | # exactly like Android", () => {
	for (const raw of ["Romans [1] | notes # 3", "  Grace  ", "[[]]", "a|b", "Psalm 23"]) {
		assert.equal(webLinks.formatWikilink(raw), nativeLinks.formatWikilink(raw), raw);
		assert.equal(webLinks.sanitizeWikilinkTarget(raw), nativeLinks.sanitizeWikilinkTarget(raw), raw);
	}
	assert.equal(webLinks.formatWikilink("Romans [1] | notes"), "[[Romans 1 notes]]");
	assert.equal(webLinks.formatWikilink("[]|#"), "");
});

test("the Link to: row is hidden for an existing title or alias, never for the current note", () => {
	const notes = [
		makeNote("a", "Romans study", { aliases: ["Paul to Rome"] }),
		makeNote("b", "Grace alone"),
	];
	for (const [query, exclude] of [
		["romans study", "b"],
		["PAUL TO ROME", "b"],
		["Romans study", "a"],
		["New idea", "a"],
		["", "a"],
	]) {
		assert.equal(
			webLinks.hasExactTarget(notes, query, exclude),
			nativeLinks.hasExactTarget(notes, query, exclude),
			`${query} / ${exclude}`
		);
	}
	// The note being edited cannot satisfy its own link.
	assert.equal(webLinks.hasExactTarget(notes, "Romans study", "a"), false);
	assert.deepEqual(
		webLinks.filterNotesForLinking(notes, "rome", "b").map((n) => n.id),
		["a"]
	);
});

test("the wikilink picker sorts most recently updated first", () => {
	const notes = [
		makeNote("old", "Old", { updatedAt: "2026-01-01T00:00:00.000Z" }),
		makeNote("new", "New", { updatedAt: "2026-03-01T00:00:00.000Z" }),
		makeNote("mid", "Mid", { updatedAt: "2026-02-01T00:00:00.000Z" }),
	];
	assert.deepEqual(webLinks.sortByRecentlyUpdated(notes).map((n) => n.id), ["new", "mid", "old"]);
	assert.deepEqual(notes.map((n) => n.id), ["old", "new", "mid"], "input is not mutated");
});

test("property keys and aliases dedupe ignoring case and whitespace, as on Android", () => {
	const props = { Speaker: "Paul", "Book  of": "Romans" };
	for (const [key, ignore] of [
		["speaker", undefined],
		["  SPEAKER ", undefined],
		["Speaker", "Speaker"],
		["book of", undefined],
		["Date", undefined],
	]) {
		assert.equal(
			webProps.propertyKeyTaken(props, key, ignore),
			nativeProps.propertyKeyTaken(props, key, ignore),
			`${key} / ${ignore}`
		);
	}
	assert.equal(webProps.propertyKeyTaken(props, " speaker "), true);
	const aliases = ["Grace", " grace ", "GRACE", "Mercy", "", "  Two   words "];
	assert.deepEqual(webProps.normalizeAliases(aliases), nativeProps.normalizeAliases(aliases));
	assert.deepEqual(webProps.normalizeAliases(aliases), ["Grace", "Mercy", "Two words"]);
});

test("renaming a property key or changing its type is one write that drops the old key", () => {
	const props = { Speaker: "Paul", Count: 3 };
	assert.deepEqual(webProps.setNoteProperty(props, "Preacher", "Paul", "Speaker"), {
		Count: 3,
		Preacher: "Paul",
	});
	assert.deepEqual(
		webProps.setNoteProperty(props, "Count", webProps.parsePropertyValue("list", "a, b"), "Count"),
		{ Speaker: "Paul", Count: ["a", "b"] }
	);
	for (const [type, raw] of [["number", "x"], ["number", "4"], ["checkbox", "maybe"], ["list", " , "], ["text", " hi "]]) {
		assert.deepEqual(webProps.parsePropertyValue(type, raw), nativeProps.parsePropertyValue(type, raw));
	}
});

test("note cards show Android's relative time and word count", () => {
	const now = Date.now();
	for (const offset of [5_000, 5 * 60_000, 3 * 3_600_000, 2 * 86_400_000, 40 * 86_400_000]) {
		const iso = new Date(now - offset).toISOString();
		assert.equal(webTime.relativeTime(iso), nativeUtils.relativeTime(iso));
	}
	const iso = new Date(now - 3 * 3_600_000).toISOString();
	assert.equal(webTime.noteMetaLine(iso, 120), "3h ago · 120 words");
	assert.equal(webTime.noteMetaLine(iso, 0), "3h ago");
});

test("a background refetch never undoes local writes made after it started", () => {
	const local = [
		makeNote("edited", "Local title"),
		makeNote("created", "Brand new"),
		makeNote("untouched", "Old copy"),
	];
	const server = [
		makeNote("edited", "Server title"),
		makeNote("deleted", "Gone locally"),
		makeNote("untouched", "Fresh copy"),
		makeNote("remote", "Made on Android"),
	];
	const touched = new Map([
		["edited", 5],
		["created", 6],
		["deleted", 7],
		["untouched", 1],
	]);
	const merged = cache.mergeServerRows(server, local, touched, 4);
	assert.deepEqual(
		merged.map((n) => [n.id, n.title]),
		[
			["created", "Brand new"],
			["edited", "Local title"],
			["untouched", "Fresh copy"],
			["remote", "Made on Android"],
		]
	);
	// Once a later request starts, the server is the source of truth again.
	assert.deepEqual(
		cache.mergeServerRows(server, local, touched, 8).map((n) => n.id),
		["edited", "deleted", "untouched", "remote"]
	);
});

test("a save that settled during the refresh beats the older snapshot", () => {
	// Touched before the GET started, but its PATCH committed after the GET
	// read the row: the snapshot is older than what is already on screen.
	const saved = { ...makeNote("body", "Saved"), updatedAt: "2026-10-04T12:00:05.000Z" };
	const stale = { ...makeNote("body", "Stale"), updatedAt: "2026-10-04T12:00:00.000Z" };
	const touched = new Map([["body", 2]]);
	assert.equal(cache.mergeServerRows([stale], [saved], touched, 4)[0].title, "Saved");
	// A genuinely newer server row (an edit made on the phone) still wins.
	const newer = { ...makeNote("body", "From phone"), updatedAt: "2026-10-04T12:01:00.000Z" };
	assert.equal(cache.mergeServerRows([newer], [saved], touched, 4)[0].title, "From phone");
});

function memoryStorage(initial = {}) {
	const data = new Map(Object.entries(initial));
	return {
		get length() {
			return data.size;
		},
		key: (i) => [...data.keys()][i] ?? null,
		getItem: (k) => (data.has(k) ? data.get(k) : null),
		setItem: (k, v) => {
			data.set(k, String(v));
		},
		removeItem: (k) => {
			data.delete(k);
		},
		data,
	};
}

test("the notes cache is per user and drops every other account's library", () => {
	const storage = memoryStorage({ unrelated: "keep" });
	const snapshot = { notes: [makeNote("n1", "Mine")], folders: [], tags: [] };
	cache.writeNotesCache(storage, "user_a", snapshot);
	cache.writeNotesCache(storage, "user_b", { notes: [makeNote("n2", "Theirs")], folders: [], tags: [] });

	assert.deepEqual(cache.readNotesCache(storage, "user_a"), snapshot);
	assert.equal(cache.readNotesCache(storage, "user_c"), null);

	cache.clearOtherNotesCaches(storage, "user_a");
	assert.equal(cache.readNotesCache(storage, "user_b"), null);
	assert.ok(cache.readNotesCache(storage, "user_a"));
	assert.equal(storage.getItem("unrelated"), "keep");
});

test("a corrupt or unwritable cache degrades to no cache", () => {
	const storage = memoryStorage({ [cache.notesCacheKey("u")]: "{not json" });
	assert.equal(cache.readNotesCache(storage, "u"), null);
	assert.equal(storage.getItem(cache.notesCacheKey("u")), null, "corrupt blob removed");

	const full = memoryStorage({ [cache.notesCacheKey("u")]: JSON.stringify({ notes: [], folders: [], tags: [] }) });
	full.setItem = () => {
		throw new Error("QuotaExceededError");
	};
	cache.writeNotesCache(full, "u", { notes: [makeNote("n", "Big")], folders: [], tags: [] });
	assert.equal(full.getItem(cache.notesCacheKey("u")), null, "a partial copy is never left behind");
});

test("the editor falls back to htmlContent when content is empty", () => {
	assert.equal(types.editorContentFor({ content: "", htmlContent: "<p>Verse</p>" }), "<p>Verse</p>");
	assert.equal(types.editorContentFor({ content: "  ", htmlContent: "<p>Verse</p>" }), "<p>Verse</p>");
	assert.equal(types.editorContentFor({ content: '{"type":"doc"}', htmlContent: "<p>x</p>" }), '{"type":"doc"}');
});
