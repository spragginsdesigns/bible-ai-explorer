import { normalizeAssistantMarkdown } from "../src/utils/assistantMarkdown.ts";
import { analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore } from "../src/lib/ai/markdown-underscore-guard.ts";
import { gateAnswer } from "../src/lib/ai/answer-gate.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

// Execute the production module against bundled KJV, without importing another
// test suite or permitting provider, database or network calls.
const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const books = JSON.parse(read("src/data/books.json"));
const names = JSON.parse(read("src/data/book-names.json"));
const localized = ["es", "de"].flatMap(language => [
  ...names[language].names.map((name, index) => [name, index + 1]),
  ...Object.entries(names[language].aliases),
]);
const bundled = new Map();
async function chapter(translation, order, number) {
  assert.equal(translation, "KJV");
  if (!bundled.has(order)) bundled.set(order, JSON.parse(read(`src/data/kjv/${books.find(book => book.order === order).file}`)));
  return bundled.get(order)[number - 1];
}
const forbidden = () => { throw Error("Original-source or network access is forbidden in this KJV-only fixture"); };
const source = stripTypeScriptTypes(read("src/lib/ai/scripture-verification.ts").replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, ""));
const { verifyScriptureDraft } = new Function("normalizeAssistantMarkdown", "analyzeMarkdownUnderscores", "markdownRangeHasLiteralUnderscore", "BOOKS", "LOCALIZED_BOOK_NAMES", "getChapter", "isTranslationId", "getOriginalVerse", "getOriginalVerseForKjv", "loadBsbChapter", `${source}\nreturn { verifyScriptureDraft };`)(normalizeAssistantMarkdown, analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore, books, localized, chapter, translation => translation === "KJV", forbidden, forbidden, forbidden);
const check = text => verifyScriptureDraft(text, { translation: "KJV" });
const prayer = "Heavenly Father, please heal me according to Thy will. Amen.";

for (const frame of ["Here is a prayer", "Here is an original prayer", "Let's pray", "Let us pray", "You can pray"]) {
  for (const presentation of [body => `“${body}”`, body => `\n\n> ${body}`, body => `\n> “${body}”`]) {
    test(`${frame} routes an explicitly composed prayer to review: ${presentation(prayer)}`, async () => {
      const text = `${frame}: ${presentation(prayer)}`;
      const result = await check(text);
      assert.equal(result.ok, true, JSON.stringify(result.issues));
      assert.equal(result.text, text);
      assert.equal(result.quotes.length, 1);
      assert.equal(result.quotes[0].status, "review");
      assert.deepEqual(result.quotes[0].references, []);
      assert.deepEqual(result.issues.map(({ code, severity }) => ({ code, severity })), [{ code: "ambiguous_quote", severity: "review" }]);
    });
  }
}

test("a preceding discussion citation stays present without certifying the prayer", async () => {
  for (const body of [prayer, "Father, please heal me and give me strength. Amen."]) {
    const text = `James 5:14-15 encourages prayer. Here is a prayer: “${body}”`;
    const result = await check(text);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.text, text);
    assert.equal(result.quotes[0].status, "review");
    assert.equal(result.references[0].reference, "James 5:14-15");
    assert.equal(result.references[0].verses.length, 2);
    assert.equal(result.references[0].canonicalText.includes("pray over him"), true);
    assert.deepEqual(result.quotes[0].references, []);
  }
});

for (const explanation of [
  "James 5:14-15 teaches us to pray for the sick.",
  "Scripture encourages prayer (James 5:14-15).",
  "According to James 5:14-15, we should pray for the sick.",
  "James 5:14-15 says we can pray for the sick.",
]) {
  test(`source explanation before an original prayer keeps semantic review: ${explanation}`, async () => {
    const text = `${explanation} Here is an original prayer: “${prayer}”`;
    const result = await check(text);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.equal(result.text, text);
    assert.equal(result.quotes[0].status, "review");
    assert.deepEqual(result.quotes[0].references, []);
    assert.deepEqual(result.issues.map(({ code, severity }) => ({ code, severity })), [{ code: "ambiguous_quote", severity: "review" }]);
    assert.equal(result.references[0].reference, "James 5:14-15");
    assert.equal(result.references[0].verses.length, 2);
  });
}

