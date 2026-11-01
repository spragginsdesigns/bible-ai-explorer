import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import test, { after } from "node:test";
import { markdownToNoteHtml, htmlToPlainText, countWords } from "../src/lib/markdown.ts";
import { htmlToPlainText as mobilePlainText } from "../mobile/src/features/notes/utils.ts";
import { NOTE_HOUSE_STYLE } from "../src/utils/noteHouseStyle.ts";

const originalFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = () => { fetches += 1; throw Error("offline serialization test forbids network"); };
after(() => { globalThis.fetch = originalFetch; assert.equal(fetches, 0); });

const require = createRequire(import.meta.url);
const ts = require("typescript");
const { tool } = await import(require.resolve("ai"));
const { z } = await import(require.resolve("zod"));
const tiptapRequire = createRequire(require.resolve("@tiptap/react"));
const { Editor, getSchema } = await import(tiptapRequire.resolve("@tiptap/core"));
const starter = await import(require.resolve("@tiptap/starter-kit"));
const starterKit = starter.StarterKit ?? starter.default?.StarterKit ?? starter.default?.default ?? starter.default;
const taskList = await import(require.resolve("@tiptap/extension-task-list"));
const taskItem = await import(require.resolve("@tiptap/extension-task-item"));
const schema = getSchema([starterKit, taskList.TaskList, taskItem.TaskItem.configure({ nested: true })]);
const { DOMParser, DOMSerializer } = tiptapRequire("@tiptap/pm/model");
const { createDocument } = createRequire(require.resolve("turndown"))("@mixmark-io/domino");
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tree = (path) => ts.createSourceFile(path, source(path), ts.ScriptTarget.Latest, true);
function findNode(path, predicate) {
	let found;
	const visit = (node) => { if (predicate(node)) found = node; ts.forEachChild(node, visit); };
	visit(tree(path));
	assert.ok(found, `actual production declaration in ${path}`);
	return found;
}
function expression(name) {
	return stripTypeScriptTypes(`(${findNode("src/lib/ai-tools.ts", (node) => ts.isVariableDeclaration(node) && node.name.getText() === name).initializer.getText()})`);
}
const verifyDeclaration = findNode("src/lib/study-tools.ts", (node) => ts.isFunctionDeclaration(node) && node.name?.text === "verifyGeneratedWriteBlocks");
const verifyGeneratedWriteBlocks = new Function(`${stripTypeScriptTypes(verifyDeclaration.getText().replace(/^export /, ""))}; return verifyGeneratedWriteBlocks;`)();
const GENERATED_WRITE_VERIFICATION_ERROR = "I couldn't verify the Scripture in this content, so nothing was saved. Retrieve the supporting passages, correct the content, and try again.";
const seed = "QA immutable seed synthetic-owned-marker";
const old = "QA_OLD_synthetic-owned-marker";
const next = "QA_NEW_synthetic-owned-marker";
const initialHTML = `<p>${seed}</p><p>${old}</p>`;
const textNode = (text) => ({ type: "text", text });
const paragraph = (...content) => ({ type: "paragraph", ...(content.length ? { content } : {}) });
const br = { type: "hardBreak" };
const cases = [
	{ name: "soft LF", markdown: `${seed}\n${next}`, expected: `${seed}\n${next}`, blocks: [paragraph(textNode(seed), br, textNode(next))] },
	{ name: "Markdown paragraphs", markdown: `${seed}\n\n${next}`, expected: `${seed}\n${next}`, blocks: [paragraph(textNode(seed)), paragraph(textNode(next))] },
	{ name: "two-space hard break", markdown: `${seed}  \n${next}`, expected: `${seed}\n${next}`, blocks: [paragraph(textNode(seed), br, textNode(next))] },
	{ name: "backslash hard break", markdown: `${seed}\\\n${next}`, expected: `${seed}\n${next}`, blocks: [paragraph(textNode(seed), br, textNode(next))] },
	{ name: "supplied HTML paragraphs", markdown: `<p>${seed}</p><p>${next}</p>`, expected: `${seed}\n${next}`, exactHTML: `<p>${seed}</p><p>${next}</p>`, blocks: [paragraph(textNode(seed)), paragraph(textNode(next))] },
	{ name: "HTML soft whitespace", markdown: `<p>${seed}\n${next}</p>`, expected: `${seed} ${next}`, exactHTML: `<p>${seed}\n${next}</p>`, blocks: [paragraph(textNode(`${seed} ${next}`))] },
	{ name: "three explicit breaks", markdown: `<p>${seed}<br><br><br>${next}</p>`, expected: `${seed}\n\n\n${next}`, exactHTML: `<p>${seed}<br><br><br>${next}</p>`, blocks: [paragraph(textNode(seed), br, br, br, textNode(next))] },
	{ name: "two empty paragraphs", markdown: `<p>${seed}</p><p></p><p></p><p>${next}</p>`, expected: `${seed}\n\n\n${next}`, exactHTML: `<p>${seed}</p><p></p><p></p><p>${next}</p>`, blocks: [paragraph(textNode(seed)), paragraph(), paragraph(), paragraph(textNode(next))] },
	{ name: "inline formatting spaces", markdown: `<p><strong>${seed}</strong> <a href="https://example.invalid/">${next}</a> end</p>`, expected: `${seed} ${next} end`, exactHTML: `<p><strong>${seed}</strong> <a href="https://example.invalid/">${next}</a> end</p>`, blocks: [paragraph({ ...textNode(seed), marks: [{ type: "bold" }] }, textNode(" "), { ...textNode(next), marks: [{ type: "link", attrs: { href: "https://example.invalid/" } }] }, textNode(" end"))] },
	{ name: "nested quote and list", markdown: "<blockquote><ul><li><p>A</p></li></ul></blockquote><p>B</p>", expected: "A\nB", blocks: [{type:"blockquote",content:[{type:"bulletList",content:[{type:"listItem",content:[paragraph(textNode("A"))]}]}]},paragraph(textNode("B"))] },
	{ name: "nested list", markdown: "<ul><li><p>A</p><ul><li><p>B</p></li></ul></li><li><p>C</p></li></ul>", expected: "A\nB\nC", blocks: [{type:"bulletList",content:[{type:"listItem",content:[paragraph(textNode("A")),{type:"bulletList",content:[{type:"listItem",content:[paragraph(textNode("B"))]}]}]},{type:"listItem",content:[paragraph(textNode("C"))]}]}] },
	{ name: "task item div and label", markdown: '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>A</p></div></li></ul><p>B</p>', expected: "A\nB", blocks: [{type:"taskList",content:[{type:"taskItem",attrs:{checked:false},content:[paragraph(textNode("A"))]}]},paragraph(textNode("B"))] },
	{ name: "bare list item", markdown: "<ul><li>A</li><li>B</li></ul>", expected: "A\nB", blocks: [{type:"bulletList",content:[{type:"listItem",content:[paragraph(textNode("A"))]},{type:"listItem",content:[paragraph(textNode("B"))]}]}] },
	{ name: "multi paragraph list item", markdown: "<ol><li><p>A</p><p>B</p></li><li><p>C</p></li></ol>", expected: "A\nB\nC", blocks: [{type:"orderedList",content:[{type:"listItem",content:[paragraph(textNode("A")),paragraph(textNode("B"))]},{type:"listItem",content:[paragraph(textNode("C"))]}]}] },
	{ name: "empty list item", markdown: "<ul><li><p>A</p></li><li></li><li><p>C</p></li></ul>", expected: "A\n\nC", blocks: [{type:"bulletList",content:[{type:"listItem",content:[paragraph(textNode("A"))]},{type:"listItem",content:[paragraph()]},{type:"listItem",content:[paragraph(textNode("C"))]}]}] },
	{ name: "empty task item", markdown: '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>A</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div></div></li><li data-type="taskItem" data-checked="false"><div><p>C</p></div></li></ul>', expected: "A\n\nC", blocks: [{type:"taskList",content:[{type:"taskItem",attrs:{checked:true},content:[paragraph(textNode("A"))]},{type:"taskItem",attrs:{checked:false},content:[paragraph()]},{type:"taskItem",attrs:{checked:false},content:[paragraph(textNode("C"))]}]}] },
	{ name: "empty paragraph inside quote", markdown: "<blockquote><p>A</p><p></p><ul><li><p>B</p></li></ul></blockquote>", expected: "A\n\nB", blocks: [{type:"blockquote",content:[paragraph(textNode("A")),paragraph(),{type:"bulletList",content:[{type:"listItem",content:[paragraph(textNode("B"))]}]}]}] },
	{ name: "literal pre whitespace", markdown: "<pre><code> A\n\n\nB </code></pre><p>C</p>", expected: " A\n\n\nB \nC", blocks: [{type:"codeBlock",content:[textNode(" A\n\n\nB ")]},paragraph(textNode("C"))] },
];
for (const item of cases) if (item.markdown.startsWith("<")) item.exactHTML = item.markdown;

