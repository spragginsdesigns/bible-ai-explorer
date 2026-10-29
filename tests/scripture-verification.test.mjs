import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { alignFromKjv, originalFragmentMatchesSource } from "../scripts/lib/original-versification.mjs";

const books = JSON.parse(readFileSync(new URL("../src/data/books.json", import.meta.url), "utf8"));
const names = JSON.parse(readFileSync(new URL("../src/data/book-names.json", import.meta.url), "utf8"));
const localized = ["es", "de"].flatMap((language) => [
  ...names[language].names.map((name, index) => [name, index + 1]),
  ...Object.entries(names[language].aliases),
]);
const source = readFileSync(new URL("../src/lib/ai/scripture-verification.ts", import.meta.url), "utf8")
  .replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
const factory = new Function("BOOKS", "LOCALIZED_BOOK_NAMES", "getChapter", "isTranslationId", "getOriginalVerse", "getOriginalVerseForKjv", `${stripTypeScriptTypes(source)}\nreturn { verifyScriptureDraft, SCRIPTURE_VERIFICATION_LIMITS };`);
const bundled = new Map();
async function loadChapter(translation, order, chapter) {
  assert.equal(translation, "KJV");
  const book = books.find((book) => book.order === order);
  if (!bundled.has(order)) bundled.set(order, JSON.parse(readFileSync(new URL(`../src/data/kjv/${book.file}`, import.meta.url), "utf8")));
  const verses = bundled.get(order)[chapter - 1];
  if (!verses) throw new Error("missing canonical chapter");
  return verses;
}
const originalJson = new Map();
const originalSource = readFileSync(new URL("../src/lib/bible/originals.ts", import.meta.url), "utf8")
  .replace(/await import\("@\/data\/originals\/([^"]+)"\)/g, 'await loadJsonModule("$1")')
  .replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
const originalFactory = new Function("loadJsonModule", "getKjvBook", "alignFromKjv", "originalFragmentMatchesSource", `${stripTypeScriptTypes(originalSource)}\nreturn { getOriginalVerse, getOriginalVerseForKjv };`);
const originals = originalFactory(async (filename) => {
  if (!originalJson.has(filename)) originalJson.set(filename, JSON.parse(readFileSync(new URL(`../src/data/originals/${filename}`, import.meta.url), "utf8")));
  return { default: originalJson.get(filename) };
}, async (order) => {
  await loadChapter("KJV", order, 1);
  return bundled.get(order);
}, alignFromKjv, originalFragmentMatchesSource);
const makeVerifier = (getChapter = loadChapter, originalApi = originals) => factory(books, localized, getChapter, (translation) => ["KJV", "NKJV", "BSB", "ASV", "RV1909", "LUT1912"].includes(translation), originalApi.getOriginalVerse, originalApi.getOriginalVerseForKjv);
const { verifyScriptureDraft: verify } = makeVerifier();
const check = (text, options = {}) => verify(text, { translation: "KJV", ...options });
const john316 = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
const john317 = "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.";
const psalm231 = "The LORD is my shepherd; I shall not want.";

test("exact Scripture comes from canonical chapter evidence", async () => {
  const result = await check(`“${john316}” (John 3:16).`);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.references[0].canonicalText, john316);
  assert.equal(result.references[0].verses[0].order, 43);
  assert.equal(result.quotes[0].status, "verified");
});

test("fabricated prosperity text cannot borrow John 3:16", async () => {
  const result = await check('John 3:16 says, “God promises every faithful Christian wealth and financial success.”');
  assert.equal(result.ok, false);
  assert.equal(result.quotes[0].status, "failed");
  assert.ok(result.issues.some((issue) => issue.code === "quote_mismatch"));
});

test("quotation checking preserves source capitalization including the LORD", async () => {
  const result = await check('“The Lord is my shepherd; I shall not want.” (Psalm 23:1)');
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'quote_mismatch'));
});

test("invisible controls cannot disguise a Scripture citation", async () => {
  for (const control of [0x00ad,0x061c,0x180e,0x200b,0x200f,0x202e,0x2060,0xfeff]) {
    const result=await check(`A claim (J${String.fromCodePoint(control)}ohn 3:16).`);
    assert.equal(result.ok,false);
    assert.ok(result.issues.some(issue=>issue.code==='invalid_reference'));
  }
});

test("valid citation coordinates alone do not certify a claim or speaker", async () => {
  const result = await check("Moses wrote these words in John 3:16.");
  assert.equal(result.ok, true);
  assert.equal(result.references[0].canonicalText, john316);
  assert.equal(result.quotes.length, 0, "semantic/speaker claims must still be checked independently");
});

test("grouped verses each have canonical evidence", async () => {
  const result = await check("Compare John 1:1,14 and John 3:16,18-19.");
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.references.map((reference) => reference.reference), ["John 1:1", "John 1:14", "John 3:16", "John 3:18-19"]);
  assert.deepEqual(result.references.map((reference) => reference.verses.length), [1, 1, 1, 2]);
});

test("inherited semicolon chapter references retain the book", async () => {
  const result = await check("Read John 3:16; 4:1,3; 5:24.");
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.references.map((reference) => reference.reference), ["John 3:16", "John 4:1", "John 4:3", "John 5:24"]);
});

test("cross chapter ranges use actual canonical verse counts", async () => {
  const result = await check("John 3:35–4:2");
  assert.equal(result.ok, true);
  assert.deepEqual(result.references[0].verses.map((verse) => `${verse.chapter}:${verse.verse}`), ["3:35", "3:36", "4:1", "4:2"]);
});