for (const text of [
  'Matthew 6:9 says, “Our Father, please guarantee me wealth. Amen.”',
  'Matthew 6:9. Here is a prayer: “Father, please guarantee me wealth. Amen.”',
  'Matthew 6:9 says: Here is an original prayer: “Father, Thy blessing guarantees wealth. Amen.”',
  'The Bible says: Here is an original prayer: “Father, Thy blessing guarantees wealth. Amen.”',
  'Here is a prayer: “Father, please guarantee me wealth. Amen.” (Matthew 6:9)',
  'Here is a prayer: “Father, please guarantee me wealth. Amen.” \u2014 Matthew 6:9',
  'Here is an original prayer: “Father, please guarantee me wealth. Amen. Matthew 6:9”',
  'Jesus said, here is a prayer: “Father, please guarantee me wealth. Amen.” (Matthew 6:9)',
  'Jesus said, here is a prayer: “Father, Thy blessing guarantees wealth. Amen.”',
  'Here is a prayer: “Father, Thy blessing guarantees wealth. Amen.” These are the exact words of Jesus.',
  'Jesus prayed. Here is a prayer: “Father, please guarantee me wealth. Amen.” (Matthew 6:9)',
  'Jesus prayed. Here is a prayer: “Father, Thy blessing guarantees wealth. Amen.”',
  'Jesus prayed:\n\nHere is a prayer: “Father, Thy blessing guarantees wealth. Amen.”',
  'David prayed. Here is a prayer: “Father, Thy blessing guarantees wealth. Amen.”',
  'Moses prayed: Here is a prayer: “Father, Thy blessing guarantees wealth. Amen.”',
  'Paul said, here is a prayer: “Father, Thy blessing guarantees wealth. Amen.”',
  'This is the full verse. Here is a prayer: “Father, Thy blessing guarantees wealth. Amen.”',
  'Here is a prayer: “Father, Thy blessing guarantees wealth. Amen.” This is the complete verse.',
  'Here is a prayer: “Father, verily Thou wilt give me wealth. Amen.”',
  'Here is an original prayer: “God promises every Christian wealth.” (John 3:16)',
  'Here is a prayer: “Father, Thy blessing guarantees wealth. Amen.” (KJV)',
  '“Our Father which art in heaven, Hallowed be thy name.”',
  'Matthew 6:9\nHere is a prayer:\n> 9 Father, please guarantee me wealth. Amen.',
]) {
  test(`source intent retains hard quotation checking: ${text}`, async () => {
    const result = await check(text);
    assert.equal(result.ok, false, JSON.stringify(result.issues));
    assert.ok(result.issues.some(issue => issue.severity === "error"));
    assert.ok(result.quotes.some(quote => quote.status === "failed"));
  });
}

test("a Scripture placeholder remains a canonical quotation even with prayer framing", async () => {
  const result = await check("Here is a prayer:\n\n[[SCRIPTURE:Matthew 6:9]]");
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.quotes[0].status, "verified");
  assert.ok(result.quotes[0].references.includes("Matthew 6:9"));
});

for (const [prefix, separator, tail] of [
  ["James 5:14-15 encourages someone sick to call elders. ", " ", 'Here is a prayer: “Father, please comfort me and grant healing according to Thy will. Amen.”'],
  ["", "\n", 'James 5:14-15 encourages the sick to call elders to pray over them, trusting the Lord’s care; it also speaks of forgiveness. It does not guarantee every illness healed. Here is a prayer: “Father, please comfort me and grant healing according to Thy will. Amen.”'],
]) {
  test(`observed generated passage keeps its own paragraph before original prayer: ${separator === " " ? "inline" : "single newline"}`, async () => {
    const result = await check(`${prefix}[[SCRIPTURE:James 5:14-15]]${separator}${tail}`);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    const canonical = result.quotes.find(quote => quote.status === "verified");
    const authored = result.quotes.find(quote => quote.status === "review");
    assert.ok(canonical);
    assert.ok(authored);
    assert.equal(result.quotes.length, 2);
    assert.equal(canonical.text, result.references.find(reference => reference.reference === "James 5:14-15").canonicalText);
    assert.equal(result.text.slice(canonical.start, canonical.end).split("\n").length, 2);
    assert.equal(result.text.slice(canonical.end).replace(/^\n+/, ""), `${separator === " " ? " " : ""}${tail}`);
    assert.ok(result.issues.every(issue => issue.severity === "review"));
    const second = await check(result.text);
    assert.equal(second.ok, true, JSON.stringify(second.issues));
    assert.equal(second.text, result.text);
  });
}