async function actualUpdate(markdown, accept = true, operationOwner = "synthetic-owner", append = false) {
	const row = { id: "synthetic-note", userId: "synthetic-owner", title: "QA note", htmlContent: initialHTML, content: initialHTML, plainText: `${seed}\n${old}`, wordCount: 6, aliases: [], properties: null, tags: [], folder: null, isPinned: false, updatedAt: new Date("2026-10-30T00:00:00Z") };
	const writes = [], events = [];
	const db = { note: {
		findFirst: async (query) => { assert.equal(query.where.id, row.id); assert.equal(query.where.userId, row.userId); events.push("owned-read"); return structuredClone(row); },
		update: async (query) => { assert.equal(query.where.id, row.id); writes.push(structuredClone(query.data)); events.push("write"); Object.assign(row, query.data); return structuredClone(row); },
	} };
	const injected = {
		Prisma: { DbNull: null }, prisma: db, countWords, htmlToPlainText, markdownToNoteHtml,
		searchNoteEmbeddings: async () => { throw Error("search not permitted"); },
		syncNoteEmbeddings: async () => { assert.equal(events.at(-1), "commit"); events.push("embedding-stub"); },
		resolvePendingLinks: async () => { events.push("resolve-stub"); }, syncNoteLinks: async () => { events.push("links-stub"); },
		validateProperties: (value) => ({ ok: true, value }),
		withNoteAIWrite: async (operation, write) => { assert.equal(operation.userId, row.userId); assert.equal(operation.noteId, row.id); events.push("begin-stub"); const result = await write(db); events.push("commit"); return result; },
	};
	const notesCode = source("src/lib/notes-io.ts").replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, "");
	const { rewriteNote, readUserNote, appendMarkdownToNote } = new Function(...Object.keys(injected), `${stripTypeScriptTypes(notesCode, { mode: "transform" })}; return { rewriteNote, readUserNote, appendMarkdownToNote };`)(...Object.values(injected));
	const context = { userId: row.userId, defaultNoteId: row.id, noteOperation: { id: "synthetic-operation", userId: operationOwner, noteId: row.id }, verifyGeneratedContent: async (blocks) => { assert.equal(blocks[0].text, markdown); events.push("verify"); return accept ? blocks : null; } };
	const values = { context, tool, z, readUserNote, rewriteNote, appendMarkdownToNote, NOTE_HOUSE_STYLE, verifyGeneratedWriteBlocks, GENERATED_WRITE_VERIFICATION_ERROR };
	const readTool = new Function(...Object.keys(values), `return ${expression("readNoteTool")};`)(...Object.values(values));
	const updateTool = new Function(...Object.keys(values), `return ${expression(append ? "addToNoteTool" : "updateNoteTool")};`)(...Object.values(values));
	assert.equal((await readTool.execute({ noteId: row.id })).htmlContent, initialHTML);
	let error;
	try { await updateTool.execute(updateTool.inputSchema.parse({ noteId: row.id, markdown })); } catch (failure) { error = failure; }
	return { row, writes, events, error };
}

