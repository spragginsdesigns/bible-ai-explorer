import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

import { alignFromKjv, originalFragmentMatchesSource } from "../scripts/lib/original-versification.mjs";

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
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export\s+/gm, "");
	const factory = new Function(
		"loadJsonModule", "getKjvBook", "alignFromKjv", "originalFragmentMatchesSource",
		`${stripTypeScriptTypes(source)}\nreturn { getOriginalVerse, getOriginalVerseForKjv, lookupStrongsEntry };`
	);
	const kjvCache = new Map();
	const getKjvBook = async (order) => {
		if (!kjvCache.has(order)) {
			const book = bookByOrder(order);
			kjvCache.set(order, JSON.parse(read(`../src/data/kjv/${book.file}`)));
		}
		return kjvCache.get(order);
	};
	return factory(loadJsonModule, getKjvBook, alignFromKjv, originalFragmentMatchesSource);
}

const { getOriginalVerse, getOriginalVerseForKjv, lookupStrongsEntry } = loadOriginals();

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
	getOriginalVerseForKjv,
});
import { cleanGloss } from "../src/lib/bible/original-text.ts";

// The occurrence lookup rides the OriginalVerse index in Neon; the fake below
// stands in for it so the route's shaping and its exclude rule can be asserted.
const fakeIndexRows = [
	{ kjvBook: 21, kjvChapter: 4, kjvVerse: 6 },
	{ kjvBook: 23, kjvChapter: 30, kjvVerse: 15 },
	{ kjvBook: 21, kjvChapter: 9, kjvVerse: 17 },
	{ kjvBook: 20, kjvChapter: 29, kjvVerse: 9 },
	{ kjvBook: 19, kjvChapter: 1, kjvVerse: null },
];
const searchOriginalVerses = async ({ strongs, limit }) => ({
	rows: fakeIndexRows.slice(0, limit),
	total: strongs[0] === "H5183" ? 7 : 0,
});
const getKjvChapter = async (book, chapter) => {
	const verses = [];
	verses[14] = "In returning and rest shall ye be saved";
	verses[16] = "The words of wise men are heard in quiet";
	verses[8] = "there is no rest";
	verses[5] = "Better is an handful with quietness";
	return verses;
};
const bibleVersePlainText = (markup) => markup;

