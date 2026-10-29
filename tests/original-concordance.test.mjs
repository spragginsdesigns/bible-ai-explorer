import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stripTypeScriptTypes } from "node:module";

// Candidate-root support exercises an ignored apply-later patch without
// replacing any production file or touching the Git index.
const root = process.cwd();
const candidate = process.env.SUREWORD_CANDIDATE_ROOT || root;
const read = path => readFileSync(resolve(root, path), "utf8");
const source = path => readFileSync(resolve(candidate, path), "utf8");
const queryApi = await import(pathToFileURL(resolve(candidate, "scripts/lib/original-query.mjs")).href);
const helperSource = source("scripts/lib/original-concordance.mjs")
  .replace('"./original-versification.mjs"', JSON.stringify(pathToFileURL(resolve(root, "scripts/lib/original-versification.mjs")).href))
  .replace('"./original-query.mjs"', JSON.stringify(pathToFileURL(resolve(candidate, "scripts/lib/original-query.mjs")).href))
  .replace('"./original-text-normalize.mjs"', JSON.stringify(pathToFileURL(resolve(root, "scripts/lib/original-text-normalize.mjs")).href));
const { buildOriginalConcordance, originalFragmentMatchesQuery } = await import(`data:text/javascript;base64,${Buffer.from(helperSource).toString("base64")}`);
const books = JSON.parse(read("src/data/books.json"));
const cache = new Map();
function corpus(book) {
  if (!cache.has(book)) {
    const meta = books.find(item => item.order === book);
    const original = JSON.parse(read(`src/data/originals/${meta.file}`));
    const kjv = JSON.parse(read(`src/data/kjv/${meta.file}`));
    cache.set(book, { original, kjv, project: buildOriginalConcordance(book, original, kjv) });
  }
  return cache.get(book);
}
const coordinates = rows => rows.map(row => row.kjvBook === null ? null : `${row.kjvBook}:${row.kjvChapter}:${row.kjvVerse}`);

test("embedded Psalm superscriptions never become numbered KJV word occurrences", () => {
  const { project } = corpus(19);
  const title = project(23, 1, { strongs: ["H1732"] });
  assert.deepEqual(coordinates(title), [null]);
  assert.equal(title[0].sourceWordStart, 0); assert.equal(title[0].sourceWordEnd, 2);
  assert.equal(title[0].sourceOnlyReason, "unmapped-source-fragment");
  assert.deepEqual(project(23, 1, { strongs: ["H1732"], mappedOnly: true }), []);
  const body = project(23, 1, { strongs: ["H3068"] });
  assert.deepEqual(coordinates(body), ["19:23:1"]);
  assert.equal(body[0].sourceWordStart, 2);
  assert.equal(body[0].strongs.includes("H1732"), false);
});

test("both halves of Psalm 13 and Isaiah 63 project to their precise KJV targets", () => {
  const psalm = corpus(19).project;
  assert.deepEqual(coordinates(psalm(13, 6, { strongs: ["H7891"] })), ["19:13:6"]);
  assert.deepEqual(coordinates(psalm(13, 6, { strongs: ["H2617"] })), ["19:13:5"]);
  assert.deepEqual(coordinates(psalm(13, 6, { strongs: ["H7891", "H2617"] })), ["19:13:5", "19:13:6"]);
  assert.deepEqual(coordinates(psalm(13, 6, { text: "אשירה" })), ["19:13:6"]);
  const isaiah = corpus(23).project;
  assert.deepEqual(coordinates(isaiah(63, 19, { strongs: ["H8064"] })), ["23:64:1"]);
  assert.deepEqual(coordinates(isaiah(63, 19, { strongs: ["H8034"] })), ["23:63:19"]);
  assert.deepEqual(coordinates(isaiah(63, 19, { text: "שמים" })), ["23:64:1"]);
});

test("the full AND predicate must hold within a fragment, with cross-boundary matches source-only", () => {
  const project = corpus(19).project;
  const crossed = project(23, 1, { strongs: ["H1732"], text: "יהוה" });
  assert.deepEqual(coordinates(crossed), [null]);
  assert.equal(crossed[0].sourceOnlyReason, "query-crosses-fragment-boundary");
  assert.deepEqual(project(23, 1, { strongs: ["H1732"], text: "יהוה", mappedOnly: true }), []);
  assert.deepEqual(coordinates(project(23, 1, { text: "לדוד יהוה" })), [null]);
  assert.equal(originalFragmentMatchesQuery([["א־ב", "H1", ""]], "Hebrew", { text: "א ב" }), true);
  assert.equal(originalFragmentMatchesQuery([["ἀγάπη,", "G26", ""]], "Greek", { text: "αγαπ" }), true);
});

