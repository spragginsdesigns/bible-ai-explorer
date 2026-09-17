import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as icons from "lucide-react";
import ts from "typescript";
import { createMarkdownComponents } from "../src/components/markdownComponents.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
function load(path, exports, deps = {}) {
  const source = read(path).replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
  return new Function(...Object.keys(deps), `${stripTypeScriptTypes(source)}\nreturn {${exports.join(",")}}`)(...Object.values(deps));
}
const { resolveReference } = load("../src/lib/bible/books.ts", ["resolveReference"], { booksJson: JSON.parse(read("../src/data/books.json")) });
const { stripTranslationTag, TRANSLATION_TAGS, parseVerseReferences } = load("../src/utils/verseParser.ts", ["stripTranslationTag", "TRANSLATION_TAGS", "parseVerseReferences"], { resolveReference });
const { sharedPassageLink } = load("../src/lib/shared-passage.ts", ["sharedPassageLink"], { resolveReference, stripTranslationTag, TRANSLATION_TAGS });

test("public passage links retain the snapshot translation and complete range", () => {
  for (const version of ["KJV", "NKJV"]) {
    const link = new URL(sharedPassageLink("John 3:16-4:2", version).href);
    assert.equal(link.origin, "https://www.biblegateway.com");
    assert.equal(link.searchParams.get("version"), version);
    assert.equal(link.searchParams.get("search"), "John 3:16-4:2");
  }
});

test("explicit source tags win over the snapshot without entering the search string", () => {
  const link = new URL(sharedPassageLink("John 3:16 NKJV ", "KJV").href);
  assert.equal(link.searchParams.get("version"), "NKJV");
  assert.equal(link.searchParams.get("search"), "John 3:16");
});

// Render the shipped TSX and real Markdown map. Only unrelated footer/header
// controls are substituted; context and all verse/anchor rendering are real.
const modules = {
  react: React, "react/jsx-runtime": await import("react/jsx-runtime"),
  "next/link": ({ children, ...props }) => React.createElement("a", props, children),
  "react-markdown": ReactMarkdown, "remark-gfm": remarkGfm, "lucide-react": icons,
  "../markdownComponents": { createMarkdownComponents },
  "../../utils/verseParser": { parseVerseReferences },
  "@/lib/shared-passage": { sharedPassageLink },
  "./CopyShareLink": () => null, "./SharedDownloads": () => null,
};
const compiled = ts.transpileModule(read("../src/components/shared/SharedAnswerView.tsx"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const exports = {};
new Function("require", "exports", compiled)((name) => {
  if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
  return modules[name];
}, exports);

test("formatted citations become one public anchor, and ordinary local links keep their behavior", () => {
  const html = renderToStaticMarkup(React.createElement(exports.default, {
    question: "Test", translation: "NKJV", references: [],
    answer: "[**John 3:16**](/bible) and [*Romans 8:1*](/bible) and [See **John 3:16** for context](#context)",
  }));
  assert.match(html, /href="https:\/\/www.biblegateway.com\/passage\/\?search=John\+3%3A16&amp;version=NKJV"/);
  assert.match(html, /href="https:\/\/www.biblegateway.com\/passage\/\?search=Romans\+8%3A1&amp;version=NKJV"/);
  assert.doesNotMatch(html, /href="\/bible"/);
  assert.match(html, /<a href="#context" class=/);
  let depth = 0;
  for (const tag of html.matchAll(/<\/?a(?:\s[^>]*|)>/g)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    assert.ok(depth >= 0 && depth <= 1, "nested anchors must never render");
  }
  assert.equal(depth, 0);
});

test("BSB uses a reader that actually supplies BSB with canonical book identifiers", () => {
  assert.equal(sharedPassageLink("John 3:16", "BSB").href, "https://www.bible.com/bible/3034/JHN.3.16.BSB");
  assert.equal(sharedPassageLink("Psalm 23:1-6", "BSB").href, "https://www.bible.com/bible/3034/PSA.23.1-6.BSB");
  assert.equal(sharedPassageLink("John 3:16-4:2", "BSB").href, "https://www.bible.com/bible/3034/JHN.3.BSB");
  assert.equal(sharedPassageLink("John 3:16-4:2", "BSB").startingChapter, true);
  assert.equal(sharedPassageLink("Song of Songs 2:1", "BSB").href, "https://www.bible.com/bible/3034/SNG.2.1.BSB");
  assert.equal(sharedPassageLink("Rev.22:21", "BSB").href, "https://www.bible.com/bible/3034/REV.22.21.BSB");
});

test("unknown translations and invalid references stay unlinked instead of becoming KJV", () => {
  for (const version of ["", "unknown", "KJV&version=NIV"]) assert.equal(sharedPassageLink("John 3:16", version), null);
  for (const ref of ["John 25:1", "not scripture", "javascript:alert(1)", "John 3:16&version=NIV"]) assert.equal(sharedPassageLink(ref, "KJV"), null);
});
