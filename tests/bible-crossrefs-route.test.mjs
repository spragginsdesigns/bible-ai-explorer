import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

/**
 * The route under test, with its imports replaced by injected doubles - the
 * same harness tests/bible-original-routes.test.mjs uses. The reference parser
 * and book names are the real ones; only the ranked edges and the verse text
 * are stubbed, so the ordering assertions are about the route and not about
 * the 225,683-edge data set.
 */
function loadModule(relativePath, dependencies, returns) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export\s+/gm, "");
	const names = Object.keys(dependencies);
	const factory = new Function(...names, `${stripTypeScriptTypes(source)}\nreturn ${returns};`);
	return factory(...names.map((name) => dependencies[name]));
}

const { bookByOrder, resolveReference } = loadModule(
	"../src/lib/bible/books.ts",
	{ booksJson: JSON.parse(read("../src/data/books.json")), bookNamesJson: JSON.parse(read("../src/data/book-names.json")) },
	"{ bookByOrder, resolveReference }"
);

// Mirrors next/server's NextResponse.json, including the headers the route sets.
const NextResponse = {
	json(value, init = {}) {
		return new Response(JSON.stringify(value), {
			status: init.status ?? 200,
			headers: { "content-type": "application/json", ...(init.headers ?? {}) },
		});
	},
};

// The route only asks TRANSLATIONS which ids exist; the drift guard below pins
// that list to the union translations.ts actually declares.
const TRANSLATIONS = {
	BSB: { id: "BSB" }, KJV: { id: "KJV" }, NKJV: { id: "NKJV" }, ASV: { id: "ASV" },
	RV1909: { id: "RV1909" }, LUT1912: { id: "LUT1912" } };

const CACHE_CONTROL =
	"public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";
const DEGRADED_CACHE_CONTROL = "public, max-age=60, s-maxage=60";

/** Edges for Romans 8:28, in the order the data ranks them. */
const ROMANS_8_28 = [
	{ order: 45, chapter: 8, verse: 29 },
	{ order: 49, chapter: 1, verse: 11 },
	{ order: 20, chapter: 16, verse: 4 },
	{ order: 45, chapter: 9, verse: 11 },
	{ order: 58, chapter: 12, verse: 6, endChapter: 12, endVerse: 11 },
	{ order: 19, chapter: 46, verse: 1 },
	{ order: 43, chapter: 3, verse: 36, endChapter: 4, endVerse: 2 },
	{ order: 59, chapter: 1, verse: 12 },
];

/** A route bound to one set of edges and one verse-text loader. */
function routeWith({ edges = ROMANS_8_28, verseText } = {}) {
	const lookups = [];
	const getVerseText = async (translation, order, chapter, verse) => {
		lookups.push({ translation, order, chapter, verse });
		if (typeof verseText === "function") return verseText(translation, order, chapter, verse);
		return `text ${order}:${chapter}:${verse}`;
	};
	const GET = loadModule(
		"../src/app/api/bible/crossrefs/route.ts",
		{
			NextResponse,
			bookByOrder,
			resolveReference,
			getCrossReferencesFor: async () => edges,
			getVerseText,
			TRANSLATIONS,
		},
		"GET"
	);
	return { GET, lookups };
}

async function call(query, options) {
	const { GET, lookups } = routeWith(options);
	const response = await GET(new Request(`https://sureword.app/api/bible/crossrefs${query}`));
	return { response, body: await response.json(), lookups };
}

test("the translation ids the route accepts are the ones the reader declares", () => {
	const union = read("../src/lib/bible/translations.ts").match(
		/export type TranslationId = ([^;]+);/
	);
	assert.ok(union, "translations.ts still declares a TranslationId union");
	assert.equal(union[1].trim(), '"KJV" | "NKJV" | "BSB" | "ASV" | "RV1909" | "LUT1912"');
	assert.deepEqual(Object.keys(TRANSLATIONS).sort(), ["ASV", "BSB", "KJV", "LUT1912", "NKJV", "RV1909"]);
});

test("a reference that does not name a verse is rejected", async () => {
	for (const query of ["", "?reference=", "?reference=Romans%208", "?reference=nonsense"]) {
		const { response, body } = await call(query);
		assert.equal(response.status, 400, query);
		assert.equal(body.error, "invalid_reference", query);
	}
});

test("limit must be a whole number from 1 to 20", async () => {
	for (const limit of ["0", "-1", "1.5", "five", "21", "999", ""]) {
		const { response, body } = await call(`?reference=Romans+8:28&limit=${limit}`);
		assert.equal(response.status, 400, limit);
		assert.equal(body.error, "invalid_limit", limit);
	}
	const { response, body } = await call("?reference=Romans+8:28&limit=20");
	assert.equal(response.status, 200);
	assert.equal(body.crossReferences.length, ROMANS_8_28.length);
});