test("source drift at a reviewed boundary fails closed instead of reusing the indexed target", () => {
  const { original, kjv } = corpus(23);
  const changed = structuredClone(original);
  changed[62][18][9][1] = "H0";
  const rows = buildOriginalConcordance(23, changed, kjv)(63, 19, { strongs: ["H8064"] });
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => row.kjvBook === null));
});

test("existing many-source KJV joins and Greek identity remain intact", () => {
  const kings = corpus(11).project(22, 44, { strongs: ["H1116"] });
  assert.deepEqual(coordinates(kings), ["11:22:43"]);
  const { original, project } = corpus(43);
  const row = project(3, 16, { strongs: ["G2316"] })[0];
  assert.equal(row.text, original[2][15].map(word => word[0]).join(" "));
  assert.deepEqual(coordinates([row]), ["43:3:16"]);
});

function compile(path, exports, dependencies) {
  const code = source(path).replace(/await import\("@\/data\/originals\/([^"]+)"\)/g, 'await loadJsonModule("$1")').replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export type \{[^;]+;\s*$/gm, "").replace(/^export\s+/gm, "");
  const injected = { ...queryApi, ...dependencies };
  return new Function(...Object.keys(injected), `${stripTypeScriptTypes(code)}\nreturn { ${exports.join(",")} };`)(...Object.values(injected));
}

test("actual search runner ignores legacy KJV columns, bounds source reads and preserves raw counts", async () => {
  const queries = [];
  const raw = { book: 23, chapter: 63, verse: 19, language: "Hebrew", text: "STALE INDEX TEXT", plain: "", strongs: ["H8064"], kjvBook: 1, kjvChapter: 1, kjvVerse: 1 };
  const Prisma = { sql: (strings, ...values) => ({ strings, values }), join: entries => entries };
  const prisma = { $queryRaw: async (strings, ...values) => { queries.push({ sql: strings.join("?"), values }); return strings.join("").includes("count(*)") ? [{ total: 42 }] : [raw]; } };
  const { searchOriginalVerses } = compile("src/lib/bible/original-search.ts", ["searchOriginalVerses"], {
    Prisma, prisma, getStrongsDictionary: async () => ({}), originalConcordanceRows: async (book, chapter, verse, options) => corpus(book).project(chapter, verse, options),
  });
  const result = await searchOriginalVerses({ strongs: ["H8064"], limit: 1 });
  assert.equal(result.total, 42);
  assert.equal(result.totalScope, "original-edition-verses");
  assert.equal(result.rows.length, 1);
  assert.deepEqual(coordinates(result.rows), ["23:64:1"]);
  assert.equal(result.rows[0].text.includes("STALE"), false);
  assert.equal(queries.length, 2);
  assert.ok(queries[0].sql.includes("LIMIT"));
  assert.ok(queries[0].values.some(value => value >= 1 && value <= 200));
});

test("matchedWordsFor uses the exact projected slice, not superscription words", async () => {
  const code = source("src/lib/ai-tools.ts");
  const start = code.indexOf("async function matchedWordsFor(");
  const end = code.indexOf("\n}", start) + 2;
  const { original } = corpus(19);
  const matchedWordsFor = new Function("getOriginalVerse", "displayOriginal", "hebrewPlainQuery", "greekPlainQuery", "originalSourceTokens", `${stripTypeScriptTypes(code.slice(start, end))}; return matchedWordsFor;`)(
    async (book, chapter, verse) => ({ words: original[chapter - 1][verse - 1].map(([text, strongs, morph]) => ({ text, strongs, morph })) }),
    (language, text) => text, text => text, text => text, queryApi.originalSourceTokens,
  );
  const row = corpus(19).project(23, 1, { strongs: ["H3068"] })[0];
  const words = await matchedWordsFor(row, new Set(["H1732", "H3068"]), []);
  assert.ok(words.some(word => word.strongs === "H3068"));
  assert.equal(words.some(word => word.strongs === "H1732"), false);
  const maqafMatcher = new Function("getOriginalVerse", "displayOriginal", "hebrewPlainQuery", "greekPlainQuery", "originalSourceTokens", `${stripTypeScriptTypes(code.slice(start, end))}; return matchedWordsFor;`)(
    async () => ({ words: [{ text: "א־ב", strongs: "", morph: "" }] }),
    (language, text) => text, text => text.replaceAll("־", " "), text => text, queryApi.originalSourceTokens,
  );
  assert.equal((await maqafMatcher({ book: 1, chapter: 1, verse: 1, language: "Hebrew", sourceWordStart: 0, sourceWordEnd: 1 }, new Set(), ["ב"])).length, 1);
  assert.match(code, /if \(kjvAligned && text\) verses.push/);
  assert.doesNotMatch(code, /text: text \?\? display/);
});