const bodyFor = findNode("src/components/notes/TiptapEditor.tsx", (node) => ts.isVariableDeclaration(node) && node.name.getText() === "bodyFor").initializer;
const actualDraft = new Function("htmlToPlainText", `return ${stripTypeScriptTypes(`(${bodyFor.getText()})`)};`)(htmlToPlainText);
const saveTry = findNode("src/components/notes/TiptapEditor.tsx", (node) => ts.isTryStatement(node) && node.tryBlock.getText().includes("const text = "));
const actualSave = new Function("editor", "htmlToPlainText", `let data; ${stripTypeScriptTypes(saveTry.tryBlock.getText())}; return data;`);
function realEditor(blocks, html) {
	const dom = createDocument(`<html><body>${html}</body></html>`);
	// Domino predates iterable DOMTokenList; real browsers provide this.
	const tokenList = Object.getPrototypeOf(dom.createElement("code").classList);
	if (!tokenList[Symbol.iterator]) Object.defineProperty(tokenList, Symbol.iterator, { value: Array.prototype[Symbol.iterator] });
	const doc = DOMParser.fromSchema(schema).parse(dom.body);
	const output = dom.createElement("div");
	output.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(doc.content, { document: dom }));
	return { state: { doc }, schema, getText(options) { return Editor.prototype.getText.call(this, options); }, getJSON() { return doc.toJSON(); }, getHTML() { return output.innerHTML; } };
}