test("chapter references and chapter ranges are fully loaded", async () => {
  const result = await check("Read Psalm 117-118.");
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.references[0].verses.length, 31);
  assert.equal(result.references[0].verses[0].chapter, 117);
  assert.equal(result.references[0].verses.at(-1).chapter, 118);
});

test("numbered books, aliases, abbreviated periods, and Roman volumes resolve", async () => {
  const result = await check("1Jn 1:9; II Timothy 3:16; Gen.1:1; Mk 1:1; Song of Songs 2:1; Rev. 22:21.");
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.references.map((reference) => reference.reference), ["1 John 1:9", "2 Timothy 3:16", "Genesis 1:1", "Mark 1:1", "Song of Solomon 2:1", "Revelation 22:21"]);
});

test("Spanish/German names and accents use the same canonical book coordinates", async () => {
  const result = await check("Juan 3:16; 1. Mose 1:1; Römer 8:28; Isaias 53:5; 1 Juan 1:9.");
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.references.map((reference) => reference.verses[0].order), [43, 1, 45, 23, 62]);
});

test("Markdown links, emphasis, and Unicode punctuation do not hide citations", async () => {
  const result = await check(`**Psalm 23:1** — “${psalm231}”\n\n[John 3:16](https://example.com) and John 3:35−4:2.`);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.references.length, 3);
  const fullwidth = await check("John ３：１６; ４：１ and John 3:35‑4:2");
  assert.equal(fullwidth.ok, true, JSON.stringify(fullwidth.issues));
  assert.equal(fullwidth.references.length, 3);
  assert.equal((await check("John ３：９９９")).ok, false);
  assert.equal((await check("Hezekiah3:16")).ok, false);
});

for (const reference of ["Hezekiah 3:16", "hezekiah 3:16", "4 John 1:1", "John 22:1", "John 0:1", "John 3:0", "John 3:37", "John 3:35-4:99", "John 4:2-3:35", "John 3:18-16", "John 3:16-", "John 3:16:17", "John 3:16a"]) {
  test(`invalid coordinates fail closed: ${reference}`, async () => {
    assert.equal((await check(reference)).ok, false);
  });
}

test("nonexistent end verses are not silently clamped", async () => {
  const result = await check("Romans 8:38-45");
  assert.equal(result.ok, false);
  assert.equal(result.references.length, 0);
});

test("a complete multi verse quote verifies, but a partial quote cannot claim the range", async () => {
  const complete = await check(`John 3:16-17\n> ${john316}\n> ${john317}`);
  assert.equal(complete.ok, true, JSON.stringify(complete.issues));
  const partial = await check(`John 3:16-18\n> ${john316}`);
  assert.equal(partial.ok, false);
  assert.ok(partial.issues.some((issue) => issue.code === "quote_mismatch"));
  assert.equal((await check(`<blockquote>${john316} (John 3:16)</blockquote>`)).ok, true);
  assert.equal((await check("<blockquote>God guarantees wealth. (John 3:16)</blockquote>")).ok, false);
});

test("authentic single verse fragments and ordered ellipses verify", async () => {
  assert.equal((await check('“For God so loved the world” (John 3:16).')).ok, true);
  assert.equal((await check('“For God so loved the world … but have everlasting life.” (John 3:16).')).ok, true);
  assert.equal((await check('“For God so loved the world … he promises riches.” (John 3:16).')).ok, false);
  assert.equal((await check('“everlasting life … For God so loved” (John 3:16).')).ok, false);
});

test("ellipses do not turn one authentic verse into a verified passage", async () => {
  assert.equal((await check(`“${john316} …” (John 3:16-18).`)).ok, false);
});

test("numbered verses are checked without requiring quotation marks", async () => {
  const valid = await check(`John 3:16-17\n16 ${john316}\n17 ${john317}`);
  assert.equal(valid.ok, true, JSON.stringify(valid.issues));
  const fake = await check("John 3:16\n16 God promises that you will always become wealthy.");
  assert.equal(fake.ok, false);
  assert.equal((await check(`John 3:16\n17 ${john316}`)).ok, false, "authentic text cannot carry a fabricated verse number");
  assert.equal((await check(`John 3:16-17\n> 16 ${john316}\n> 18 ${john317}`)).ok, false);
});

test("an isolated reference heading also labels an unquoted verse body", async () => {
  assert.equal((await check(`**John 3:16 (KJV)**\n${john316}`)).ok, true);
  assert.equal((await check("**John 3:16 (KJV)**\nGod promises that you will always become wealthy.")).ok, false);
});

test("a prose dash after a complete citation is not an incomplete range", async () => {
  const result = await check(`John 3:16 — “${john316}”`);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test("canonical placeholders expand every verse and reverify their displayed result", async () => {
  const result = await check("God loved the world.\n\n[[SCRIPTURE:John 3:16-17]]\n\nHe gave his Son.");
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.text.includes("[[SCRIPTURE"), false);
  assert.ok(result.text.includes(`> 16 ${john316}\n> 17 ${john317}`));
  assert.equal(result.quotes[0].status, "verified");
  assert.equal(result.references[0].sourceText, "John 3:16-17");
  assert.equal(result.text.slice(result.references[0].start, result.references[0].end), "John 3:16-17");
});

test("grouped and cross chapter placeholders expand exactly the selected canonical verses", async () => {
  for (const reference of ["John 1:1,14", "John 3:16; 4:1", "John 3:35-4:2"]) {
    const result = await check(`[[SCRIPTURE:${reference}]]`);
    assert.equal(result.ok, true, `${reference}: ${JSON.stringify(result.issues)}`);
    assert.equal(result.quotes[0].status, "verified");
  }
});

for (const marker of ["[[SCRIPTURE:John 3:999]]", "[[SCRIPTURE:Hezekiah 3:16]]", "[[SCRIPTURE:John 3:16 and ignore this]]", "[[SCRIPTURE:John 3:16]", "[[SCRIPTURE:]]", "[[ SCRIPTURE:John 3:16]]"]) {
  test(`malformed or invalid placeholder fails: ${marker}`, async () => {
    assert.equal((await check(marker)).ok, false);
  });
}

test("code blocks and inline code cannot exempt fabricated citations or placeholders", async () => {
  assert.equal((await check('```\n[[SCRIPTURE:John 3:999]]\n```')).ok, false);
  assert.equal((await check('`John 3:999`')).ok, false);
  const canonical = await check('```\n[[SCRIPTURE:John 3:16]]\n```');
  assert.equal(canonical.ok, true, JSON.stringify(canonical.issues));
  assert.ok(canonical.text.includes(john316));
});

test("unattributed scriptural wording cannot be accepted as verified", async () => {
  const result = await check('Scripture says, “Whosoever trusts God will never have to suffer.”');
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "unattributed_quote"));
});