test("actual public Strong's route deduplicates mapped targets and excludes the current KJV target", async () => {
  const example = corpus(19).project(13, 6, { strongs: ["H7891"], mappedOnly: true });
  const NextResponse = { json: (data, init = {}) => new Response(JSON.stringify(data), { ...init, headers: { "Content-Type": "application/json", ...init.headers } }) };
  let searched;
  const { GET } = compile("src/app/api/bible/strongs/route.ts", ["GET"], {
    NextResponse, bookByOrder: book => books.find(item => item.order === book), getKjvChapter: async (book, chapter) => corpus(book).kjv[chapter - 1],
    searchOriginalVerses: async options => { searched = options; return { rows: [...example, ...example], total: 9, totalScope: "original-edition-verses" }; },
    lookupStrongsEntry: async () => ({ lemma: "lemma", translit: "translit", def: "definition", kjv: "sing" }),
    cleanGloss: text => text, bibleVersePlainText: text => text.replace(/<[^>]*>/g, ""),
  });
  const response = await GET(new Request("https://example.invalid/api/bible/strongs?number=H7891&examples=3&alignment=fragments-v1"));
  const payload = await response.json();
  assert.equal(searched.mappedOnly, true);
  assert.equal(payload.occurrences.total, 9);
  assert.equal(payload.occurrences.totalScope, "original-edition-verses");
  assert.deepEqual(payload.occurrences.examples.map(item => item.reference), ["Psalms 13:6"]);
  assert.equal(response.headers.get("X-SureWord-Concordance-Version"), "fragments-v1");
  const excluded = await GET(new Request("https://example.invalid/api/bible/strongs?number=H7891&examples=3&exclude=19:13:6"));
  assert.deepEqual((await excluded.json()).occurrences.examples, []);
});

test("the web reader versions API and in-memory concordance cache keys", () => {
  for (const path of ["src/components/bible/useVerseWords.ts"]) {
    const code = source(path);
    assert.ok(code.includes("alignment=fragments-v1"), path);
    assert.ok(code.includes("fragments-v1|${number}") || code.includes("fragments-v1@\\(number)"), path);
  }
});

test("all 52 embedded-title boundaries retain source identity without false body attribution", () => {
  const { original, project } = corpus(19);
  let titles = 0;
  for (let chapter = 1; chapter <= original.length; chapter++) {
    const words = original[chapter - 1][0];
    const allIds = words.map(word => word[1]).filter(Boolean);
    const fragments = project(chapter, 1, { strongs: allIds });
    const body = fragments.find(row => row.kjvBook === 19 && row.sourceWordStart > 0);
    if (!body) continue;
    titles++;
    const sourceOnly = fragments.find(row => row.kjvBook === null && row.sourceWordStart === 0);
    assert.ok(sourceOnly, `Psalm ${chapter} title stays explicitly original-source only`);
    for (const id of sourceOnly.strongs.filter(id => !body.strongs.includes(id))) {
      assert.deepEqual(project(chapter, 1, { strongs: [id], mappedOnly: true }), []);
    }
  }
  assert.equal(titles, 52);
});

test("every many-source join across the 66-book corpus retains its target", async () => {
  const { alignFromKjv } = await import(pathToFileURL(resolve(root, "scripts/lib/original-versification.mjs")).href);
  const joined = [];
  for (const meta of books) {
    const { original, kjv, project } = corpus(meta.order);
    const inverse = alignFromKjv(meta.order, original.map(chapter => chapter.length), kjv.map(chapter => chapter.length));
    for (let chapter = 1; chapter <= kjv.length; chapter++) for (let verse = 1; verse <= kjv[chapter - 1].length; verse++) {
      const fragments = inverse(chapter, verse);
      if (fragments.length < 2) continue;
      joined.push(`${meta.order}:${chapter}:${verse}`);
      for (const fragment of fragments) {
        const first = original[fragment.chapter - 1][fragment.verse - 1].find(word => word[1]);
        assert.ok(first);
        assert.ok(coordinates(project(fragment.chapter, fragment.verse, { strongs: [first[1]] })).includes(`${meta.order}:${chapter}:${verse}`));
      }
    }
  }
  assert.deepEqual(joined, ["4:26:1", "9:20:42", "11:22:43", "13:12:4"]);
});