for (const item of cases) {
	test(`actual verified updateNote and installed web save: ${item.name}`, async () => {
		const result = await actualUpdate(item.markdown);
		assert.equal(result.error, undefined);
		assert.equal(result.writes.length, 1);
		assert.equal(result.row.plainText, item.expected);
		assert.equal(result.row.wordCount, countWords(item.expected));
		assert.ok(!result.row.plainText.includes(old));
		if (item.markdown.includes(next)) assert.ok(result.row.plainText.includes(next));
		if (item.exactHTML) assert.equal(result.row.htmlContent, item.exactHTML, "supplied HTML remains byte-exact");
		const editor = realEditor(item.blocks, result.row.htmlContent);
		for (const body of [actualDraft(editor), actualSave(editor, htmlToPlainText)]) {
			assert.equal(body.plainText, item.expected);
			assert.equal(body.htmlContent, editor.getHTML());
			assert.equal(body.wordCount, result.row.wordCount);
		}
		// Canonical client saves read the editor's normalized HTML. Soft raw HTML
		// whitespace is deliberately normalized by the real Native parser below.
		if (item.exactHTML) assert.equal(mobilePlainText(result.row.htmlContent), item.expected);
	});
}

test("actual tool refusal retains the original note and performs zero writes", async () => {
	const result = await actualUpdate(`${seed}\n${next}`, false);
	assert.equal(result.error?.message, GENERATED_WRITE_VERIFICATION_ERROR);
	assert.equal(result.writes.length, 0);
	assert.equal(result.row.htmlContent, initialHTML);
	assert.ok(!result.events.includes("begin-stub"));
});

test("actual write ownership fence still rejects a mismatched operation", async () => {
	const result = await actualUpdate(`${seed}\n${next}`, true, "foreign-owner");
	assert.ok(result.error);
	assert.equal(result.writes.length, 0);
	assert.equal(result.row.htmlContent, initialHTML);
});

test("visible extraction distinguishes layout whitespace, inline spaces, and explicit breaks", () => {
	assert.equal(htmlToPlainText("<p>A</p>\n  <p>B</p>"), "A\nB");
	assert.equal(htmlToPlainText("<p><strong>A</strong> \n <a href='x'>B</a></p>"), "A B");
	assert.equal(htmlToPlainText("<p>A<br><br/><br /><br>B</p>"), "A\n\n\n\nB");
	assert.equal(htmlToPlainText("<p>A</p>\n<p></p>\n<p></p>\n<p>B</p>"), "A\n\n\nB");
	assert.equal(htmlToPlainText("<pre><code>A\n\n\nB</code></pre>"), "A\n\n\nB");
	assert.equal(htmlToPlainText("<p>A &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;&nbsp;e</p>"), "A <b> & \"c\" 'd' e");
	assert.equal(htmlToPlainText("A\n\n\nB"), "A\n\n\nB");
	assert.equal(htmlToPlainText("<style>x</style><p>A</p><!--not text--><script>x</script>"), "A");
	assert.equal(htmlToPlainText('<p><a title="x > y">A</a> <strong>B</strong></p>'), "A B");
});

