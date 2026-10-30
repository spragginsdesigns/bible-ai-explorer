import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { normalizeAssistantMarkdown } from "../src/utils/assistantMarkdown.ts";
import { analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore } from "../src/lib/ai/markdown-underscore-guard.ts";

const read = (relative) => readFileSync(new URL("../" + relative, import.meta.url), "utf8");
const json = (relative) => JSON.parse(read(relative));
function load(relative, exports, dependencies = {}) {
  const source = read(relative)
    .replace(/await import\("@\/data\/kjv\/([^"]+)"\)/g, 'await loadKjvJson("$1")')
    .replace(/await import\("\.\.\/\.\.\/data\/bsb\/([^"]+)"\)/g, 'await loadBsbJson("$1")')
    .replace(/await import\("@\/data\/((?:asv|rv1909|lut1912)\/[^\"]+)"\)/g, 'await loadEbibleJson("$1")')
    .replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
  return new Function(...Object.keys(dependencies), stripTypeScriptTypes(source) + "\nreturn {" + exports.join(",") + "};")(...Object.values(dependencies));
}
const books = load("src/lib/bible/books.ts", ["BOOKS", "bookByOrder", "LOCALIZED_BOOK_NAMES"], {
  booksJson: json("src/data/books.json"), bookNamesJson: json("src/data/book-names.json"),
});
const kjv = load("src/lib/bible/kjv.ts", ["getKjvChapter"], {
  ...books, loadKjvJson: async (file) => ({ default: json("src/data/kjv/" + file) }),
});
const bsb = load("src/lib/bible/bsb.ts", ["loadBsbChapter"], {
  loadBsbJson: async (file) => ({ default: json("src/data/bsb/" + file) }),
});
const unexpected = async () => { throw new Error("Unrelated source must not load"); };
const ebible = load("src/lib/bible/ebible.ts", ["getEbibleChapter"], {
  loadEbibleJson: async (file) => ({ default: json("src/data/" + file) }),
});
const translations = load("src/lib/bible/translations.ts", ["getChapter", "isTranslationId"], {
  ...kjv, ...bsb, ...ebible,
});
const makeVerifier = (overrides = {}) => load("src/lib/ai/scripture-verification.ts", ["verifyScriptureDraft"], {
  ...books, ...translations, ...bsb, normalizeAssistantMarkdown,
  analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore,
  getOriginalVerse: unexpected, getOriginalVerseForKjv: unexpected, ...overrides,
}).verifyScriptureDraft;
const verify = makeVerifier();
const check = (text) => verify(text, { translation: "BSB" });

test("a publisher omission does not withhold neighboring BSB source text", async () => {
  for (const verse of [19, 20, 22]) {
    const source = (await bsb.loadBsbChapter(40, 17))[verse - 1];
    const result = await check(`[[SCRIPTURE:Matthew 17:${verse}]]`);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.references[0].canonicalText, source.text);
    assert.equal(result.references[0].verses[0].verse, verse);
    assert.ok(result.quotes.some((quote) => quote.status === "verified"));
  }
});

test("requested omitted BSB slots and ranges never receive partial or substituted evidence", async () => {
  for (const reference of ["Matthew 17:21", "Matthew 17:20-22", "Matthew 17", "Matthew 16:28-17:22"]) {
    for (const draft of [reference, `[[SCRIPTURE:${reference}]]`]) {
      const result = await check(draft);
      assert.equal(result.ok, false, reference);
      assert.deepEqual(result.references, [], reference);
      assert.ok(result.issues.some((issue) => issue.code === "source_unavailable"));
    }
  }
  const kjvVerse = (await kjv.getKjvChapter(40, 17))[20];
  const substituted = await check(`Matthew 17:21 says "${kjvVerse}".`);
  assert.equal(substituted.ok, false);
  assert.deepEqual(substituted.references, []);
});