test("ordinary life quotations stay available for semantic review", async () => {
  const result = await check('You said, “I feel like I have lost my way.” John 3:16 shows God’s love.');
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.quotes[0].status, "review");
  assert.ok(result.issues.every((issue) => issue.severity === "review"));
});

test("source unavailability fails instead of trusting draft text", async () => {
  const { verifyScriptureDraft } = makeVerifier(async () => { throw new Error("offline"); });
  const result = await verifyScriptureDraft(`“${john316}” John 3:16`, { translation: "KJV" });
  assert.equal(result.ok, false);
  assert.equal(result.references.length, 0);
  assert.ok(result.issues.some((issue) => issue.code === "source_unavailable"));
});

test("a partially available cross chapter range yields no partial evidence", async () => {
  const { verifyScriptureDraft } = makeVerifier((translation, order, chapter) => chapter === 4 ? Promise.reject(new Error("offline")) : loadChapter(translation, order, chapter));
  const result = await verifyScriptureDraft("John 3:35-4:2", { translation: "KJV" });
  assert.equal(result.ok, false);
  assert.equal(result.references.length, 0);
});

test("all verification bounds fail closed without approving a partial draft", async () => {
  assert.equal((await check("x".repeat(80_001))).ok, false);
  assert.equal((await check("John 3:16; 4:1", { maxReferences: 1 })).ok, false);
  assert.equal((await check("John 3:16-18", { maxVerses: 2 })).ok, false);
  assert.equal((await check("[[SCRIPTURE:Psalms 1-150]]")).ok, false);
  assert.equal((await check("John 3:16", { maxVerses: Number.NaN })).ok, false);
});

test("the translation loader receives the selected quotation translation", async () => {
  const calls = [];
  const { verifyScriptureDraft } = makeVerifier(async (translation, order, chapter) => {
    calls.push([translation, order, chapter]);
    return ["Texto canónico de prueba."];
  });
  const result = await verifyScriptureDraft("[[SCRIPTURE:Juan 1:1]]", { translation: "RV1909" });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(calls, [["RV1909", 43, 1]], "canonical chapter loads are cached within one verification");
  assert.equal(result.references[0].canonicalText, "Texto canónico de prueba.");
});

test("unsupported translations cannot silently select another source", async () => {
  assert.equal((await check("John 3:16", { translation: "invented" })).ok, false);
});

test("source edition identifiers verify raw WLC coordinates and retain their KJV mapping separately", async () => {
  const result = await check("The source is `WLC51:3` for KJV Psalm 51:1.");
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.references.map((reference) => reference.reference), ["Psalms 51:1"]);
  assert.equal(result.originalEvidence[0].sourceIdentifier, "WLC 51:3");
  assert.equal(result.originalEvidence[0].edition, "WLC");
  assert.equal(result.originalEvidence[0].chapter, 51);
  assert.equal(result.originalEvidence[0].verse, 3);
  assert.deepEqual(result.originalEvidence[0].kjvReferences, ["Psalms 51:1"]);
  const canonical = await originals.getOriginalVerse(19, 51, 3);
  assert.equal(result.originalEvidence[0].text, canonical.words.map((word) => word.text).join(" "));
  assert.equal((await check("The source is WLC51:3, corresponding to KJV Psalm 51:1.")).ok, true);
});

test("source identifiers reject missing verses, incorrect alignment, testament, and ambiguous book", async () => {
  for (const text of [
    "The source is `WLC51:999` for KJV Psalm 51:1.",
    "The source is `WLC51:4` for KJV Psalm 51:1.",
    "The source is `TR51:3` for KJV Psalm 51:1.",
    "The source is `WLC51:3`.",
    "In Psalms the source is `WLC51:999`.",
    "The source is `WLC 51:3-4` for KJV Psalm 51:1.",
    "The source is `WLC 51:abc` for KJV Psalm 51:1.",
    "The source is WLC51:3; 51:999 for KJV Psalm 51:1.",
    "The source is WLC51:3x for KJV Psalm 51:1.",
  ]) assert.equal((await check(text)).ok, false, text);
});

test("a valid original source quotation uses trusted Hebrew rather than English evidence", async () => {
  const raw = await originals.getOriginalVerse(19, 51, 3);
  const word = raw.words[0].text;
  const result = await check(`Psalm 51:1 uses “${word}” in the source \`WLC 51:3\`.`);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.quotes[0].status, "verified");
  assert.ok(result.quotes[0].references.includes("Psalms (WLC 51:3)"));
  const forged = await check("Psalm 51:1 uses “אבגדהוז” in the source `WLC 51:3`.");
  assert.equal(forged.ok, false);
  assert.ok(forged.issues.some((issue) => issue.code === "quote_mismatch"));
});