const strongsRoute = loadRoute("../src/app/api/bible/strongs/route.ts", {
	NextResponse,
	bookByOrder,
	getKjvChapter,
	searchOriginalVerses,
	lookupStrongsEntry,
	cleanGloss,
	bibleVersePlainText,
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

test("Strong's glosses lose their [idiom] markers", async () => {
	const body = await (await callStrongs("?number=H4393")).json();
	assert.doesNotMatch(body.kjv, /\[idiom\]/);
	assert.match(body.kjv, /^all along, all that is/);
});

test("examples= adds occurrences, skipping the excluded verse and unaligned rows", async () => {
	const response = await callStrongs("?number=H5183&examples=3&exclude=21:4:6");
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.occurrences.total, 7);
	assert.deepEqual(
		body.occurrences.examples.map((example) => example.reference),
		["Isaiah 30:15", "Ecclesiastes 9:17", "Proverbs 29:9"]
	);
	assert.equal(body.occurrences.examples[0].text, "In returning and rest shall ye be saved");

	const plain = await (await callStrongs("?number=H5183")).json();
	assert.equal(plain.occurrences, undefined);
});

test("a bad examples= count is rejected", async () => {
	for (const query of ["?number=H5183&examples=0", "?number=H5183&examples=9", "?number=H5183&examples=two"]) {
		assert.equal((await callStrongs(query)).status, 400, `${query} must be rejected`);
	}
});

test("an unknown but well-formed Strong's number is a 404", async () => {
	const response = await callStrongs("?number=H99999");
	assert.equal(response.status, 404);
	assert.deepEqual(await response.json(), { error: "not_found" });
});


test("KJV Psalm requests return the verse words, excluding the numbered WLC titles", async () => {
	for (const [chapter, sourceVerse, firstStrongs] of [[3, 2, "H3068"], [51, 3, "H2603"]]) {
		const body = await (await callOriginal(`?book=19&chapter=${chapter}&verse=1`)).json();
		assert.equal(body.words[0].strongs, firstStrongs);
		assert.deepEqual(body.requestedReference, { book: 19, chapter, verse: 1, versification: "KJV" });
		assert.equal(body.sourceVersification, "WLC");
		assert.deepEqual(body.sourceReferences, [{ book: 19, chapter, verse: sourceVerse }]);
		const raw = await getOriginalVerse(19, chapter, sourceVerse);
		assert.deepEqual(body.words, raw.words);
	}
	const rawTitle = await getOriginalVerse(19, 51, 1);
	assert.equal(rawTitle.words[0].strongs, "H5329", "raw search-index access retains the title");
});

test("Joel 3:1 uses WLC chapter 4, while the Spirit promise uses KJV 2:28", async () => {
	const restored = await (await callOriginal("?book=29&chapter=3&verse=1")).json();
	assert.deepEqual(restored.sourceReferences, [{ book: 29, chapter: 4, verse: 1 }]);
	assert.ok(restored.words.some((word) => word.strongs === "H3063"), "Judah belongs to the restoration verse");
	assert.ok(!restored.words.some((word) => word.strongs === "H7307"), "Spirit belongs to 2:28");
	const poured = await getOriginalVerseForKjv(29, 2, 28);
	assert.deepEqual(poured.sourceReferences, [{ book: 29, chapter: 3, verse: 1 }]);
	assert.ok(poured.words.some((word) => word.strongs === "H7307"));
});

test("every source in a many-to-one join is returned in order", async () => {
	const joins = [
		[4, 26, 1, [[25, 19], [26, 1]]],
		[9, 20, 42, [[20, 42], [21, 1]]],
		[11, 22, 43, [[22, 43], [22, 44]]],
		[13, 12, 4, [[12, 4], [12, 5]]],
	];
	for (const [book, chapter, verse, sources] of joins) {
		const original = await getOriginalVerseForKjv(book, chapter, verse);
		assert.deepEqual(original.sourceReferences, sources.map(([chapter, verse]) => ({ book, chapter, verse })));
		const raw = await Promise.all(sources.map(([chapter, verse]) => getOriginalVerse(book, chapter, verse)));
		assert.deepEqual(original.words, raw.flatMap((entry) => entry.words));
	}
	const kings = await getOriginalVerseForKjv(11, 22, 43);
	assert.ok(kings.words.some((word) => word.strongs === "H1116"), "the joined clause about high places must be present");
});

test("Isaiah's shared source verse is sliced at the actual clause boundary", async () => {
	const previous = await getOriginalVerseForKjv(23, 63, 19);
	const heavens = await getOriginalVerseForKjv(23, 64, 1);
	const source = await getOriginalVerse(23, 63, 19);
	assert.deepEqual(previous.sourceReferences, [{ book: 23, chapter: 63, verse: 19, wordStart: 0, wordEnd: 9 }]);
	assert.deepEqual(heavens.sourceReferences, [{ book: 23, chapter: 63, verse: 19, wordStart: 9 }]);
	assert.deepEqual(previous.words, source.words.slice(0, 9));
	assert.deepEqual(heavens.words, source.words.slice(9));
	assert.deepEqual(heavens.words.slice(0, 3).map((word) => word.strongs), ["H3863", "H7167", "H8064"]);
	assert.ok(!previous.words.some((word) => word.strongs === "H8064"));
	assert.deepEqual([...previous.words, ...heavens.words], source.words, "every source word appears once across the split");
});

test("a KJV verse absent from WLC fails closed, as do invalid or source-only coordinates", async () => {
	const omitted = await callOriginal("?book=16&chapter=7&verse=68");
	assert.equal(omitted.status, 404);
	assert.deepEqual(await omitted.json(), { error: "not_found" });
	const next = await getOriginalVerseForKjv(16, 7, 69);
	assert.deepEqual(next.sourceReferences, [{ book: 16, chapter: 7, verse: 68 }]);
	for (const reference of [[29, 4, 1], [19, 3, 9], [67, 1, 1], [1, 1.5, 1], [1, 1, NaN]]) {
		assert.equal(await getOriginalVerseForKjv(...reference), null);
	}
});

test("Greek KJV lookup is byte-for-byte identical to raw TR lookup", async () => {
	const original = await getOriginalVerseForKjv(43, 3, 16);
	assert.deepEqual(original.words, (await getOriginalVerse(43, 3, 16)).words);
	assert.equal(original.sourceVersification, "TR");
	assert.deepEqual(original.sourceReferences, [{ book: 43, chapter: 3, verse: 16 }]);
});


test("all 31,101 available KJV lookups return exactly their source fragments", async () => {
	let covered = 0;
	for (const book of books) {
		const chapters = JSON.parse(read(`../src/data/kjv/${book.file}`));
		for (let chapter = 1; chapter <= chapters.length; chapter++) {
			for (let verse = 1; verse <= chapters[chapter - 1].length; verse++) {
				const original = await getOriginalVerseForKjv(book.order, chapter, verse);
				if (book.order === 16 && chapter === 7 && verse === 68) {
					assert.equal(original, null);
					continue;
				}
				assert.ok(original, `${book.name} ${chapter}:${verse} missing`);
				const expected = [];
				for (const source of original.sourceReferences) {
					const raw = await getOriginalVerse(book.order, source.chapter, source.verse);
					expected.push(...raw.words.slice(source.wordStart ?? 0, source.wordEnd ?? raw.words.length));
				}
				assert.deepEqual(original.words, expected, `${book.name} ${chapter}:${verse} lost words`);
				assert.deepEqual(original.requestedReference, { book: book.order, chapter, verse, versification: "KJV" });
				covered++;
			}
		}
	}
	assert.equal(covered, 31101);
});

test("an altered Isaiah source boundary fails closed for both KJV fragments", async () => {
	const source = (await loadJsonModule("23-isaiah.json")).default[62][18];
	const originalNumber = source[9][1];
	try {
		source[9][1] = "H99999";
		assert.equal(await getOriginalVerseForKjv(23, 63, 19), null);
		assert.equal(await getOriginalVerseForKjv(23, 64, 1), null);
	} finally {
		source[9][1] = originalNumber;
	}
});


// Independently reviewed body boundaries: offset, first two body Strong's IDs,
// and the KJV opening they represent. Tests assert these concrete words rather
// than deriving expected offsets by round-tripping the production map.
const EMBEDDED_PSALM_BODIES = {
  11: [2, "H3068 H2620", "In the LORD"],
  14: [2, "H559 H5036", "The fool hath said"],
  15: [2, "H3068 H4310", "LORD, who"],
  16: [2, "H8104 H410", "Preserve me, O God"],
  17: [2, "H8085 H3068", "Hear the right, O LORD"],
  23: [2, "H3068 H7462", "The LORD is my shepherd"],
  24: [2, "H3068 H776", "The earth is the LORD"],
  25: [1, "H413 H3068", "Unto thee, O LORD"],
  26: [1, "H8199 H3068", "Judge me, O LORD"],
  27: [1, "H3068 H216", "The LORD is my light"],
  28: [1, "H413 H3068", "Unto thee will I cry, O LORD"],
  29: [2, "H3051 H3068", "Give unto the LORD"],
  32: [2, "H835 H5375", "Blessed is he whose transgression is forgiven"],
  35: [1, "H7378 H3068", "Plead my cause, O LORD"],
  37: [1, "H408 H2734", "Fret not thyself"],
  50: [2, "H410 H430", "The mighty God"],
  66: [3, "H7321 H430", "Make a joyful noise unto God"],
  72: [1, "H430 H4941", "Give the king thy judgments, O God"],
  73: [2, "H389 H2896", "Truly God is good"],
  74: [2, "H4100 H430", "O God, why"],
  78: [2, "H238 H5971", "Give ear, O my people"],
  79: [2, "H430 H935", "O God, the heathen are come"],
  82: [2, "H430 H5324", "God standeth"],
  86: [2, "H5186 H3068", "Bow down thine ear, O LORD"],
  90: [4, "H136 H4583", "Lord, thou hast been our dwelling place"],
  98: [1, "H7891 H3068", "O sing unto the LORD"],
  100: [2, "H7321 H3068", "Make a joyful noise unto the LORD"],
  101: [2, "H2617 H4941", "I will sing of mercy and judgment"],
  103: [1, "H1288 H5315", "Bless the LORD, O my soul"],
  109: [3, "H430 H8416", "Hold not thy peace, O God of my praise"],
  110: [2, "H5002 H3068", "The LORD said"],
  120: [2, "H413 H3068", "In my distress I cried unto the LORD"],
  121: [2, "H5375 H5869", "I will lift up mine eyes"],
  122: [3, "H8055 H559", "I was glad when they said"],
  123: [2, "H413 H5375", "Unto thee lift I up mine eyes"],
  124: [3, "H3884 H3068", "If it had not been the LORD"],
  125: [2, "H982 H3068", "They that trust in the LORD"],
  126: [2, "H7725 H3068", "When the LORD turned again"],
  127: [3, "H518 H3068", "Except the LORD"],
  128: [2, "H835 H3605", "Blessed is every one"],
  129: [2, "H7227 H6887", "Many a time have they afflicted me"],
  130: [2, "H4615 H7121", "Out of the depths have I cried"],
  131: [3, "H3068 H3808", "LORD, my heart is not haughty"],
  132: [2, "H2142 H3068", "LORD, remember David"],
  133: [3, "H2009 H4100", "Behold, how good"],
  134: [2, "H2009 H1288", "Behold, bless ye the LORD"],
  138: [1, "H3034 H3605", "I will praise thee with my whole heart"],
  139: [3, "H3068 H2713", "O LORD, thou hast searched me"],
  141: [2, "H3068 H7121", "LORD, I cry unto thee"],
  143: [2, "H3068 H8085", "Hear my prayer, O LORD"],
  144: [1, "H1288 H3068", "Blessed be the LORD"],
  145: [2, "H7311 H433", "I will extol thee, my God"],
};

test("all 52 embedded Psalm titles are excluded at reviewed Hebrew body boundaries", async () => {
  const kjv = JSON.parse(read("../src/data/kjv/19-psalms.json"));
  assert.equal(Object.keys(EMBEDDED_PSALM_BODIES).length, 52);
  for (const [psalm, [wordStart, firstIds, kjvOpening]] of Object.entries(EMBEDDED_PSALM_BODIES)) {
    const chapter = Number(psalm);
    const body = await getOriginalVerseForKjv(19, chapter, 1);
    const raw = await getOriginalVerse(19, chapter, 1);
    assert.ok(kjv[chapter - 1][0].startsWith(kjvOpening), `Psalm ${chapter} KJV opening`);
    assert.deepEqual(body.words.slice(0, 2).map((word) => word.strongs), firstIds.split(" "), `Psalm ${chapter} body boundary`);
    assert.deepEqual(body.sourceReferences, [{ book: 19, chapter, verse: 1, wordStart }]);
    assert.deepEqual(body.words, raw.words.slice(wordStart));
    assert.equal(raw.words.length - body.words.length, wordStart, `Psalm ${chapter} title stays in raw source`);
  }
  // Independent inventory guard: these are all equal-count first verses
  // beginning with the attested superscription categories in the corpus.
  const source = (await loadJsonModule("19-psalms.json")).default;
  const headings = new Set(["H5329", "H1732", "H4210", "H4905", "H8605", "H8416", "H7919", "H7892", "H4387", "H8010"]);
  const candidates = source.flatMap((chapter, index) =>
    chapter.length === kjv[index].length && headings.has(chapter[0][0][1]) ? [index + 1] : []);
  assert.deepEqual(candidates, [...Object.keys(EMBEDDED_PSALM_BODIES).map(Number), 13].sort((a, b) => a - b));
});

test("Psalm 13 shifts its numbered body and splits its final WLC verse into KJV 5 and 6", async () => {
  const expected = [
    [2, ["H5704", "H575", "H3068"], undefined, undefined],
    [3, ["H5704", "H575", "H7896"], undefined, undefined],
    [4, ["H5027", "H6030", "H3068"], undefined, undefined],
    [5, ["H6435", "H559", "H341"], undefined, undefined],
    [6, ["H589", "H2617", "H982"], 0, 6],
    [6, ["H7891", "H3068", "H3588"], 6, undefined],
  ];
  for (const [index, [sourceVerse, ids, start, end]] of expected.entries()) {
    const body = await getOriginalVerseForKjv(19, 13, index + 1);
    assert.deepEqual(body.words.slice(0, 3).map((word) => word.strongs), ids);
    assert.deepEqual(body.sourceReferences, [{ book: 19, chapter: 13, verse: sourceVerse,
      ...(start !== undefined ? { wordStart: start } : {}), ...(end !== undefined ? { wordEnd: end } : {}) }]);
  }
  const last = await getOriginalVerse(19, 13, 6);
  assert.deepEqual((await getOriginalVerseForKjv(19, 13, 5)).words.map((word) => word.strongs), ["H589", "H2617", "H982", "H1523", "H3820", "H3444"]);
  assert.deepEqual((await getOriginalVerseForKjv(19, 13, 6)).words.map((word) => word.strongs), ["H7891", "H3068", "H3588", "H1580", "H5921"]);
  assert.equal(last.words.length, 11);
});

test("numbered Psalm praise openings remain body words", async () => {
  for (const chapter of [106, 111, 112, 113, 135, 146, 147, 148, 149, 150]) {
    const body = await getOriginalVerseForKjv(19, chapter, 1);
    assert.equal(body.words[0].strongs, "H1984");
    assert.deepEqual(body.words, (await getOriginalVerse(19, chapter, 1)).words);
  }
});

test("a changed Psalm title boundary fails closed", async () => {
  const source = (await loadJsonModule("19-psalms.json")).default[89][0];
  const saved = source[4][1];
  try {
    source[4][1] = "H99999";
    assert.equal(await getOriginalVerseForKjv(19, 90, 1), null);
  } finally {
    source[4][1] = saved;
  }
});
