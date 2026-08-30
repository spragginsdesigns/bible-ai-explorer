import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { createMarkdownComponents } from "../src/components/markdownComponents.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

/**
 * verseParser validates every candidate through resolveReference, which reaches
 * its data through the "@/" path alias the plain-node runner cannot resolve.
 * Same recipe verse-parser.test.mjs uses: drop the import lines, strip the
 * types, drop the `export` keywords, hand the dependency in. Still the REAL
 * parser - nothing here is a copy that can drift from what ships.
 */
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

const { resolveReference } = loadModule(
	"../src/lib/bible/books.ts",
	["resolveReference"],
	{ booksJson: JSON.parse(read("../src/data/books.json")) }
);
const { parseVerseReferences } = loadModule(
	"../src/utils/verseParser.ts",
	["parseVerseReferences"],
	{ resolveReference }
);

/**
 * These go through the REAL renderer map and the REAL verse parser. Only the
 * popover is stubbed, because it pulls in next/link and "use client"; it stands
 * in as <span data-verse="...">, so "was this reference wrapped" is assertable.
 */
const VerseRefStub = ({ reference, children }) =>
	React.createElement("span", { "data-verse": reference }, children);

const components = createMarkdownComponents({
	VerseRef: VerseRefStub,
	parseVerseReferences,
});

function render(markdown) {
	return renderToStaticMarkup(
		React.createElement(
			ReactMarkdown,
			{ remarkPlugins: [remarkGfm], components },
			markdown
		)
	);
}

/**
 * Tailwind's arbitrary variant as it appears once HTML-escaped in class="".
 * `*`, not `p`: the last block of a list item or a quote card can be a nested
 * list, a heading, a <pre> or a table wrapper, and the `p`-only selector left
 * every one of those stacking its bottom margin on the container's padding.
 */
const LAST_CHILD_NO_MARGIN = "[&amp;&gt;*:last-child]:mb-0";

/* ------------------------------------------------------------------ C1 --- */

test("C1: heading text is one flex item, so spaces around a verse ref survive", () => {
	const trailing = render("## 2 Peter 1:19 in the NKJV");
	assert.ok(
		trailing.includes('<span class="min-w-0">'),
		"h2 must wrap its processed children in a single element"
	);
	// The bug rendered "2 Peter 1:19in the NKJV": flexbox strips the leading and
	// trailing whitespace of every anonymous flex item.
	assert.ok(
		trailing.includes("</span> in the NKJV</span>"),
		`space after the verse ref was collapsed: ${trailing}`
	);

	const leading = render("### The verse John 3:16 matters");
	assert.ok(
		leading.includes('<span class="min-w-0">The verse <span'),
		`space before the verse ref was collapsed: ${leading}`
	);
	assert.ok(leading.includes("</span> matters</span>"), leading);

	const bold = render("## Reading **Psalm 46:10** slowly");
	assert.ok(bold.includes("</strong> slowly</span>"), bold);
});

test("C1: the heading icon is still the only sibling of the text", () => {
	const markup = render("## 2 Peter 1:19 in the NKJV");
	const inner = markup.slice(markup.indexOf(">") + 1, markup.lastIndexOf("</h2>"));
	assert.ok(inner.startsWith("<svg"), inner.slice(0, 40));
	assert.equal(
		inner.split('<span class="min-w-0">').length - 1,
		1,
		"exactly one text wrapper"
	);
});

/* ------------------------------------------------------------------ C2 --- */

test("C2: h4/h5/h6 are styled and still link verse references", () => {
	const markup = render(
		"### Context\n\n#### John 3:16 explained\n\n##### five\n\n###### six"
	);
	for (const tag of ["h4", "h5", "h6"]) {
		assert.match(
			markup,
			new RegExp(`<${tag} class="[^"]+"`),
			`${tag} rendered without a className`
		);
	}
	assert.ok(
		markup.includes('<h4 class="') &&
			markup.includes('<span data-verse="John 3:16">John 3:16</span> explained'),
		markup
	);
});

test("C2: links are visible, and external ones are target/rel hardened", () => {
	const markup = render(
		"Read more at [Blue Letter Bible](https://blueletterbible.org) and see [John 3:16](/bible/chapter?book=43)."
	);
	assert.match(markup, /<a href="https:\/\/blueletterbible\.org"[^>]*class="[^"]*amber/);
	assert.ok(markup.includes('target="_blank"'), markup);
	assert.ok(markup.includes('rel="noopener noreferrer"'), markup);
	// An in-app href must not open a new tab.
	const internal = markup.slice(markup.indexOf('<a href="/bible'));
	assert.ok(!internal.includes('target="_blank"'), internal);
	// A verse popover is a <button>; nesting one inside an <a> is invalid, so
	// anchor text is deliberately left unprocessed.
	assert.ok(!markup.includes("data-verse"), markup);
});

