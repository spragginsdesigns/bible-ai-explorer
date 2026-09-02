import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

const books = JSON.parse(read("../src/data/books.json"));
const bookByOrder = (order) => books.find((book) => book.order === order) ?? null;

// originals.ts reaches its data through `await import("@/data/originals/*.json")`,
// which node cannot resolve (webpack alias, and JSON needs an import attribute).
// Redirecting those calls at the source level lets the test exercise the real
// lookup logic against the real bundled text instead of a reimplementation.
const originalsDir = new URL("../src/data/originals/", import.meta.url);
const jsonCache = new Map();
async function loadJsonModule(name) {
	if (!jsonCache.has(name)) {
		jsonCache.set(name, JSON.parse(readFileSync(new URL(name, originalsDir), "utf8")));
	}
	return { default: jsonCache.get(name) };
}

function loadOriginals() {
	const source = read("../src/lib/bible/originals.ts")
		.replace(/await import\("@\/data\/originals\/([^"]+)"\)/g, 'await loadJsonModule("$1")')
		.replace(/^export\s+/gm, "");
	const factory = new Function(
		"loadJsonModule",
		`${stripTypeScriptTypes(source)}\nreturn { getOriginalVerse, lookupStrongsEntry };`
	);
	return factory(loadJsonModule);
}

const { getOriginalVerse, lookupStrongsEntry } = loadOriginals();

// Mirrors next/server's NextResponse.json, including the headers the routes set.
const NextResponse = {
	json(value, init = {}) {
		return new Response(JSON.stringify(value), {
			status: init.status ?? 200,
			headers: { "content-type": "application/json", ...(init.headers ?? {}) },
		});
	},
};

function loadRoute(relativePath, dependencies) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export\s+/gm, "");
	const names = Object.keys(dependencies);
	const factory = new Function(...names, `${stripTypeScriptTypes(source)}\nreturn GET;`);
	return factory(...names.map((name) => dependencies[name]));
}

const originalRoute = loadRoute("../src/app/api/bible/original/route.ts", {
	NextResponse,
	bookByOrder,
	getOriginalVerse,
});
const strongsRoute = loadRoute("../src/app/api/bible/strongs/route.ts", {
	NextResponse,
	lookupStrongsEntry,
});

const CACHE_CONTROL =
	"public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";

const callOriginal = (query) =>
	originalRoute(new Request(`http://localhost/api/bible/original${query}`));
const callStrongs = (query) =>
	strongsRoute(new Request(`http://localhost/api/bible/strongs${query}`));

test("Genesis 1:1 returns the Hebrew text with Strong's numbers", async () => {
	const response = await callOriginal("?book=1&chapter=1&verse=1");
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), CACHE_CONTROL);

	const body = await response.json();
	assert.deepEqual(
		{ book: body.book, chapter: body.chapter, verse: body.verse },
		{ book: 1, chapter: 1, verse: 1 }
	);
	assert.equal(body.reference, "Genesis 1:1");
	assert.equal(body.language, "Hebrew");
	assert.equal(body.textName, "Westminster Leningrad Codex");
	assert.ok(body.words.length > 0, "Genesis 1:1 must have words");
	assert.match(body.words[0].strongs, /^H\d+$/);
	assert.ok(body.words[0].text.length > 0, "each word must carry its text");
});

test("John 3:16 returns the Greek text", async () => {
	const response = await callOriginal("?book=43&chapter=3&verse=16");
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), CACHE_CONTROL);

	const body = await response.json();
	assert.equal(body.reference, "John 3:16");
	assert.equal(body.language, "Greek");
	assert.equal(body.textName, "Scrivener 1894 Textus Receptus");
	assert.ok(body.words.length > 0, "John 3:16 must have words");
	assert.match(body.words[0].strongs, /^G\d+$/);
});

test("a verse outside the versification is a 404, not an error", async () => {
	const response = await callOriginal("?book=1&chapter=1&verse=999");
	assert.equal(response.status, 404);
	assert.deepEqual(await response.json(), { error: "not_found" });
});

test("malformed references are rejected with 400", async () => {
	const cases = [
		"?book=0&chapter=1&verse=1",
		"?book=67&chapter=1&verse=1",
		"?book=1&chapter=0&verse=1",
		"?book=1&chapter=1&verse=0",
		"?book=Genesis&chapter=1&verse=1",
		"?book=1.5&chapter=1&verse=1",
		"?book=-1&chapter=1&verse=1",
		"?chapter=1&verse=1",
		"?book=1&verse=1",
		"?book=1&chapter=1",
	];

	for (const query of cases) {
		const response = await callOriginal(query);
		assert.equal(response.status, 400, `${query} must be rejected`);
		assert.deepEqual(await response.json(), { error: "invalid_reference" });
	}
});

test("Strong's H430 returns a dictionary entry", async () => {
	const response = await callStrongs("?number=H430");
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), CACHE_CONTROL);

	const body = await response.json();
	assert.equal(body.number, "H430");
	assert.ok(body.lemma.length > 0, "lemma must not be empty");
	assert.equal(typeof body.translit, "string");
	assert.equal(typeof body.def, "string");
	assert.equal(typeof body.kjv, "string");
});

test("Strong's numbers are normalized before lookup", async () => {
	for (const query of ["?number=h0430", "?number=%20H430%20", "?number=H0430"]) {
		const response = await callStrongs(query);
		assert.equal(response.status, 200, `${query} must resolve`);
		assert.equal((await response.json()).number, "H430");
	}

	const greek = await callStrongs("?number=G26");
	assert.equal(greek.status, 200);
	assert.equal((await greek.json()).number, "G26");
});

test("malformed Strong's numbers are rejected with 400", async () => {
	for (const query of ["?number=xyz", "?number=430", "?number=H", "?number=H123456", ""]) {
		const response = await callStrongs(query);
		assert.equal(response.status, 400, `${query} must be rejected`);
		assert.deepEqual(await response.json(), { error: "invalid_number" });
	}
});

test("an unknown but well-formed Strong's number is a 404", async () => {
	const response = await callStrongs("?number=H99999");
	assert.equal(response.status, 404);
	assert.deepEqual(await response.json(), { error: "not_found" });
});