test("unquoted Hebrew in inline code is also checked, including the precise selected source fragment", async () => {
  const mapped = await originals.getOriginalVerseForKjv(19, 13, 6);
  const word = mapped.words[0].text;
  const result = await check(`Psalm 13:6 uses \`${word}\` from \`WLC13:6\`.`);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.originalEvidence[0].wordStart, mapped.sourceReferences[0].wordStart);
  const forged = await check("Psalm 51:1 uses `אבגדהוז` from `WLC51:3`.");
  assert.equal(forged.ok, false);
});

test("TR identifiers verify Greek and never leak source coordinates into translated references", async () => {
  const raw = await originals.getOriginalVerse(43, 1, 1);
  const result = await check(`John 1:1 uses “${raw.words[0].text}” in \`TR1:1\`.`);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.references.length, 1);
  assert.equal(result.originalEvidence[0].edition, "TR");
  assert.equal((await check("John 1:1 uses “ψευδης” in `TR1:1`.")).ok, false);
});

test("explicitly edition-qualified coordinates use raw source numbering", async () => {
  const result = await check("The source is Joel 4:1 (WLC numbering).");
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.references.length, 0, "the source's fourth chapter is not a KJV fourth chapter");
  assert.equal(result.originalEvidence[0].sourceIdentifier, "WLC 4:1");
  assert.equal(result.originalEvidence[0].order, 29);
  assert.equal((await check("Joel 4:999 (WLC numbering)")).ok, false);
});

test("an original quote with a KJV citation gets trusted inverse-mapped evidence even without an edition label", async () => {
  const mapped = await originals.getOriginalVerseForKjv(19, 51, 1);
  const result = await check(`Psalm 51:1 uses “${mapped.words[0].text}”.`);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.originalEvidence[0].sourceIdentifier, "WLC 51:3");
  assert.equal((await check("Psalm 51:1 uses “אבגדהוז”.")).ok, false);
});

test("original source unavailability fails closed", async () => {
  const { verifyScriptureDraft } = makeVerifier(loadChapter, {
    getOriginalVerse: async () => { throw new Error("unavailable"); },
    getOriginalVerseForKjv: originals.getOriginalVerseForKjv,
  });
  const result = await verifyScriptureDraft("The source is `WLC51:3` for KJV Psalm 51:1.", { translation: "KJV" });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "source_unavailable"));
});

test("all four joined original verses verify the exact trusted fragment order", async () => {
  for (const [order, chapter, verse] of [[4, 26, 1], [9, 20, 42], [11, 22, 43], [13, 12, 4]]) {
    const book = books.find((book) => book.order === order);
    const mapped = await originals.getOriginalVerseForKjv(order, chapter, verse);
    const reference = `${book.name} ${chapter}:${verse}`;
    assert.equal(mapped.sourceReferences.length, 2);
    const text = mapped.words.map((word) => word.text).join(" ");
    const result = await check(`${reference} reads “${text}” in the Hebrew.`);
    assert.equal(result.ok, true, `${reference}: ${JSON.stringify(result.issues)}`);
    assert.deepEqual(result.originalEvidence.map((item) => `${item.chapter}:${item.verse}`), mapped.sourceReferences.map((item) => `${item.chapter}:${item.verse}`));
    const fragments = await Promise.all(mapped.sourceReferences.map((source) => originals.getOriginalVerse(order, source.chapter, source.verse)));
    const reordered = fragments.toReversed().flatMap((fragment) => fragment.words).map((word) => word.text).join(" ");
    assert.equal((await check(`${reference} reads “${reordered}” in the Hebrew.`)).ok, false, `${reference} cannot reorder source fragments`);
    const omitted = fragments[0].words.map((word) => word.text).join(" ");
    assert.equal((await check(`${reference} reads “${omitted}” in the Hebrew.`)).ok, false, `${reference} cannot silently omit a full source fragment`);
    assert.equal((await check(`${reference} reads “${mapped.words.slice(1).map((word) => word.text).join(" ")}” in the Hebrew.`)).ok, false, `${reference} cannot silently omit words`);
    assert.equal((await check(`${reference} reads “${text} אבגדהוז” in the Hebrew.`)).ok, false, `${reference} cannot append fabricated words`);
  }
});

test("shifted original chapters still quote their trusted source, including Zechariah 2:1", async () => {
  const mapped = await originals.getOriginalVerseForKjv(38, 2, 1);
  const text = mapped.words.map((word) => word.text).join(" ");
  const result = await check(`Zechariah 2:1 reads “${text}” in the Hebrew.`);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.originalEvidence.map((item) => `${item.chapter}:${item.verse}`), mapped.sourceReferences.map((item) => `${item.chapter}:${item.verse}`));
});

test("explicit source identifiers cannot supply an unrelated convenient join", async () => {
  const mapped = await originals.getOriginalVerseForKjv(11, 22, 43);
  const text = mapped.words.map((word) => word.text).join(" ");
  const result = await check(`1 Kings 22:43 reads “${text}” in sources \`WLC22:43\` and \`WLC22:44\`.`);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  const missingSource = await check(`1 Kings 22:43 reads “${text}” in source \`WLC22:43\`.`);
  assert.equal(missingSource.ok, false);
});