test("C2: a protocol-relative link is hardened like any other external one", () => {
	// "//archive.org/x" borrows the page's scheme and leaves the app just as
	// surely as "https://" does; only matching /^https?:/ left it unhardened.
	const markup = render("See [the archive](//archive.org/x).");
	assert.ok(markup.includes('href="//archive.org/x"'), markup);
	assert.ok(markup.includes('target="_blank"'), markup);
	assert.ok(markup.includes('rel="noopener noreferrer"'), markup);
});

test("C2: a table keeps the column alignment the model asked for", () => {
	const markup = render(
		"| Reference | Words |\n| :--- | ---: |\n| John 3:16 | For God so loved |"
	);
	// remark-gfm expresses alignment as an inline style on every cell of the
	// column; the renderers dropped it, so every column came out left-aligned.
	assert.match(markup, /<th style="text-align:right"/, markup);
	assert.match(markup, /<td style="text-align:right"/, markup);
	assert.match(markup, /<th style="text-align:left"/, markup);
});

test("C2: a table scrolls inside its own wrapper and links refs in cells", () => {
	const markup = render(
		"| Reference | Text |\n| --- | --- |\n| John 3:16 | For God so loved the world |"
	);
	assert.match(markup, /<div class="[^"]*overflow-x-auto"><table class="[^"]+"/);
	assert.match(markup, /<th class="[^"]+"/);
	assert.match(markup, /<td class="[^"]+"/);
	assert.ok(
		markup.includes('<td class="border border-black/[0.1] dark:border-white/[0.1] px-3 py-2 align-top"><span data-verse="John 3:16">'),
		markup
	);
});

test("C2: code blocks scroll, inline code gets its own chrome", () => {
	const block = render(
		"```js\nconst verylonglineofcodethatkeepsgoingandgoing = 1;\n```"
	);
	assert.match(block, /<pre class="[^"]*overflow-x-auto/);
	assert.ok(block.includes("language-js"), block);
	// Block code must NOT also get the inline pill background.
	assert.ok(!/<code class="[^"]*rounded bg-black/.test(block), block);

	const inline = render("Use `md.render()` for that.");
	assert.match(inline, /<code class="[^"]*rounded bg-black/);
});

test("C2: hr, del and img are rendered with styling", () => {
	const markup = render("---\n\n~~gone~~\n\n![alt text](/static/a.png)");
	assert.match(markup, /<hr class="[^"]+"/);
	assert.match(markup, /<del class="[^"]*line-through/);
	assert.match(markup, /<img src="\/static\/a\.png" alt="alt text" class="[^"]*max-w-full/);
});

test("C2: a source react-markdown sanitized away renders nothing at all", () => {
	// react-markdown's urlTransform does not drop a disallowed image, it rewrites
	// the src to "". `<img src="">` makes the browser re-request the page itself
	// and paint a broken-image box mid-answer, so the renderer must return null.
	for (const vector of [
		"![chart](data:image/png;base64,iVBORw0KGgo=)",
		"![x](javascript:alert(1))",
	]) {
		const markup = render(vector);
		assert.ok(!markup.includes("<img"), `${vector} rendered an <img>: ${markup}`);
		assert.ok(!markup.includes('src=""'), markup);
	}
	// A real source is untouched by the guard.
	assert.match(render("![ok](/static/a.png)"), /<img src="\/static\/a\.png"/);
});

/* ------------------------------------------------------------------ C5 --- */

test("C5: an ordered list keeps the number the model started on", () => {
	assert.ok(render("3. The third point\n4. The fourth point").includes('<ol start="3"'));
	// A list that really does start at 1 must not gain a redundant attribute.
	assert.ok(!render("1. First\n2. Second").includes("<ol start="));
});

test("C5: a task item carries exactly one marker", () => {
	const markup = render("- [ ] Read John 3:16 today\n- [x] Pray for the lost");
	assert.equal(
		markup.split("<svg").length - 1,
		0,
		"the CheckCircle bullet must be suppressed on task items"
	);
	assert.equal(markup.split('<input type="checkbox"').length - 1, 2);
	assert.ok(markup.includes('checked=""'), "the [x] item must render as checked");
	// The verse reference inside the task item still links.
	assert.ok(markup.includes('data-verse="John 3:16"'), markup);
});

