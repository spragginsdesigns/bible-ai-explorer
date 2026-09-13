import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(relative, mocks = {}) {
 const filename = path.resolve(relative);
 const module = { exports: {} };
 const localRequire = createRequire(filename);
 const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
 new Function("require", "module", "exports", source)(id => id in mocks ? mocks[id] : localRequire(id), module, module.exports);
 return module.exports;
}
const web = load("src/components/notes/noteTemplates.ts");
const native = load("mobile/src/features/notes/noteTemplates.ts");
const exporter = load("src/components/notes/noteMarkdownExport.ts");
const nativeExporter = load("mobile/src/features/notes/noteMarkdownExport.ts");
const paragraph = text => ({ type: "paragraph", content: [{ type: "text", text }] });
test("all template seeds match between clients and contain a valid editor document", () => {
 for (const id of ["verse-study", "sermon", "prayer", "blank"]) {
  const options = { now: new Date(2026, 8, 12, 12), churchName: 'My <church> & "friends"' };
  const seed = web.buildNoteTemplate(id, options);
  assert.deepEqual(seed, native.buildNoteTemplate(id, options));
  if (!seed) { assert.equal(id, "blank"); continue; }
  const document = JSON.parse(seed.content);
  assert.equal(document.type, "doc");
  assert.ok(document.content.length >= 6);
  assert.equal(seed.wordCount, seed.plainText.trim().split(/\s+/).length);
  assert.ok(!seed.html.includes("<church>"));
  assert.ok(!seed.title.includes("—"));
  assert.ok(!seed.plainText.includes("—"));
  assert.match(nativeExporter.noteDocumentToMarkdown(seed.title, document), /What I do next/);
 }
});
test("sermon uses most recent Sunday, preserves church as text, and omits missing church", () => {
 const saturday = web.buildNoteTemplate("sermon", { now: new Date(2026, 8, 12), churchName: 'A <script>alert(1)</script> & B' });
 assert.equal(saturday.title, "Sermon notes: Sunday, September 6, 2026");
 assert.match(saturday.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; B/);
 assert.match(saturday.plainText, /A <script>alert\(1\)<\/script> & B/);
 assert.equal(web.buildNoteTemplate("sermon", { now: new Date(2026, 8, 13) }).title, "Sermon notes: Sunday, September 13, 2026");
 assert.ok(!web.buildNoteTemplate("sermon").plainText.includes("My church:"));
});
test("web export preserves nested checked tasks, exact wikilinks and live title", () => {
 const html = '<ul data-type="taskList"><li data-checked="true"><p>Parent</p><ul data-type="taskList"><li data-checked="false"><p>Child [[Faith_and_works|My *label*]]</p></li></ul></li></ul>';
 const result = exporter.noteHtmlToMarkdown("Live title", html);
 assert.match(result, /^# Live title\n/);
 assert.match(result, /- \[x\] Parent/);
 assert.match(result, /\n    - \[ \] Child \[\[Faith_and_works\|My \*label\*\]\]/);
 assert.equal(exporter.noteHtmlToMarkdown("Same", "<h1>Same</h1><p>Body</p>"), "# Same\n\nBody\n");
});
test("native export preserves nested tasks, exact wikilinks, and rejects unknown content", () => {
 const doc = { type: "doc", content: [{ type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph("Parent"), { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [paragraph("Child [[Faith_and_works|My *label*]]")] }] }] }] }] };
 const result = nativeExporter.noteDocumentToMarkdown("Live title", doc);
 assert.match(result, /- \[x\] Parent/);
 assert.match(result, /\n    - \[ \] Child \[\[Faith_and_works\|My \*label\*\]\]/);
 assert.throws(() => nativeExporter.noteDocumentToMarkdown("Title", null));
 assert.throws(() => nativeExporter.noteDocumentToMarkdown("Title", { type: "doc", content: [{ type: "unknown", text: "Must not lose this" }] }));
 assert.equal(nativeExporter.noteDocumentToMarkdown("Empty", { type: "doc", content: [] }), "# Empty\n");
});
test("native create sends seed fields in one POST and propagates failures", async () => {
 const calls = [];
 const api = load("mobile/src/features/notes/api.ts", { "@/lib/api": { apiJson: async (...args) => { calls.push(args); throw new Error("offline"); } } });
 const seed = native.buildNoteTemplate("verse-study");
 const payload = { title: seed.title, folderId: "folder", content: seed.content, htmlContent: seed.html, plainText: seed.plainText, wordCount: seed.wordCount };
 await assert.rejects(api.createNote(async () => "token", payload), /offline/);
 assert.equal(calls.length, 1);
 assert.equal(calls[0][1], "/api/notes");
 assert.deepEqual(calls[0][2], { method: "POST", body: payload });
});

test("native export keeps literal paragraph prefixes as prose", () => {
 for (const [text, expected] of [["# Literal heading", "\\# Literal heading"], ["- literal dash", "\\- literal dash"], ["1. literal number", "1\\. literal number"], ["---", "\\---"], ["+ literal", "\\+ literal"]]) {
  assert.equal(nativeExporter.noteDocumentToMarkdown("Title", { type: "doc", content: [paragraph(text)] }), `# Title\n\n${expected}\n`);
 }
});