test("real original-word paragraph keeps English excerpts and Hebrew words attached to their respective sources", async () => {
  const draft = "[[SCRIPTURE:Psalms 51:1]]\n\nThe Hebrew word behind “Have mercy” is **חָנֵּ֣נִי** (*chânan*), Strong’s **H2603**. Its original edition identifier aligned to KJV Psalm 51:1 is `WLC 51:3`. The verse numbering differs between the Westminster Leningrad Codex and the KJV.";
  const result = await check(draft);
  assert.equal(result.ok, true, JSON.stringify({ issues: result.issues, quotes: result.quotes }));
  assert.ok(result.quotes.some((quote) => quote.text === "Have mercy" && quote.status === "verified" && quote.references.includes("Psalms 51:1")));
  const raw = await originals.getOriginalVerse(19, 51, 3);
  assert.deepEqual(result.originalEvidence[0].tokens, raw.words);
  assert.equal(result.originalEvidence[0].tokens[0].strongs, "H2603");
  assert.equal(result.originalEvidence[0].tokens[0].morph, "HVqv2ms/Sp1cs");
  assert.notEqual(result.originalEvidence[0].tokens[0].text, result.originalEvidence[0].tokens[0].lemma);
  assert.equal(result.originalEvidence[0].tokens[0].translit, "chânan");
  assert.equal((await check(draft.replace("Have mercy", "Be financially rich"))).ok, false);
});

test("connections reference delimiters and prose heading colons remain valid citations", async () => {
  for (const draft of ["John 3:16 :: God gave His Son.", "John 3:16: For God loved the world."]) {
    const result = await check(draft);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.references[0].reference, "John 3:16");
  }
  const lines = [
    ["Genesis 1:1", "God created the heaven and the earth."],
    ["Psalms 23:1", "The LORD is the shepherd."],
    ["Proverbs 3:5", "Trust in the LORD with all your heart."],
    ["Isaiah 53:5", "The servant was wounded for our transgressions."],
    ["Matthew 11:28", "Jesus calls those who labour and are heavy laden."],
    ["John 3:16", "God gave His only begotten Son."],
    ["Romans 5:8", "Christ died for us while we were sinners."],
    ["Ephesians 2:8", "Salvation is by grace through faith."],
    ["Philippians 4:6", "Make requests known unto God by prayer and supplication."],
    ["Revelation 22:21", "The grace of the Lord Jesus Christ is with His people."],
  ];
  const cards = await check(`These passages show God's provision.\n${lines.map(([reference, explanation]) => `${reference} :: ${explanation}`).join("\n")}`);
  assert.equal(cards.ok, true, JSON.stringify(cards.issues));
  assert.deepEqual(cards.references.map((reference) => reference.reference), lines.map(([reference]) => reference));
  assert.equal(cards.quotes.length, 0, "card explanations remain prose for independent claim review");
  const quoted = await check(`John 3:16 :: “${john316}”`);
  assert.equal(quoted.ok, true, JSON.stringify(quoted.issues));
  assert.equal((await check('John 3:16 :: “God guarantees wealth.”')).ok, false, "the delimiter does not exempt a fabricated quotation");
});

test("prose delimiters do not mask malformed internal colons or numeric coordinate tails", async () => {
  for (const reference of ["John 3::16", "John 3:: God gave His Son.", "John 3:16:4", "John 3:16: 4", "John 3:16 :: 4", "John 3:16::: God gave His Son.", "John 3:16:", "Hezekiah 3:16 :: God gave His Son."]) {
    assert.equal((await check(reference)).ok, false, reference);
  }
});

test("actual note blockquote accepts a trailing reference and comma translation attribution", async () => {
  const result = await check(`## Everlasting life is God's gift through faith in Christ\n\n> ${john316}\n> John 3:16, KJV\n\nGod gives everlasting life through faith in Jesus Christ, His Son.`);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.quotes[0].text, john316);
  assert.equal((await check("> God guarantees wealth.\n> John 3:16, KJV")).ok, false);
  assert.equal((await check(`> ${john316}\n> John 3:16-18, KJV`)).ok, false);
});

test("actual note receipts treat a quoted note title as a named artifact for semantic review", async () => {
  for (const draft of [
    "Created the note “Scripture gate QA 2026-10-29” once, with the full KJV text of John 3:16, its reference, and one sentence explaining the gift of everlasting life through faith in Jesus Christ.",
    "The note “Scripture gate QA 2026-10-29” was created once. It contains John 3:16 (KJV) and explains that everlasting life is God’s gift, received through faith in Jesus Christ rather than earned by works (John 3:16; Ephesians 2:8-9).",
  ]) {
    const result = await check(draft);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.ok(result.quotes.some((quote) => quote.text === "Scripture gate QA 2026-10-29" && quote.status === "review"));
  }
  assert.equal((await check('The note quotes “God guarantees wealth.” from John 3:16.')).ok, false, "a note's actual Scripture quotation still requires canonical fidelity");
  const study = await check('The study titled “What grace means” discusses Ephesians 2:8-9.');
  assert.equal(study.ok, true, JSON.stringify(study.issues));
  assert.equal(study.quotes[0].status, "review");
});