test("note-local soft breaks do not change global marked behavior or active-content guards", async () => {
	const { marked } = await import(require.resolve("marked"));
	const before = marked.parse("A\nB", { async: false });
	assert.equal(markdownToNoteHtml("A\nB"), "<p>A<br>B</p>");
	assert.equal(marked.parse("A\nB", { async: false }), before);
	assert.equal(markdownToNoteHtml('<p>A</p><script>x()</script><a onclick="x()" href="javascript:x()">B</a>'), "<p>A</p><a>B</a>");
});

test("installed Editor default proves why canonical saves must extract leaf blocks", () => {
	const editor = realEditor([paragraph(textNode("A")), paragraph(textNode("B"))], "<p>A</p><p>B</p>");
	assert.equal(editor.getText(), "A\n\nB");
	assert.equal(actualDraft(editor).plainText, "A\nB");
	assert.equal(actualSave(editor, htmlToPlainText).plainText, "A\nB");
});

// Appending retains the existing HTML and existing separator contract; only
// newly normalized Markdown receives explicit soft breaks.
test("actual append tool preserves the saved prefix and its operation fence", async () => {
	const result = await actualUpdate("New first line\nNew second line", true, "synthetic-owner", true);
	assert.equal(result.error, undefined);
	assert.equal(result.writes.length, 1);
	assert.equal(result.row.htmlContent, `${initialHTML}\n<p>New first line<br>New second line</p>`);
	assert.equal(result.row.plainText, `${seed}\n${old}\n\nNew first line\nNew second line`);
	assert.equal(result.events.filter((event) => event === "begin-stub").length, 1);
});

test("installed Editor separators also count nested structural wrappers", () => {
 for (const item of cases.filter(item => ["nested quote and list", "nested list"].includes(item.name))) {
  const editor = realEditor(item.blocks, item.markdown);
  assert.notEqual(editor.getText({ blockSeparator: "\n" }), item.expected);
  assert.equal(actualDraft(editor).plainText, item.expected);
  assert.equal(actualSave(editor, htmlToPlainText).plainText, item.expected);
 }
});

test("legacy div and row leaves retain separators without duplicating descendant blocks", () => {
 const legacy = [
  ["<div>A</div><div>B</div>", "A\nB"],
  ["<table><tr><td>A</td></tr><tr><td>B</td></tr></table>", "A\nB"],
  ["<div><p>A</p><div><p>B</p></div></div><p>C</p>", "A\nB\nC"],
  ["<div>A</div><div></div><div>B</div>", "A\n\nB"],
 ];
 for (const [html, expected] of legacy) {
  assert.equal(htmlToPlainText(html), expected);
  assert.equal(mobilePlainText(html), expected);
 }
});

test("actual installed web DOM parser retains direct div leaves and drops wrapper-only divs", () => {
 for (const [html, expected] of [
  ["<div>A</div><div>B</div>", "A\nB"],
  ["<div><p>A</p><div><p>B</p></div></div><p>C</p>", "A\nB\nC"],
  ["<div>A<p>B</p>C</div>", "A\nB\nC"],
 ]) {
  const editor = realEditor([], html);
  assert.equal(actualDraft(editor).plainText, expected);
  assert.equal(actualSave(editor, htmlToPlainText).plainText, expected);
  assert.equal(htmlToPlainText(html), expected);
 }
});

test("raw script/style less-than contents cannot swallow later visible text", () => {
 const cases = [
  [
    "raw script less-than",
    "<script>if (a<b) alert(1)</script><p>Visible safe words</p>",
    "Visible safe words"
  ],
  [
    "raw style less-than",
    "<style>.x:before{content:\"<b\"}</style><p>Visible safe words</p>",
    "Visible safe words"
  ],
  [
    "escaped markup remains text",
    "<p>&lt;script&gt;if (a&lt;b) alert(1)&lt;/script&gt; &lt;style&gt;.x&lt;b&lt;/style&gt;</p>",
    "<script>if (a<b) alert(1)</script> <style>.x<b</style>"
  ]
];
 for (const [name, html, expected] of cases) {
  assert.equal(htmlToPlainText(html), expected, name);
  assert.equal(mobilePlainText(html), expected, name);
 }
});