test("every BSB omission keeps all text-bearing neighbors valid and its own slot unavailable", async () => {
  let omitted = 0;
  let checked = 0;
  let affectedChapters = 0;
  for (const book of books.BOOKS) {
    const chapters = json(`src/data/bsb/${String(book.order).padStart(2, "0")}.json`);
    for (const [index, chapter] of chapters.entries()) {
      if (!chapter.some((verse) => verse.omitted)) continue;
      affectedChapters += 1;
      for (const verse of chapter) {
        const reference = `${book.name} ${index + 1}:${verse.number}`;
        const result = await check(`[[SCRIPTURE:${reference}]]`);
        if (verse.omitted) {
          omitted += 1;
          assert.equal(verse.text, "");
          assert.equal(result.ok, false, reference);
          assert.deepEqual(result.references, [], reference);
        } else {
          checked += 1;
          assert.equal(result.ok, true, reference + JSON.stringify(result.issues));
          assert.equal(result.references[0].canonicalText, verse.text);
          assert.equal(result.references[0].verses[0].verse, verse.number);
        }
      }
    }
  }
  assert.deepEqual({ omitted, checked, affectedChapters }, { omitted: 16, checked: 558, affectedChapters: 15 });
});

test("unexplained blank, sparse, mismatched or unavailable canonical source data still withholds", async () => {
  const canonical = await translations.getChapter("BSB", 40, 17);
  const formatted = await bsb.loadBsbChapter(40, 17);
  for (const overrides of [
    { getChapter: async () => canonical.map((text, index) => index === 0 ? "" : text) },
    { getChapter: async () => { const sparse = canonical.slice(); delete sparse[0]; return sparse; } },
    { loadBsbChapter: async () => formatted.map((verse) => ({ ...verse, omitted: false })) },
    { loadBsbChapter: async () => formatted.map((verse) => ({ ...verse, number: verse.number + 1 })) },
    { loadBsbChapter: async () => formatted.slice(1) },
    { loadBsbChapter: async () => formatted.map((verse, index) => index === 0 ? { ...verse, text: "changed source" } : verse) },
    { loadBsbChapter: unexpected },
  ]) {
    const result = await makeVerifier(overrides)("[[SCRIPTURE:Matthew 17:19]]", { translation: "BSB" });
    assert.equal(result.ok, false);
    assert.deepEqual(result.references, []);
    assert.ok(result.issues.some((issue) => issue.code === "source_unavailable"));
  }
  const corruptKjv = makeVerifier({ getChapter: async () => ["Canonical words", ""] });
  assert.equal((await corruptKjv("Matthew 17:1", { translation: "KJV" })).ok, false);
});

test("multiline BSB canonical placeholders keep every source line inside one quotation", async () => {
  const slots = [{ chapter: 17, verse: 26 }, { chapter: 17, verse: 27 }, { chapter: 18, verse: 1 }, { chapter: 18, verse: 2 }];
  const verses = await Promise.all(slots.map(async (slot) => ({ ...slot, text: (await translations.getChapter("BSB", 40, slot.chapter))[slot.verse - 1] })));
  assert.ok(verses[0].text.includes("\n"));
  const result = await check("[[SCRIPTURE:Matthew 17:26-18:2]]");
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.text, "**Matthew 17:26-18:2 (BSB)**\n" + verses.map((verse) => `> ${verse.verse} ${verse.text.replace(/\n/g, "\n> ")}`).join("\n"));
  assert.deepEqual(result.references[0].verses.map(({ chapter, verse, text }) => ({ chapter, verse, text })), verses);
  assert.equal(result.quotes.length, 1);
  assert.equal(result.quotes[0].status, "verified");
});

test("complete multiline BSB ranges still reject omitted, reordered and substituted verses", async () => {
  const passage = (await check("[[SCRIPTURE:Matthew 17:26-18:2]]")).text;
  const source = await translations.getChapter("BSB", 40, 18);
  for (const draft of [
    passage.replace("> 1 " + source[0], ""),
    passage.replace("> 1 " + source[0], "> 1 " + source[1]),
    passage.replace("> 1 " + source[0], "> 2 " + source[0]),
    passage.replace(source[0], "Invented source words"),
  ]) {
    const result = await check(draft);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "quote_mismatch"));
  }
});