test("an unknown translation is refused rather than silently answered in KJV", async () => {
	const { response, body } = await call("?reference=Romans+8:28&translation=ESV");
	assert.equal(response.status, 400);
	assert.equal(body.error, "invalid_translation");
});

test("five references by default, in the order the data ranks them", async () => {
	const { response, body } = await call("?reference=Romans+8:28");
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), CACHE_CONTROL);
	assert.equal(body.reference, "Romans 8:28");
	assert.equal(body.translation, "KJV");
	assert.deepEqual(
		body.crossReferences.map((ref) => ref.reference),
		["Romans 8:29", "Ephesians 1:11", "Proverbs 16:4", "Romans 9:11", "Hebrews 12:6-11"]
	);
});

test("a lower limit takes the top of the same ranking", async () => {
	const { body } = await call("?reference=Romans+8:28&limit=2");
	assert.deepEqual(
		body.crossReferences.map((ref) => ref.reference),
		["Romans 8:29", "Ephesians 1:11"]
	);
});

test("single verses and complete same-chapter ranges are quoted, cross-chapter ranges not at all", async () => {
	const { body, lookups } = await call("?reference=Romans+8:28&limit=20");
	const byReference = new Map(body.crossReferences.map((ref) => [ref.reference, ref]));

	assert.equal(byReference.get("Romans 8:29").text, "text 45:8:29");
	// Hebrews 12:6-11 is six verses; all six must appear beneath its full reference.
	assert.equal(
		byReference.get("Hebrews 12:6-11").text,
		"text 58:12:6 text 58:12:7 text 58:12:8 text 58:12:9 text 58:12:10 text 58:12:11"
	);
	// John 3:36-4:2 crosses a chapter, so it stays reference-only.
	assert.equal(byReference.get("John 3:36-4:2").text, undefined);
	assert.ok(!lookups.some((lookup) => lookup.order === 43));
});

test("the requested translation is what the verse text is read in", async () => {
	const { body, lookups } = await call("?reference=Romans+8:28&limit=1&translation=NKJV");
	assert.equal(body.translation, "NKJV");
	assert.deepEqual(lookups, [{ translation: "NKJV", order: 45, chapter: 8, verse: 29 }]);
});

test("a verse whose text is missing is listed reference-only", async () => {
	const { body } = await call("?reference=Romans+8:28&limit=1", {
		verseText: async () => undefined,
	});
	assert.deepEqual(body.crossReferences.map(({ reference, text }) => ({ reference, ...(text ? { text } : {}) })), [{ reference: "Romans 8:29" }]);
});

test("an unreachable translation source costs the text, not the row", async () => {
	const { response, body } = await call("?reference=Romans+8:28&limit=2&translation=NKJV", {
		verseText: async () => {
			throw new Error("That chapter could not be loaded.");
		},
	});
	assert.equal(response.status, 200);
	assert.deepEqual(body.crossReferences.map(({ reference, text }) => ({ reference, ...(text ? { text } : {}) })), [
		{ reference: "Romans 8:29" },
		{ reference: "Ephesians 1:11" },
	]);
	// Cached for a week, the reference-only rows would outlive the outage.
	assert.equal(response.headers.get("cache-control"), DEGRADED_CACHE_CONTROL);
});

test("one failed lookup among good ones still keeps the answer out of the long cache", async () => {
	const { response, body } = await call("?reference=Romans+8:28&limit=2&translation=NKJV", {
		verseText: async (translation, order, chapter, verse) => {
			if (order === 49) throw new Error("That chapter could not be loaded.", { cause: new Error("timeout") });
			return `text ${order}:${chapter}:${verse}`;
		},
	});
	assert.deepEqual(body.crossReferences.map(({ reference, text }) => ({ reference, ...(text ? { text } : {}) })), [
		{ reference: "Romans 8:29", text: "text 45:8:29" },
		{ reference: "Ephesians 1:11" },
	]);
	assert.equal(response.headers.get("cache-control"), DEGRADED_CACHE_CONTROL);
});

test("a missing verse prevents the long cache from retaining reference-only output", async () => {
	const { response } = await call("?reference=Romans+8:28&limit=1", {
		verseText: async () => undefined,
	});
	assert.equal(response.headers.get("cache-control"), DEGRADED_CACHE_CONTROL);
});

test("the server's NKJV fetch gives up well inside the route's time limit", () => {
	const route = read("../src/app/api/bible/crossrefs/route.ts");
	const maxDuration = Number(route.match(/export const maxDuration = (\d+);/)[1]);
	const loader = read("../src/lib/bible/translations.ts");
	const timeout = loader.match(
		/const NKJV_TIMEOUT_MS = typeof window === "undefined" \? (\d+) : \d+;/
	);
	assert.ok(timeout, "translations.ts still sets a server-side NKJV timeout");
	assert.ok(Number(timeout[1]) <= (maxDuration * 1000) / 1.5, `${timeout[1]} ms vs ${maxDuration} s`);
});