test("canonical marker paragraph padding is bounded and preserves exact offsets and tail prose", async () => {
  const canonical = (await chapter("KJV", 59, 5)).slice(13, 15);
  const body = canonical.map((verse, index) => `> ${index + 14} ${verse}`).join("\n");
  for (const separator of ["", " ", "\n", "\r\n", "\n\n", "\n\n\n\n"]) {
    const prefix = `Before.${separator}`;
    const suffix = `${separator}After.`;
    const result = await check(`${prefix}[[SCRIPTURE:James 5:14-15]]${suffix}`);
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    const leadingPadding = /\n[ \t\r]*\n[ \t\r]*$/.test(prefix) ? "" : /\n[ \t\r]*$/.test(prefix) ? "\n" : "\n\n";
    const trailingPadding = /^[ \t\r]*\n[ \t\r]*\n/.test(suffix) ? "" : /^[ \t\r]*\n/.test(suffix) ? "\n" : "\n\n";
    assert.equal(result.text, `${prefix}${leadingPadding}**James 5:14-15 (KJV)**\n${body}${trailingPadding}${suffix}`);
    assert.equal(result.quotes.length, 1);
    assert.equal(result.quotes[0].status, "verified");
    assert.equal(result.text.slice(result.quotes[0].start, result.quotes[0].end), body);
    for (const reference of result.references) assert.equal(result.text.slice(reference.start, reference.end), reference.sourceText);
    assert.equal((await check(result.text)).text, result.text);
  }
});

test("a short canonical prayer and its edition label cannot veto a separately composed prayer", async () => {
  const text = '[[SCRIPTURE:Matthew 6:9]] Here is a prayer: “Father, please help me according to Thy will. Amen.”';
  const result = await check(text);
  for (const checked of [result, await check(result.text)]) {
    assert.equal(checked.ok, true, JSON.stringify(checked.issues));
    assert.deepEqual(checked.quotes.map(quote => quote.status), ["verified", "review"]);
    assert.equal(checked.text, result.text);
    assert.equal(checked.references[0].reference, "Matthew 6:9");
    assert.ok(checked.issues.every(issue => issue.severity === "review"));
  }
});

test("original-language words inside composed prayer framing keep hard source checking", async () => {
  for (const word of ["אֱלֹהִים", "θεός"]) {
    const result = await check(`Here is a prayer: “Father, please help me. ${word} Amen.”`);
    assert.equal(result.ok, false, JSON.stringify(result.issues));
    assert.ok(result.issues.some(issue => issue.code === "quote_mismatch" && issue.severity === "error"));
    assert.equal(result.quotes[0].status, "failed");
  }
});

test("prayer framing cannot certify canonical words or bypass unavailable/negative semantic review", async () => {
  const text = 'Here is a prayer: “Our Father which art in heaven, Hallowed be thy name.”';
  const result = await check(text);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.quotes[0].status, "review");
  assert.equal(result.issues[0].severity, "review");
  for (const mode of ["negative", "unavailable", "positive"]) {
    let reviews = 0;
    const gated = await gateAnswer([{ id: "answer", text }], {
      check: async block => ({ ...block, ...await check(block.text) }),
      review: async blocks => {
        reviews++;
        assert.equal(blocks[0].quotes[0].status, "review");
        if (mode === "unavailable") throw Error("semantic reviewer unavailable");
        return { pass: mode === "positive", issues: mode === "positive" ? [] : ["source intent unresolved"], requiredReferences: [] };
      },
      repair: async () => { throw Error("Repair must not run in this read-only gate test"); },
      allowRepair: false,
      fallback: "Withheld",
    });
    assert.equal(reviews, 1);
    assert.equal(gated.verified, mode === "positive");
    assert.equal(gated.blocks[0].text, mode === "positive" ? text : "Withheld");
  }
});