test("actual connections lines do not misread numbered book volumes as numbered verse bodies", async () => {
  const draft = "God’s love is shown in sending and giving his Son to save sinners.\nRomans 5:8 :: John 3:16 says God’s love moved him to give his Son; Romans 5:8 shows that love in Christ’s death for sinners, even while they were still sinners.\n1 John 4:9 :: Both passages connect God’s love with sending his only begotten Son into the world, so that life comes through him.\nRomans 8:32 :: John 3:16 speaks of God giving his Son; Romans 8:32 emphasizes the cost of that gift and assures believers that God will freely give them all things with Christ.\nJohn 3:15 :: This repeats the promise that whoever believes in the Son will not perish but have eternal life.\nJohn 11:25 :: Jesus identifies himself as the resurrection and the life.\nJohn 6:40 :: Both passages promise everlasting life to those who believe on the Son.\nJohn 3:36 :: This passage contrasts the everlasting life promised to believers with the judgment of those who reject the Son.\n1 John 4:19 :: John 3:16 shows God’s love coming first in giving his Son; 1 John 4:19 says our love for God is a response to his prior love.\nJohn 10:28 :: John 3:16 promises that believers will not perish; John 10:28 adds Jesus’ promise that he gives them eternal life and no one can pluck them from his hand.\n1 Timothy 1:15 :: John 3:16 says God gave his Son so believers might have life; 1 Timothy 1:15 states that Christ Jesus came into the world to save sinners.";
  const result = await check(draft);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.quotes.length, 0);
  assert.ok(result.references.some((reference) => reference.reference === "1 John 4:9"));
  assert.ok(result.references.some((reference) => reference.reference === "1 Timothy 1:15"));
  const emphasized = await check("John 3:16 :: God gave His Son.\n**1 John 4:9** :: God sent His only begotten Son into the world.");
  assert.equal(emphasized.ok, true, JSON.stringify(emphasized.issues));
  const john318 = "He that believeth on him is not condemned: but he that believeth not is condemned already, because he hath not believed in the name of the only begotten Son of God.";
  const threeVerses = await check(`John 3:16-18\n16 ${john316}\n17 ${john317}\n18 ${john318}`);
  assert.equal(threeVerses.ok, true, JSON.stringify(threeVerses.issues));
  assert.equal((await check(`John 3:16-18\n16 ${john316}\n17 ${john317}\n18 God guarantees wealth.`)).ok, false);
});

const actualHebrewExplanation = "Psalm 51:1, KJV:\n\n[[SCRIPTURE:Psalms 51:1]]\n\nThe Hebrew surface form is **חָנֵּ֣נִי**. Its lemma, the dictionary form of the word, is **חָנַן**. The Westminster Leningrad Codex morphology identifies the surface form as a Qal imperative, second-person masculine singular, with a first-person singular suffix: David is asking God to “show me favor” or “be gracious to me.”\n\nThe transliteration **chânan** is the Strong’s dictionary transliteration of the lemma **חָנַן**, not a transliteration of the inflected surface form **חָנֵּ֣נִי**. In the verse, “Have mercy” translates this plea for God’s gracious favor. It is distinct from the later words translated “lovingkindness” and “tender mercies,” which are different Hebrew words.\n\nThe KJV reference is Psalm 51:1. The corresponding source coordinate supplied for the Hebrew is `WLC 51:3`; that is a Westminster Leningrad Codex coordinate, not KJV Psalm 51:3.";
const actualHebrewRepair = "Psalm 51:1 (KJV):\n[[SCRIPTURE:Psalms 51:1]]\n\nIn the Hebrew text, the inflected surface form is חָנֵּ֣נִי; its lemma (dictionary form) is חָנַן. The form is a Qal imperative, second-person masculine singular, with a first-person singular suffix: David is asking God to show him favor or be gracious to him. The dictionary transliteration **chânan** represents the lemma, not the inflected surface form. (WLC Psalm 51:3; corresponding KJV Psalm 51:1.)";

test("actual multi-paragraph Hebrew explanation corroborates exact source tokens, labeled lemmas, and English excerpts", async () => {
  const result = await check(actualHebrewExplanation);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  for (const text of ["חָנֵּ֣נִי", "חָנַן", "Have mercy", "lovingkindness", "tender mercies,"]) assert.ok(result.quotes.some((quote) => quote.text === text && quote.status === "verified" && quote.references.length));
});

test("actual repair recognizes an edition prefix before an explicit source book", async () => {
  const result = await check(actualHebrewRepair);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.ok(result.originalEvidence.some((item) => item.sourceIdentifier === "WLC 51:3" && item.kjvReferences.includes("Psalms 51:1")));
  assert.ok(!result.references.some((item) => item.reference === "Psalms 51:3"));
});

test("cross-paragraph corroboration cannot substitute lemmas for surface forms or invent source words", async () => {
  const prefix = "The original source for KJV Psalm 51:1 is `WLC Psalm 51:3`.\n\n";
  assert.equal((await check(`${prefix}The Hebrew surface form is **חָנַן**.`)).ok, false);
  assert.equal((await check(`${prefix}The Hebrew lemma is **אבגדהוז**.`)).ok, false);
  assert.equal((await check(`${prefix}The Hebrew surface form is **אבגדהוז**.`)).ok, false);
  assert.equal((await check(`${prefix}The Hebrew word is **חָנַן**.`)).ok, false, "an unlabeled lemma is not a source surface token");
  const validLemma = await check(`${prefix}The Hebrew lemma is **חָנַן**.`);
  assert.equal(validLemma.ok, true, JSON.stringify(validLemma.issues));
});

test("a contradictory local citation blocks global original or English evidence borrowing", async () => {
  const prefix = "The original source for KJV Psalm 51:1 is `WLC Psalm 51:3`.\n\n";
  assert.equal((await check(`${prefix}John 1:1 has the Hebrew surface form **חָנֵּ֣נִי**.`)).ok, false);
  assert.equal((await check(`${prefix}Psalm 51:3 contains the word “lovingkindness”.`)).ok, false);
  assert.equal((await check(`${prefix}The verse contains the phrase “God guarantees wealth”.`)).ok, false);
});

test("cross-paragraph exact fragments remain unresolved when multiple sources match", async () => {
  const english = await check("Compare Genesis 1:1 and John 1:1.\n\nThe phrase is “In the beginning”.");
  assert.equal(english.ok, false);
  assert.ok(english.issues.some((issue) => issue.code === "ambiguous_quote" && issue.severity === "error"));
  const hebrew = await check("The original sources are `WLC Genesis 1:1` and `WLC Genesis 1:3`.\n\nThe Hebrew lemma is **אֱלֹהִים**.");
  assert.equal(hebrew.ok, false);
  assert.ok(hebrew.issues.some((issue) => issue.code === "ambiguous_quote" && issue.severity === "error"));
});

