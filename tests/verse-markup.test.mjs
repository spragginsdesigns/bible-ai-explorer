/**
 * NKJV markup stripping for verse actions (web/Android parity).
 *
 * bolls.life wraps supplied words in <i> tags; Android strips that markup via
 * bibleVersePlainText before insight/copy/share/save/Ask-AI. The web port in
 * src/lib/bible/verseMarkup.ts must agree with the phone's module on every
 * input, and the web verse-actions helpers must emit plain text even when
 * handed raw provider markup. Both modules are instantiated from their REAL
 * source the way verse-parity.test.mjs does it, so editing either side is
 * seen here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

const read = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
  const source = read(relativePath)
    .replace(/^import\s[^;]*?;\s*$/gm, "")
    .replace(/^export /gm, "");
  const names = Object.keys(injected);
  const factory = new Function(
    ...names,
    `${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`
  );
  return factory(...names.map((name) => injected[name]));
}

const webMarkup = loadModule("../src/lib/bible/verseMarkup.ts", [
  "parseBibleVerseMarkup",
  "bibleVersePlainText",
]);
const androidMarkup = loadModule("../mobile/src/features/bible/verseMarkup.ts", [
  "bibleVersePlainText",
]);
const webActions = (fetch) =>
  loadModule(
    "../src/lib/bible/verseActions.ts",
    ["formatVerseForSharing", "saveVerseToNote"],
    { bibleVersePlainText: webMarkup.bibleVersePlainText, fetch }
  );

const NKJV_JOB_1_8 =
  "a <i>blameless and</i> upright man, one who fears God and shuns evil?";
const NKJV_JOB_1_8_PLAIN =
  "a blameless and upright man, one who fears God and shuns evil?";

const VECTORS = [
  NKJV_JOB_1_8,
  "<i>For God</i> so loved the <em>world</em>, that he gave his only begotten Son",
  "A Psalm <span class=\"x\">of</span> David.", // unsupported tags are discarded
  "fish &amp; loaves &quot;broken&quot; &#8212; shared", // entities decode
  "He maketh me to lie down in green pastures", // bundled KJV hot path
  "", // empty verse
  "<i>unclosed emphasis keeps its text",
];

test("web and Android plain-text stripping agree on every vector", () => {
  for (const input of VECTORS) {
    assert.equal(
      webMarkup.bibleVersePlainText(input),
      androidMarkup.bibleVersePlainText(input),
      `clients disagree on ${JSON.stringify(input)}`
    );
  }
});

test("web stripping: tags gone, entities decoded, plain text untouched", () => {
  assert.equal(webMarkup.bibleVersePlainText(NKJV_JOB_1_8), NKJV_JOB_1_8_PLAIN);
  assert.equal(
    webMarkup.bibleVersePlainText("fish &amp; loaves &quot;broken&quot;"),
    'fish & loaves "broken"'
  );
  const kjv = "He maketh me to lie down in green pastures";
  assert.equal(webMarkup.bibleVersePlainText(kjv), kjv);
  assert.deepEqual(webMarkup.parseBibleVerseMarkup(NKJV_JOB_1_8), [
    { text: "a ", italic: false },
    { text: "blameless and", italic: true },
    { text: " upright man, one who fears God and shuns evil?", italic: false },
  ]);
});

test("formatVerseForSharing strips markup from the shared body", () => {
  const { formatVerseForSharing } = webActions(fetch);
  assert.equal(
    formatVerseForSharing(
      { reference: "Job 1:8", text: NKJV_JOB_1_8, translation: "NKJV" },
      "NKJV"
    ),
    `Job 1:8 — "${NKJV_JOB_1_8_PLAIN}" (NKJV)`
  );
});

test("saveVerseToNote stores plain text, no provider markup", async () => {
  const calls = [];
  const stubFetch = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "POST") return { ok: true, json: async () => ({ id: "note-1" }) };
    return { ok: true, json: async () => ({}) };
  };
  const { saveVerseToNote } = webActions(stubFetch);
  const id = await saveVerseToNote(
    { reference: "Job 1:8", text: NKJV_JOB_1_8 },
    "NKJV"
  );
  assert.equal(id, "note-1");
  const patch = calls.find((call) => call.init.method === "PATCH");
  const body = JSON.parse(patch.init.body);
  assert.ok(!body.htmlContent.includes("<i>"), "note HTML kept provider markup");
  assert.ok(body.htmlContent.includes(NKJV_JOB_1_8_PLAIN));
  assert.equal(body.plainText, `Job 1:8 — "${NKJV_JOB_1_8_PLAIN}" (NKJV)`);
});
