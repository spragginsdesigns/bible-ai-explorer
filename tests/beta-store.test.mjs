/**
 * SureWord Beta's shared study store (LC-17631, docs/beta/README.md): the pure
 * rules every module's writes go through (src/lib/beta/store-rules.ts), and
 * the owner scoping of the server half (src/lib/beta/store.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	BETA_DATA_MAX_BYTES,
	BETA_REFS_MAX,
	BETA_TITLE_MAX,
	betaRefKey,
	checkBetaItemInput,
	checkBetaItemPatch,
	checkBetaLinkInput,
	isBetaKind,
	normalizeBetaRefs,
	normalizeBetaTopics,
	parseBetaRefKey,
} from "../src/lib/beta/store-rules.ts";

const MODULES = ["projects", "vault"];
const base = { module: "projects", kind: "project", title: "The Book of Romans" };

test("passage keys round-trip and reject anything outside the 66 books", () => {
	assert.equal(betaRefKey(43, 3, 16), "43.3.16");
	assert.equal(betaRefKey(45, 5), "45.5");
	assert.deepEqual(parseBetaRefKey("43.3.16"), { book: 43, chapter: 3, verse: 16 });
	assert.deepEqual(parseBetaRefKey("1.1"), { book: 1, chapter: 1 });
	for (const bad of ["0.1", "67.1", "43.0", "43.3.0", "43", "John 3:16", "43.3.16.1", " 43.3", "43.x"]) {
		assert.equal(parseBetaRefKey(bad), null, bad);
	}
});

test("refs gain their chapter, lose duplicates, and sort in Bible order", () => {
	assert.deepEqual(normalizeBetaRefs(["48.2.16", "45.5.1", "1.3", "45.5.1", "45.5"]), ["1.3", "45.5", "45.5.1", "48.2", "48.2.16"]);
	assert.deepEqual(normalizeBetaRefs([" 43.3.16 "]), ["43.3", "43.3.16"]);
	assert.deepEqual(normalizeBetaRefs([]), []);
	assert.equal(normalizeBetaRefs(["43.3.16", "Romans 5"]), null, "one bad key rejects the list");
	assert.equal(normalizeBetaRefs([43]), null);
	const many = Array.from({ length: BETA_REFS_MAX + 1 }, (_, i) => `19.119.${i + 1}`);
	assert.equal(normalizeBetaRefs(many), null, "Psalm 119 verse by verse plus its chapter overflows the cap");
});

test("topics are lowercase, single-spaced and unique", () => {
	assert.deepEqual(normalizeBetaTopics(["Justification ", "justification", "  Holy   Spirit"]), ["justification", "holy spirit"]);
	assert.equal(normalizeBetaTopics(["   "]), null);
	assert.equal(normalizeBetaTopics([7]), null);
	assert.equal(normalizeBetaTopics(["x".repeat(61)]), null);
});

test("kinds are short lowercase slugs", () => {
	for (const ok of ["project", "source", "builds-on", "q2"]) assert.equal(isBetaKind(ok), true, ok);
	for (const bad of ["", "Project", "2nd", "with space", "x".repeat(41), null]) assert.equal(isBetaKind(bad), false, String(bad));
});

test("a new item is checked against the registry and normalized", () => {
	const ok = checkBetaItemInput({ ...base, title: "  The Book   of Romans ", body: "  ", refs: ["45.5.1"], topics: ["Grace"] }, MODULES);
	assert.equal(ok.ok, true);
	assert.deepEqual(ok.value, { module: "projects", kind: "project", title: "The Book of Romans", parentId: null, body: null, data: {}, refs: ["45.5", "45.5.1"], topics: ["grace"] });

	assert.match(checkBetaItemInput({ ...base, module: "atlas" }, MODULES).error, /unknown module/);
	assert.match(checkBetaItemInput({ ...base, kind: "Project" }, MODULES).error, /kind/);
	assert.match(checkBetaItemInput({ ...base, title: "   " }, MODULES).error, /title is empty/);
	assert.match(checkBetaItemInput({ ...base, title: "x".repeat(BETA_TITLE_MAX + 1) }, MODULES).error, /longer/);
	assert.match(checkBetaItemInput({ ...base, refs: ["Romans 5"] }, MODULES).error, /passage keys/);
	assert.match(checkBetaItemInput({ ...base, parentId: "" }, MODULES).error, /parentId/);
});

test("data must be a small plain JSON object", () => {
	for (const data of [[], "text", 4, null, new Date(), new Map()]) {
		assert.equal(checkBetaItemInput({ ...base, data }, MODULES).ok, false, String(data));
	}
	const circular = {};
	circular.self = circular;
	assert.match(checkBetaItemInput({ ...base, data: circular }, MODULES).error, /JSON-serializable/);
	assert.match(checkBetaItemInput({ ...base, data: { text: "x".repeat(BETA_DATA_MAX_BYTES) } }, MODULES).error, /larger/);
	assert.deepEqual(checkBetaItemInput({ ...base, data: { progress: 0.5, sections: [1, 2] } }, MODULES).value.data, { progress: 0.5, sections: [1, 2] });
	assert.equal(checkBetaItemInput({ ...base, data: Object.create(null) }, MODULES).ok, true);
});

test("a patch checks only what it changes, and an empty patch is refused", () => {
	assert.deepEqual(checkBetaItemPatch({ title: " Romans 5 " }).value, { title: "Romans 5" });
	assert.deepEqual(checkBetaItemPatch({ body: null, refs: ["45.5.12"] }).value, { body: null, refs: ["45.5", "45.5.12"] });
	assert.match(checkBetaItemPatch({}).error, /nothing to change/);
	assert.equal(checkBetaItemPatch({ data: [] }).ok, false);
	assert.equal(checkBetaItemPatch({ topics: [""] }).ok, false);
});

test("links join two different items with a kind, an optional reason and an origin", () => {
	assert.deepEqual(checkBetaLinkInput({ fromId: "a", toId: "b", kind: "builds-on", reason: "  Same truth  " }).value, {
		fromId: "a",
		toId: "b",
		kind: "builds-on",
		reason: "Same truth",
		origin: "user",
	});
	assert.equal(checkBetaLinkInput({ fromId: "a", toId: "b", kind: "related", origin: "suggested" }).value.origin, "suggested");
	assert.match(checkBetaLinkInput({ fromId: "a", toId: "a", kind: "related" }).error, /itself/);
	assert.match(checkBetaLinkInput({ fromId: "", toId: "b", kind: "related" }).error, /two item ids/);
	assert.match(checkBetaLinkInput({ fromId: "a", toId: "b", kind: "Related" }).error, /kind/);
	assert.match(checkBetaLinkInput({ fromId: "a", toId: "b", kind: "related", origin: "admin" }).error, /origin/);
	assert.match(checkBetaLinkInput({ fromId: "a", toId: "b", kind: "related", reason: "x".repeat(1001) }).error, /reason/);
	assert.equal(checkBetaLinkInput({ fromId: "a", toId: "b", kind: "related", reason: "   " }).value.reason, null);
});

test("every store query and write is scoped to its owner", () => {
	const source = readFileSync(new URL("../src/lib/beta/store.ts", import.meta.url), "utf8");
	const calls = [...source.matchAll(/prisma\.beta(Item|Link)\.(\w+)\(\{\s*where: \{([^}]*)/g)];
	assert.ok(calls.length >= 7, "every read, update and delete goes through a where clause");
	for (const [, model, method, where] of calls) {
		if (method === "upsert") continue;
		assert.match(where, /\buserId\b/, `prisma.beta${model}.${method} must filter by userId`);
	}
	assert.match(source, /prisma\.betaItem\.count\(\{ where: \{ userId, id: \{ in: \[link\.fromId, link\.toId\] \} \} \}\)/, "a link checks both items are the owner's first");
	assert.equal(/prisma\.beta(Item|Link)\.(update|delete)\(/.test(source), false, "single-row update/delete would skip the owner filter");
});