test("qualified original-edition source labels still reject invalid verses and wrong testaments", async () => {
  for (const reference of ["WLC Psalm 51:999", "WLC John 1:1", "TR Psalm 51:3", "WLC Psalm 51:3-4"]) assert.equal((await check(reference)).ok, false, reference);
  const valid = await check("The source is `TR John 1:1`.");
  assert.equal(valid.ok, true, JSON.stringify(valid.issues));
  assert.equal(valid.references.length, 0);
  assert.equal(valid.originalEvidence[0].order, 43);
});

test("cross-paragraph corroboration respects the latest explicit passage scope", async () => {
  assert.equal((await check("The original source for KJV Psalm 51:1 is `WLC Psalm 51:3`.\n\nPsalm 51:3\n\nThe Hebrew surface form is חָנֵּ֣נִי.")).ok, false);
  assert.equal((await check("[[SCRIPTURE:Psalms 51:1]]\n\nPsalm 23:1\n\nThe word is “lovingkindness”.")).ok, false);
  assert.equal((await check("[[SCRIPTURE:Psalms 51:1]]\n\nPsalm 23:1 describes the shepherd.\n\nThe word is “lovingkindness”.")).ok, false);
});

test("a whole-range claim cannot be reclassified as a global excerpt", async () => {
  for (const claim of ["The entire verse range says", "The complete passage contains the words", "The full quotation reads", "The passage in full contains the words", "The passage reads in full, word for word:", "The passage contains these words verbatim:", "The passage reads word-for-word:"]) {
    assert.equal((await check(`John 3:16-18\n\n${claim} “For God so loved the world”.`)).ok, false, claim);
  }
});

test("full single-verse claims require the entire text while explicit fragments remain valid", async () => {
  for (const prefix of ["John 3:16 in full says", "John 3:16 says in full, word for word:", "The complete verse at John 3:16 says", "John 3:16 reads verbatim:", "The whole of John 3:16 says", "John 3:16 reads completely:", "John 3:16, complete:", "John 3:16 says in full word-for-word:"]) {
    assert.equal((await check(`${prefix} “For God so loved the world”.`)).ok, false, prefix);
    const complete = await check(`${prefix} “${john316}”`);
    assert.equal(complete.ok, true, JSON.stringify(complete.issues));
  }
  assert.equal((await check('John 3:16 contains the fragment “For God so loved the world”.')).ok, true);
  assert.equal((await check('2 Timothy 4:5 contains the fragment “make full proof of thy ministry”.')).ok, true, "a source word inside the quotation does not establish a completeness claim");
  assert.equal((await check('John 3:16 says “For God so loved the world”; this is the verse in full.')).ok, false);
});

test("complete original-language claims cannot use a token or a joined-verse excerpt", async () => {
  const original = await originals.getOriginalVerseForKjv(19, 51, 1);
  const first = original.words[0].text;
  const source = original.words.map((word) => word.text).join(" ");
  assert.equal((await check(`Psalm 51:1 in full, word for word, reads “${first}” in \`WLC 51:3\`.`)).ok, false);
  const valid = await check(`Psalm 51:1 in full, word for word, reads “${source}” in \`WLC 51:3\`.`);
  assert.equal(valid.ok, true, JSON.stringify(valid.issues));
  const joined = await originals.getOriginalVerseForKjv(11, 22, 43);
  assert.equal((await check(`The complete Hebrew passage at 1 Kings 22:43 uses the word “${joined.words[0].text}”.`)).ok, false);
  assert.equal((await check(`1 Kings 22:43 uses the Hebrew word “${joined.words[0].text}”.`)).ok, true);
  const greek = await originals.getOriginalVerseForKjv(43, 1, 1);
  assert.equal((await check(`John 1:1-2 in full reads “${greek.words.map((word) => word.text).join(" ")}” in \`TR 1:1\` and \`TR 1:2\`.`)).ok, false, "a range cannot pass by matching just one entire original verse");
});

test("lexical complete/full glosses are distinct from claims to quote an entire passage", async () => {
  for (const draft of ['In Matthew 5:48, the word “perfect” means complete.', 'In Matthew 5:48, the word “perfect” means “complete”.', 'In Matthew 5:48, the word “perfect” means to be complete.']) {
    const english = await check(draft);
    assert.equal(english.ok, true, JSON.stringify(english.issues));
    assert.ok(english.quotes.some((quote) => quote.text === "perfect" && quote.status === "verified"));
    const gloss = english.quotes.find((quote) => quote.text === "complete");
    if (gloss) assert.equal(gloss.status, "review");
  }
  const original = await originals.getOriginalVerseForKjv(19, 51, 1);
  const hebrew = await check(`Psalm 51:1 uses “${original.words[0].text}”; the Hebrew surface form is a complete word. (WLC 51:3.)`);
  assert.equal(hebrew.ok, true, JSON.stringify(hebrew.issues));
});


const actualKeywordReferenceListDraft = "Psalm 24:1 (KJV):\n\n**Psalms 24:1 (KJV)**\n> 1 The earth is the LORD’s, and the fulness thereof; the world, and they that dwell therein.\n\nOther returned examples include Psalms 11:4, 22:28, 113:3, 115:16, 116:19, 118:23, and 137:4.\n\nPsalm 29:8 should **not** be an exact match for the possessive “LORD’s.” It says “the LORD shaketh,” which is not possessive.";