test("a verse with no cross-references answers an empty list, not a 404", async () => {
	const { response, body } = await call("?reference=3+John+1:14", { edges: [] });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), CACHE_CONTROL);
	assert.deepEqual(body.crossReferences.map(({ reference, text }) => ({ reference, ...(text ? { text } : {}) })), []);
	assert.equal(body.reference, "3 John 1:14");
});


test("the real John 12:36-40 edge returns all five KJV verses", async () => {
	const kjv = JSON.parse(read("../src/data/kjv/43-john.json"));
	const edges = JSON.parse(read("../src/data/crossrefs/43-john.json"))["1:5"]
		.map(([order, chapter, verse, endChapter, endVerse]) => ({ order, chapter, verse, endChapter, endVerse }));
	const { response, body } = await call("?reference=John+1:5&limit=20", {
		edges,
		verseText: async (_translation, order, chapter, verse) => order === 43 ? kjv[chapter - 1][verse - 1] : `text ${order}:${chapter}:${verse}`,
	});
	assert.equal(response.status, 200);
	const ref = body.crossReferences.find(row => row.reference === "John 12:36-40");
	assert.equal(ref.text, kjv[11].slice(35, 40).join(" "));
	assert.equal(ref.quotedReference, "John 12:36-40");
	assert.deepEqual(ref.coverage, { requestedReference: "John 12:36-40", returnedReference: "John 12:36-40", requestedVerseCount: 5, returnedVerseCount: 5, truncated: false });
});

test("exactly 30 verses are quoted completely; longer spans remain reference-only", async () => {
	const edges = [30, 31].map(endVerse => ({ order: 19, chapter: 119, verse: 1, endChapter: 119, endVerse }));
	const { response, body, lookups } = await call("?reference=Psalm+119:1&limit=20", { edges });
	assert.equal(response.headers.get("cache-control"), CACHE_CONTROL);
	assert.equal(body.crossReferences[0].text, Array.from({ length: 30 }, (_, i) => `text 19:119:${i + 1}`).join(" "));
	assert.equal(body.crossReferences[0].coverage.returnedVerseCount, 30);
	assert.equal(body.crossReferences[0].coverage.truncated, false);
	const long = body.crossReferences[1];
	assert.equal(long.reference, "Psalms 119:1-31");
	assert.equal(long.text, undefined);
	assert.equal(long.quotedReference, null);
	assert.deepEqual(long.coverage, { requestedReference: "Psalms 119:1-31", returnedReference: null, requestedVerseCount: 31, returnedVerseCount: 0, truncated: true });
	assert.match(long.notice, /exceeds 30/);
	assert.equal(lookups.length, 30);
});

for (const mode of ["missing", "empty", "failure"]) {
	test(`a ${mode} verse after good text discards the entire quotation and degrades caching`, async () => {
		const { response, body } = await call("?reference=John+1:5", {
			edges: [{ order: 43, chapter: 12, verse: 36, endChapter: 12, endVerse: 40 }],
			verseText: async (_translation, _order, _chapter, verse) => {
				if (verse === 40) {
					if (mode === "failure") throw new Error("timeout");
					return mode === "empty" ? "  " : undefined;
				}
				return `text ${verse}`;
			},
		});
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), DEGRADED_CACHE_CONTROL);
		const ref = body.crossReferences[0];
		assert.equal(ref.reference, "John 12:36-40");
		assert.equal(ref.text, undefined);
		assert.equal(ref.quotedReference, null);
		assert.equal(ref.coverage.requestedVerseCount, 5);
		assert.equal(ref.coverage.returnedVerseCount, 0);
		assert.equal(ref.coverage.truncated, true);
		assert.match(ref.notice, /no quotation was returned/);
	});
}

test("cross-chapter rows explicitly disclose quotation coverage and list counts stay separate", async () => {
	const { body, lookups } = await call("?reference=Romans+8:28&limit=20");
	const ref = body.crossReferences.find(row => row.reference === "John 3:36-4:2");
	assert.equal(ref.quotedReference, null);
	assert.equal(ref.coverage.returnedReference, null);
	assert.equal(ref.coverage.requestedVerseCount, null);
	assert.equal(ref.coverage.returnedVerseCount, 0);
	assert.equal(ref.coverage.truncated, true);
	assert.match(ref.notice, /Cross-chapter/);
	assert.ok(!lookups.some(row => row.order === 43));
	assert.equal(body.total, 8);
	assert.equal(body.returnedCount, 8);
	assert.equal(body.truncated, false);
	const limited = await call("?reference=Romans+8:28&limit=5");
	assert.equal(limited.body.total, 8);
	assert.equal(limited.body.returnedCount, 5);
	assert.equal(limited.body.truncated, true);
});