test("search runner empty and stale-candidate pages retain explicit source-index count scope", async () => {
  let queries = 0;
  const Prisma = { sql: (strings, ...values) => ({ strings, values }), join: entries => entries };
  const { searchOriginalVerses } = compile("src/lib/bible/original-search.ts", ["searchOriginalVerses"], {
    Prisma, prisma: { $queryRaw: async strings => { queries++; return strings.join("").includes("count(*)") ? [{ total: 7 }] : [{ book: 19, chapter: 23, verse: 1 }]; } },
    getStrongsDictionary: async () => ({}), originalConcordanceRows: async (book, chapter, verse, options) => corpus(book).project(chapter, verse, options),
  });
  assert.deepEqual(await searchOriginalVerses({ limit: 8 }), { rows: [], total: 0, totalScope: "original-edition-verses" });
  assert.equal(queries, 0);
  assert.deepEqual(await searchOriginalVerses({ strongs: ["H1732"], mappedOnly: true, limit: 8 }), { rows: [], total: 7, totalScope: "original-edition-verses" });
  assert.equal(queries, 2);
});

async function originalLanguageTools(rowsFor, translation = "KJV") {
  const { z } = await import("zod");
  const { alignFromKjv, originalFragmentMatchesSource } = await import(pathToFileURL(resolve(root, "scripts/lib/original-versification.mjs")).href);
  const { stripCantillation } = await import(pathToFileURL(resolve(root, "src/lib/bible/original-text.ts")).href);
  const originals = compile("src/lib/bible/originals.ts", ["getOriginalVerse", "lookupStrongsEntry", "originalConcordanceRows"], {
    loadJsonModule: async name => ({ default: JSON.parse(read(`src/data/originals/${name}`)) }),
    getKjvBook: async book => corpus(book).kjv, alignFromKjv, originalFragmentMatchesSource, buildOriginalConcordance,
  });
  const normalization = compile("src/lib/bible/original-search.ts", ["normalizeStrongsNumber", "detectScript", "hebrewPlainQuery", "greekPlainQuery"], {});
  const { buildSureWordTools } = compile("src/lib/ai-tools.ts", ["buildSureWordTools"], {
    ...originals, ...normalization, stripCantillation, z, tool: value => value,
    getKjvBookName: order => books.find(book => book.order === order)?.name,
    getKjvBookNumber: name => books.find(book => book.name === name)?.order,
    getVerseText: async (edition, book, chapter, verse) => {
      assert.equal(edition, translation);
      return corpus(book).kjv[chapter - 1][verse - 1];
    },
    searchOriginalVerses: async options => ({ rows: await rowsFor(options, originals.originalConcordanceRows), total: 17, totalScope: "original-edition-verses" }),
    READING_PLAN_PRESETS: [], ATLAS_ERAS: [], HIGHLIGHT_COLORS: [],
    MIN_PLAN_DAYS: 1, MAX_PLAN_DAYS: 100, MAX_HIGHLIGHT_VERSES: 30,
    MAX_ORGANIZE_NAME_LENGTH: 100, MAX_ORGANIZE_TAGS: 10, NOTE_HOUSE_STYLE: "",
    ...Object.fromEntries(["buildMemoryTools", "buildOnboardingTools", "buildServeTools", "buildStudyTools", "buildActionTools", "buildReadingTools"].map(name => [name, () => ({})])),
  });
  return buildSureWordTools({ userId: "concordance-corpus-fixture", translation });
}