test("C5: loose and tight bullet lists land on the same spacing classes", () => {
	const classesOf = (markup) =>
		[...markup.matchAll(/<(?:li|div) class="([^"]+)"/g)].map((m) => m[1]);
	const tight = classesOf(render("- First point about grace.\n- Second point about faith."));
	const loose = classesOf(render("- First point about grace.\n\n- Second point about faith."));
	assert.deepEqual(loose, tight);
	assert.ok(tight.some((c) => c.includes(LAST_CHILD_NO_MARGIN)), tight.join(" | "));
});

test("C5: a loose list item puts its <p> in a <div>, never in a <span>", () => {
	const markup = render("- Para one.\n\n  Para two.");
	assert.ok(!/<span[^>]*>\s*<p[ >]/.test(markup), markup);
	assert.match(markup, /<div class="min-w-0 flex-1[^"]*">\s*<p/);
});

test("C5: an empty streaming blockquote paints nothing", () => {
	for (const vector of ["Here is **John 3:16**:\n\n> ", "> ", ">", "> \n"]) {
		assert.ok(
			!render(vector).includes("<blockquote"),
			`empty blockquote card rendered for ${JSON.stringify(vector)}`
		);
	}
});

test("C5: a blockquote holding only an image or a rule is not treated as empty", () => {
	// Every child of a blockquote is built from the renderer map, so its
	// `type` is a function and never "img"/"hr". Testing element.type let
	// these two subtrees look blank, and the whole quote vanished.
	const image = render("> ![The empty tomb](/static/tomb.png)");
	assert.ok(image.includes("<blockquote"), image);
	assert.match(image, /<img src="\/static\/tomb\.png"/, image);

	const rule = render("> ---");
	assert.ok(rule.includes("<blockquote"), rule);
	assert.match(rule, /<hr class="[^"]+"/, rule);
});

test("C5: a real blockquote still renders, with its last paragraph margin removed", () => {
	const markup = render('> "For God so loved the world"\n>\n> John 3:16');
	assert.ok(markup.includes("<blockquote"), markup);
	assert.ok(markup.includes("font-[family-name:var(--font-cormorant)]"), markup);
	assert.match(markup, new RegExp(`<div class="min-w-0 flex-1 ${escapeRe(LAST_CHILD_NO_MARGIN)}"`));
	assert.ok(markup.includes('data-verse="John 3:16"'), markup);
});

test("C5: supporting blockquotes keep the body family instead of Scripture type", () => {
	const markup = render("> A helpful study note without a verse reference");
	assert.ok(markup.includes("<blockquote"), markup);
	assert.ok(!markup.includes("font-[family-name:var(--font-cormorant)]"), markup);
});

test("C5: the flush selector covers a card or item that ends in a non-paragraph", () => {
	// Every one of these ends in a block that carries its own mb-4/my-4 and is
	// NOT a <p>: with `[&>p:last-child]` the margin stacked on the container's
	// bottom padding and the card gained a ragged extra gap.
	const enders = [
		["a bullet list", "> intro\n>\n> - a\n> - b", "<ul"],
		["an ordered list", "> intro\n>\n> 1. a\n> 2. b", "<ol"],
		["a heading", "> intro\n>\n> ## Heading", "<h2"],
		["a fenced block", "> intro\n>\n> ```\n> code\n> ```", "<pre"],
		["a table", "> intro\n>\n> | a | b |\n> | --- | --- |\n> | 1 | 2 |", "<table"],
	];
	for (const [label, markdown, tag] of enders) {
		const markup = render(markdown);
		assert.ok(markup.includes(tag), `${label}: expected ${tag} in ${markup}`);
		assert.match(
			markup,
			new RegExp(`<div class="min-w-0 flex-1 ${escapeRe(LAST_CHILD_NO_MARGIN)}"`),
			`${label}: quote body lost the flush class`
		);
	}

	// A list item that ends in a nested list is the same shape, one level down.
	const nested = render("- outer\n\n  - inner one\n  - inner two");
	assert.ok(nested.includes("<ul"), nested);
	assert.ok(
		nested.includes(LAST_CHILD_NO_MARGIN),
		`nested list item lost the flush class: ${nested}`
	);

	// And the p-only selector is gone from the map entirely.
	for (const markup of [
		render("- a\n- b"),
		render("1. a\n2. b"),
		render("- [ ] task"),
		render("> quoted"),
	]) {
		assert.ok(
			!markup.includes("[&amp;&gt;p:last-child]"),
			`the p-only flush selector survives: ${markup}`
		);
	}
});

function escapeRe(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
