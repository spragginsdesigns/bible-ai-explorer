import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { generateAppleAtlas } from "../scripts/build-apple-atlas.mjs";

const generated = await generateAppleAtlas({ check: true });
function runtime() {
	const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
	vm.runInContext(generated.script, context);
	return { context, query: (operation, parameters = {}) =>
		JSON.parse(context.surewordAtlasQuery(operation, JSON.stringify(parameters))) };
}

test("Apple generated atlas and golden cases are byte-synced to the reviewed canonical source", () => {
	assert.deepEqual(generated.manifest.counts, { events: 220, people: 186, places: 93, relations: 83 });
	for (const input of generated.manifest.sourceFiles) {
		assert.equal(createHash("sha256").update(readFileSync(new URL("../" + input.path, import.meta.url))).digest("hex"), input.sha256);
	}
	assert.equal(createHash("sha256").update(generated.script).digest("hex"), generated.manifest.scriptSha256);
	assert.equal(generated.golden.inputSha256, generated.manifest.inputSha256);
});

test("compiled offline bridge matches the source-core oracle across every query and API error", () => {
	const { query } = runtime();
	for (const fixture of generated.golden.cases) {
		const actual = query(fixture.operation, fixture.parameters);
		assert.equal(actual.status, fixture.status, fixture.name);
		if (fixture.status === 200) assert.deepEqual(actual.value, fixture.value, fixture.name);
	}
	assert.equal(generated.golden.cases.length, 31);
});

test("offline pagination, alias ranking, untruncated counts and shortest paths retain useful semantics", () => {
	const { query } = runtime();
	const first = query("entities", { kind: "person", limit: 3 }).value;
	const next = query("entities", { kind: "person", limit: 3, cursor: first.nextCursor }).value;
	assert.equal(first.results.length, 3);
	assert.equal(next.results.length, 3);
	assert.equal(new Set([...first.results, ...next.results].map((item) => item.id)).size, 6);
	assert.equal(query("search", { query: "Saul", limit: 25 }).value.results.some((item) => item.id === "paul"), true);
	const common = query("search", { query: "the", limit: 2 }).value;
	assert.equal(common.results.length, 2);
	assert.ok(common.counts.total > common.results.length);
	assert.deepEqual(query("connection", { from: "abraham", to: "jacob" }).value.path.ids, ["abraham", "isaac", "jacob"]);
	assert.equal(query("chapter", { book: 6, chapter: 6 }).value.places.some((place) => place.id === "jericho"), true);
	const abraham = query("entity", { id: "abraham" }).value.entity;
	assert.ok(abraham.relations.some((edge) => edge.type === "parent"));
	assert.ok(abraham.relationDetails.some((edge) => edge.label === "Child"));
});

test("queries remain JSON arguments, never code or network access", () => {
	const { context, query } = runtime();
	const attemptedCode = "'); globalThis.atlasQueryExecutedCode = true; //";
	const result = query("search", { query: attemptedCode });
	assert.equal(result.status, 200);
	assert.equal(context.atlasQueryExecutedCode, undefined);
	assert.equal(context.fetch, undefined);
	assert.equal(context.require, undefined);
	assert.equal(query("event", { id: attemptedCode }).status, 404);
});