test("actual searchOriginalLanguage keeps title-only evidence separate from numbered KJV quotations", async () => {
  const tools = await originalLanguageTools(async (options, project) => [
    ...await project(19, 23, 1, options),
    ...await project(19, 18, 51, options),
  ]);
  const result = await tools.searchOriginalLanguage.execute({ strongs: "H1732", book: "Psalms" });
  assert.equal(result.total, 17);
  assert.equal(result.totalScope, "original-edition-verses");
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].kjvAligned, false);
  assert.equal(result.matches[0].sourceOnlyReason, "unmapped-source-fragment");
  assert.equal(result.matches[0].sourceIdentifier, "WLC 23:1");
  assert.deepEqual([result.matches[0].sourceWordStart, result.matches[0].sourceWordEnd], [0, 2]);
  assert.ok(result.matches[0].matchedWords.some(word => word.strongs === "H1732"));
  assert.equal(result.matches[0].matchedWords.some(word => word.strongs === "H3068"), false);
  assert.equal(result.matches[1].kjvAligned, true);
  assert.deepEqual(result.verses.map(verse => verse.reference), ["Psalms 18:50"]);
  assert.equal(result.verses[0].text, corpus(19).kjv[17][49]);
  const blocks = result.formatted.split("\n\n");
  assert.doesNotMatch(blocks[1], /KJV: "/);
  assert.match(blocks[1], /no numbered KJV target/);
  assert.ok(blocks[2].includes(`KJV: "${corpus(19).kjv[17][49]}"`));
  assert.doesNotMatch(result.formatted, /The LORD is my shepherd/);
});

for (const fixture of [
  { book: 19, chapter: 13, verse: 6, strongs: "H7891", reference: "Psalms 13:6", start: 6, end: 11 },
  { book: 19, chapter: 13, verse: 6, strongs: "H2617", reference: "Psalms 13:5", start: 0, end: 6 },
  { book: 23, chapter: 63, verse: 19, strongs: "H8064", reference: "Isaiah 64:1", start: 9, end: 16 },
  { book: 23, chapter: 63, verse: 19, strongs: "H8034", reference: "Isaiah 63:19", start: 0, end: 9 },
]) {
  test(`actual searchOriginalLanguage quotes the selected ${fixture.reference} fragment`, async () => {
    const tools = await originalLanguageTools(async (options, project) => project(fixture.book, fixture.chapter, fixture.verse, options));
    const result = await tools.searchOriginalLanguage.execute({ strongs: fixture.strongs });
    assert.deepEqual(result.verses.map(verse => verse.reference), [fixture.reference]);
    assert.equal(result.matches[0].reference, fixture.reference);
    assert.equal(result.matches[0].sourceWordStart, fixture.start);
    assert.equal(result.matches[0].sourceWordEnd, fixture.end);
    assert.ok(result.matches[0].matchedWords.some(word => word.strongs === fixture.strongs));
    assert.ok(result.formatted.includes(`KJV: "${result.verses[0].text}"`));
  });
}

test("actual searchOriginalLanguage discloses a conjunction spanning title and body without an English card", async () => {
  const tools = await originalLanguageTools(async (options, project) => project(19, 23, 1, options));
  const result = await tools.searchOriginalLanguage.execute({ strongs: "H1732", word: "יהוה" });
  assert.deepEqual(result.verses, []);
  assert.equal(result.matches[0].kjvAligned, false);
  assert.equal(result.matches[0].sourceOnlyReason, "query-crosses-fragment-boundary");
  assert.match(result.formatted, /full query spans source fragments/);
  assert.doesNotMatch(result.formatted, /KJV: "/);
});


for (const fixture of [
  { book: 43, chapter: 3, verse: 16, words: ["θεός,", "“θεός”", "θεός."], target: "John 3:16", strongs: "G2316" },
  { book: 19, chapter: 23, verse: 1, words: ["יְהוָה,", "“יְהוָה”", "יְהוָה."], target: "Psalms 23:1", strongs: "H3068" },
]) {
  test(`actual original-word tool preserves punctuation-wrapped ${fixture.target} matches and highlights`, async () => {
    const tools = await originalLanguageTools(async (options, project) => project(fixture.book, fixture.chapter, fixture.verse, options));
    for (const word of fixture.words) {
      const result = await tools.searchOriginalLanguage.execute({ word });
      assert.deepEqual(result.verses.map(verse => verse.reference), [fixture.target]);
      assert.ok(result.matches[0].matchedWords.some(match => match.strongs === fixture.strongs), word);
    }
  });
}

test("punctuation normalization cannot weaken a cross-fragment Strong-plus-word conjunction", async () => {
  const tools = await originalLanguageTools(async (options, project) => project(19, 23, 1, options));
  const result = await tools.searchOriginalLanguage.execute({ strongs: "H1732", word: "“יְהוָה,”" });
  assert.deepEqual(result.verses, []);
  assert.equal(result.matches[0].sourceOnlyReason, "query-crosses-fragment-boundary");
  assert.equal(originalFragmentMatchesQuery([["א", "H1", ""]], "Hebrew", { strongs: ["H1"], text: "!!!" }), false);
  assert.equal(originalFragmentMatchesQuery([["א", "H1", ""]], "Hebrew", { strongs: ["H1"], text: "\uFE0F" }), false);
  assert.equal(originalFragmentMatchesQuery([["א", "H1", ""]], "Hebrew", { strongs: ["H2", "H1"] }), true);
});

test("actual SQL runner and projection consume the same punctuated query clauses", async () => {
  const calls = [];
  const Prisma = { sql: (strings, ...values) => ({ strings, values }), join: entries => entries };
  const { searchOriginalVerses } = compile("src/lib/bible/original-search.ts", ["searchOriginalVerses"], {
    Prisma,
    prisma: { $queryRaw: async (strings, ...values) => {
      calls.push({ sql: strings.join("?"), values });
      return strings.join("").includes("count(*)") ? [{ total: 1 }] : [{ book: 43, chapter: 3, verse: 16, text: "STALE", kjvBook: 1, kjvChapter: 1, kjvVerse: 1 }];
    } },
    getStrongsDictionary: async () => ({}),
    originalConcordanceRows: async (book, chapter, verse, options) => corpus(book).project(chapter, verse, options),
  });
  const result = await searchOriginalVerses({ text: "“θεος,”", limit: 5 });
  assert.deepEqual(coordinates(result.rows), ["43:3:16"]);
  assert.equal(result.rows[0].text.includes("STALE"), false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].values[0][0].values, ["'θεος':*"]);
  calls.length = 0;
  assert.deepEqual(await searchOriginalVerses({ strongs: ["G2316"], text: "!!!", limit: 5 }), { rows: [], total: 0, totalScope: "original-edition-verses" });
  assert.equal(calls.length, 0, "a wordless explicit text predicate cannot degrade to a Strong-only search");
});