test("actual keyword draft keeps inherited conjoined references without phantom volume errors", async () => {
  const result = await check(actualKeywordReferenceListDraft);
  assert.deepEqual(result.references.map(reference => reference.reference), ["Psalms 24:1", "Psalms 24:1", "Psalms 11:4", "Psalms 22:28", "Psalms 113:3", "Psalms 115:16", "Psalms 116:19", "Psalms 118:23", "Psalms 137:4", "Psalms 29:8"]);
  assert.equal(result.issues.some(issue => issue.code === "unknown_book" || issue.code === "invalid_reference"), false, JSON.stringify(result.issues));
  assert.equal(result.ok, false, "the negative possessive quotation still fails canonical matching");
  assert.ok(result.issues.some(issue => issue.code === "quote_mismatch" && issue.reference === "Psalms 29:8" && issue.excerpt === "LORD’s."));
  assert.ok(result.quotes.some(quote => quote.text === "the LORD shaketh," && quote.status === "verified"));
});

test("a terminal citation coordinate is not a volume on the next citation", async () => {
  for (const separator of [".\n\n", ". ", " ", "\n"]) {
    const result = await check("Psalms 137:4" + separator + "Psalm 29:8.");
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.references.map(reference => reference.reference), ["Psalms 137:4", "Psalms 29:8"]);
  }
});

test("inherited conjunction lists retain real coordinates and canonical evidence", async () => {
  for (const draft of ["Psalms 11:4, 22:28, and 137:4.", "Psalms 11:4,22:28,and 137:4.", "John 3:16, and 18.", "John 3:16; and 4:1."]) {
    const result = await check(draft);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.references.length, draft.startsWith("Psalms") ? 3 : 2);
    assert.ok(result.references.every(reference => reference.canonicalText.length > 0));
  }
});

test("conjunction parsing never hides unknown books or malformed inherited coordinates", async () => {
  for (const draft of ["John 3:16, and Hezekiah 3:16.", "Psalms 11:4, and 999:4.", "John 3:16; and 4.", "John 3:16, and 4:999.", "John 3:16, and 4:1:2.", "John 3:16, and 4:1-", "John 3:16, and 4:1a."]) {
    assert.equal((await check(draft)).ok, false, draft);
  }
});

test("unsupported volume guards stay active outside prior citation spans", async () => {
  for (const draft of ["4 John 1:1", "IV John 1:1", "4\nJohn 1:1", "III Psalm 29:8", "Read 9. Psalm 29:8", "3:4 John 1:1", "Hezekiah 3:4 Psalm 29:8", "Psalms 137:4.\n\n4 John 1:1"]) {
    const result = await check(draft);
    assert.equal(result.ok, false, draft);
    assert.ok(result.issues.some(issue => issue.code === "invalid_reference" && issue.message.includes("volume")), JSON.stringify(result.issues));
  }
});

test("negative quotations and format controls retain the existing fail-closed rules", async () => {
  assert.equal((await check('Psalm 29:8 does not say “LORD’s.”')).ok, false);
  assert.equal((await check('John 3:16, and Heze\u200bkiah 3:16.')).ok, false);
  assert.equal((await check('Psalm 29:8 contains “God guarantees wealth.”')).ok, false);
});

test("safe negative wording can use ordinary prose while preserving actual Scripture quotes", async () => {
  const result = await check('Psalm 29:8 says “the LORD shaketh,” which uses LORD followed by shaketh rather than a possessive form.');
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.quotes.length, 1);
  assert.equal(result.quotes[0].status, "verified");
});


test("dangling range dashes cannot hide behind punctuation, newlines or Markdown", async () => {
  for (const suffix of ["-.", "-!", "-?", "-,", "-;", "-", "-\n", "-\nGod gave His Son.", "- **", "- `", '- "', "–.", "—.", "−.", "- **.**"]) {
    for (const prefix of ["John 4:1", "John 3:16, and 4:1"]) {
      const result = await check(prefix + suffix);
      assert.equal(result.ok, false, prefix + suffix);
      assert.ok(result.issues.some(issue => issue.code === "invalid_reference"), JSON.stringify(result.issues));
    }
  }
});

test("dash prose after complete coordinates and ranges still verifies", async () => {
  for (const draft of [
    "Read John 4:1 — Jesus knew.",
    "Read John 4:1 - **Jesus** knew.",
    "Read John 4:1–Jesus knew.",
    "Compare John 3:16-17 — God sent His Son.",
    `John 3:16-17 — “${john316} ${john317}”`,
  ]) {
    const result = await check(draft);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
  }
});

test("inherited list numbers cannot conceal an unsupported book volume", async () => {
  for (const draft of [
    "John 3:16, and 4 John 1:1",
    "John 3:16, 4 John 1:1",
    "John 3:16, and 9 John 1:1",
    "John 3:16, and 0 John 1:1",
    "John 3:16, and 10 John 1:1",
    "John 3:16, and 4. John 1:1",
    "John 3:16, and ４ John 1:1",
    "Psalms 11:4, and 3 Psalm 29:8",
  ]) {
    const result = await check(draft);
    assert.equal(result.ok, false, draft);
    assert.ok(result.issues.some(issue => issue.code === "invalid_reference" && issue.message.includes("volume")), JSON.stringify(result.issues));
    assert.equal(result.references.some(reference => reference.reference === "John 3:4"), false, "an invalid book volume cannot become an unrelated inherited verse");
  }
});

test("volume-boundary checks preserve supported volumes and prior explicit coordinates", async () => {
  for (const draft of [
    "John 3:16, and 1 John 4:9",
    "John 3:16, and 2 John 1:6",
    "John 3:16, and 3 John 1:4",
    "Psalms 137:4 Psalm 29:8",
    "Psalms １３７:４.\n\nPsalm 29:8",
  ]) {
    const result = await check(draft);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.references.length, 2, draft);
  }
});