for (const [order, chapter, verse] of [
  ...[4, 6, 8, 11, 13, 15, 19, 21, 23, 26, 28, 30].map((verse) => [4, 2, verse]),
  [15, 1, 9], [15, 1, 10], [15, 2, 42], [15, 2, 60], [16, 7, 45], [16, 7, 62],
]) {
  const book = books.BOOKS.find((book) => book.order === order);
  const reference = `${book.name} ${chapter}:${verse}`;
  test("canonical source prose and numeric continuation lines stay exact: " + reference, async () => {
    const source = (await translations.getChapter("BSB", order, chapter))[verse - 1];
    const result = await check(`[[SCRIPTURE:${reference}]]`);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.text, `**${reference} (BSB)**\n> ${verse} ${source.replace(/\n/g, "\n> ")}`);
    assert.equal(result.references.length, 1);
    assert.equal(result.references[0].canonicalText, source);
    assert.equal(result.quotes.length, 1);
    assert.equal(result.quotes[0].status, "verified");
  });
}

test("canonical source spans never exempt adjacent input citations or merged fabricated text", async () => {
  for (const draft of [
    "[[SCRIPTURE:Numbers 2:4]]\n> invented source words",
    "> invented source words\n[[SCRIPTURE:Numbers 2:4]]",
    "[[SCRIPTURE:Ezra 1:9]]\n> 999 invented source words",
    "[[SCRIPTURE:John 3:16]]\n\nNumbers 74,600",
    "Numbers 74,600\n\n[[SCRIPTURE:John 3:16]]",
    "[[SCRIPTURE:Numbers 2:4]]\n\nObadiah 99:99",
    "[[SCRIPTURE:Numbers 2:4]]\n\nJohn 3:16 says \"invented source words\".",
  ]) {
    const result = await check(draft);
    assert.equal(result.ok, false, draft);
    assert.ok(result.issues.some((issue) => issue.severity === "error"));
  }
});

test("ASV's exact build-declared omissions do not invalidate neighboring source verses", async () => {
  const codes = { MAT: 40, MAR: 41, LUK: 42, JOH: 43, ACT: 44, ROM: 45 };
  const declared = [...read("scripts/bible/build-ebible.py").match(/"ASV": \[([\s\S]*?)\]/)[1].matchAll(/"([A-Z]{3}) (\d+):(\d+)"/g)]
    .map(([, code, chapter, verse]) => `${codes[code]}:${chapter}:${verse}`).sort();
  const found = [];
  let checked = 0;
  for (const book of books.BOOKS) {
    const chapters = json(`src/data/asv/${String(book.order).padStart(2, "0")}.json`);
    for (const [index, chapter] of chapters.entries()) {
      if (chapter.every((text) => text.trim())) continue;
      for (const [offset, source] of chapter.entries()) {
        const reference = `${book.name} ${index + 1}:${offset + 1}`;
        const result = await verify(`[[SCRIPTURE:${reference}]]`, { translation: "ASV" });
        if (!source.trim()) {
          found.push(`${book.order}:${index + 1}:${offset + 1}`);
          assert.equal(result.ok, false, reference);
          assert.deepEqual(result.references, []);
        } else {
          checked += 1;
          assert.equal(result.ok, true, reference + JSON.stringify(result.issues));
          assert.equal(result.references[0].canonicalText, source);
          assert.equal(result.references[0].verses[0].verse, offset + 1);
        }
      }
    }
  }
  assert.equal(checked, 558);
  assert.equal(found.length, 16);
  assert.deepEqual(found.sort(), declared);
  for (const reference of ["Matthew 17:21", "Matthew 17:20-22", "Matthew 17"]) {
    assert.equal((await verify(`[[SCRIPTURE:${reference}]]`, { translation: "ASV" })).ok, false);
  }
  const actual = await translations.getChapter("ASV", 40, 17);
  const corrupt = makeVerifier({ getChapter: async () => actual.map((text, index) => index === 0 ? "" : text) });
  const rejected = await corrupt("[[SCRIPTURE:Matthew 17:19]]", { translation: "ASV" });
  assert.equal(rejected.ok, false);
  assert.deepEqual(rejected.references, []);
});