test("internal punctuation does not discard adjacency in an actual Greek source verse", () => {
  const project = corpus(43).project;
  assert.deepEqual(coordinates(project(3, 16, { text: "θεος,τον" })), ["43:3:16"]);
  assert.deepEqual(project(3, 16, { text: "θεος,κοσμον" }), [], "both words exist, but they are not adjacent");
});

test("explicit empty text cannot become a Strong-only fragment match", () => {
  assert.equal(originalFragmentMatchesQuery([["א", "H1", ""]], "Hebrew", { strongs: ["H1"], text: "" }), false);
  assert.deepEqual(corpus(19).project(23, 1, { strongs: ["H3068"], text: "" }), []);
  assert.deepEqual(coordinates(corpus(19).project(23, 1, { strongs: ["H3068"] })), ["19:23:1"]);
});

test("SQL runner rejects explicit empty text before any Strong-only query", async () => {
  let queries = 0;
  const Prisma = { sql: (strings, ...values) => ({ strings, values }), join: entries => entries };
  const { searchOriginalVerses } = compile("src/lib/bible/original-search.ts", ["searchOriginalVerses"], {
    Prisma,
    prisma: { $queryRaw: async strings => {
      queries++;
      return strings.join("").includes("count(*)") ? [{ total: 1 }] : [{ book: 43, chapter: 3, verse: 16 }];
    } },
    getStrongsDictionary: async () => ({}),
    originalConcordanceRows: async (book, chapter, verse, options) => corpus(book).project(chapter, verse, options),
  });
  assert.deepEqual(await searchOriginalVerses({ strongs: ["G2316"], text: "", limit: 5 }), { rows: [], total: 0, totalScope: "original-edition-verses" });
  assert.equal(queries, 0);
});

test("marks-only original-script input keeps empty text intent while Latin plus Strong stays unchanged", async () => {
  const searched = [];
  const tools = await originalLanguageTools(async (options, project) => {
    searched.push(options);
    return project(19, 23, 1, options);
  });
  const rejected = await tools.searchOriginalLanguage.execute({ strongs: "H3068", word: "\u05B0" });
  assert.equal(Object.hasOwn(searched[0], "text"), true);
  assert.equal(searched[0].text, "");
  assert.deepEqual(rejected.matches, []);
  assert.deepEqual(rejected.verses, []);
  const retained = await tools.searchOriginalLanguage.execute({ strongs: "H3068", word: "Yahweh" });
  assert.equal(Object.hasOwn(searched[1], "text"), false);
  assert.deepEqual(retained.verses.map(verse => verse.reference), ["Psalms 23:1"]);
});
