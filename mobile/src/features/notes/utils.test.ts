import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { htmlToPlainText, initialHtmlFor, relativeTime } from "./utils";

describe("htmlToPlainText", () => {
	it("returns an empty string for empty input", () => {
		expect(htmlToPlainText("")).toBe("");
	});

	it("strips tags and collapses block boundaries into newlines", () => {
		expect(htmlToPlainText("<p>Hello <strong>world</strong></p><p>Again</p>")).toBe(
			"Hello world\nAgain"
		);
	});

	it("turns blockquote closings and <br> into newlines", () => {
		expect(
			htmlToPlainText("<blockquote><p>John 3:16</p><p>For God so loved</p></blockquote><p>End</p>")
		).toBe("John 3:16\nFor God so loved\nEnd");
		expect(htmlToPlainText("<p>one<br>two<br/>three</p>")).toBe("one\ntwo\nthree");
	});

	it("decodes entities", () => {
		expect(htmlToPlainText("<p>a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;&nbsp;e</p>")).toBe(
			'a <b> & "c" \'d\' e'
		);
	});

	it("drops script and style blocks entirely", () => {
		expect(htmlToPlainText("<style>p{color:red}</style><p>keep</p><script>x()</script>")).toBe(
			"keep"
		);
	});

	it("preserves explicit empty paragraphs and repeated breaks", () => {
		expect(htmlToPlainText("<p>one</p><p></p><p></p><p>two</p>")).toBe("one\n\n\ntwo");
		expect(htmlToPlainText("<p>one<br><br/><br />two</p>")).toBe("one\n\n\ntwo");
	});
	it.each([
  [
    "soft LF",
    "<p>QA immutable seed synthetic-owned-marker<br>QA_NEW_synthetic-owned-marker</p>",
    "QA immutable seed synthetic-owned-marker\nQA_NEW_synthetic-owned-marker"
  ],
  [
    "Markdown paragraphs",
    "<p>QA immutable seed synthetic-owned-marker</p>\n<p>QA_NEW_synthetic-owned-marker</p>",
    "QA immutable seed synthetic-owned-marker\nQA_NEW_synthetic-owned-marker"
  ],
  [
    "two-space hard break",
    "<p>QA immutable seed synthetic-owned-marker<br>QA_NEW_synthetic-owned-marker</p>",
    "QA immutable seed synthetic-owned-marker\nQA_NEW_synthetic-owned-marker"
  ],
  [
    "backslash hard break",
    "<p>QA immutable seed synthetic-owned-marker<br>QA_NEW_synthetic-owned-marker</p>",
    "QA immutable seed synthetic-owned-marker\nQA_NEW_synthetic-owned-marker"
  ],
  [
    "supplied HTML paragraphs",
    "<p>QA immutable seed synthetic-owned-marker</p><p>QA_NEW_synthetic-owned-marker</p>",
    "QA immutable seed synthetic-owned-marker\nQA_NEW_synthetic-owned-marker"
  ],
  [
    "HTML soft whitespace",
    "<p>QA immutable seed synthetic-owned-marker\nQA_NEW_synthetic-owned-marker</p>",
    "QA immutable seed synthetic-owned-marker QA_NEW_synthetic-owned-marker"
  ],
  [
    "three explicit breaks",
    "<p>QA immutable seed synthetic-owned-marker<br><br><br>QA_NEW_synthetic-owned-marker</p>",
    "QA immutable seed synthetic-owned-marker\n\n\nQA_NEW_synthetic-owned-marker"
  ],
  [
    "two empty paragraphs",
    "<p>QA immutable seed synthetic-owned-marker</p><p></p><p></p><p>QA_NEW_synthetic-owned-marker</p>",
    "QA immutable seed synthetic-owned-marker\n\n\nQA_NEW_synthetic-owned-marker"
  ],
  [
    "inline formatting spaces",
    "<p><strong>QA immutable seed synthetic-owned-marker</strong> <a href=\"https://example.invalid/\">QA_NEW_synthetic-owned-marker</a> end</p>",
    "QA immutable seed synthetic-owned-marker QA_NEW_synthetic-owned-marker end"
  ],
  [
    "nested quote and list",
    "<blockquote><ul><li><p>A</p></li></ul></blockquote><p>B</p>",
    "A\nB"
  ],
  [
    "nested list",
    "<ul><li><p>A</p><ul><li><p>B</p></li></ul></li><li><p>C</p></li></ul>",
    "A\nB\nC"
  ],
  [
    "task item div and label",
    "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><label><input type=\"checkbox\"><span></span></label><div><p>A</p></div></li></ul><p>B</p>",
    "A\nB"
  ],
  [
    "bare list item",
    "<ul><li>A</li><li>B</li></ul>",
    "A\nB"
  ],
  [
    "multi paragraph list item",
    "<ol><li><p>A</p><p>B</p></li><li><p>C</p></li></ol>",
    "A\nB\nC"
  ],
  [
    "empty list item",
    "<ul><li><p>A</p></li><li></li><li><p>C</p></li></ul>",
    "A\n\nC"
  ],
  [
    "empty task item",
    "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"true\"><div><p>A</p></div></li><li data-type=\"taskItem\" data-checked=\"false\"><label><input type=\"checkbox\"><span></span></label><div></div></li><li data-type=\"taskItem\" data-checked=\"false\"><div><p>C</p></div></li></ul>",
    "A\n\nC"
  ],
  [
    "empty paragraph inside quote",
    "<blockquote><p>A</p><p></p><ul><li><p>B</p></li></ul></blockquote>",
    "A\n\nB"
  ],
  [
    "literal pre whitespace",
    "<pre><code> A\n\n\nB </code></pre><p>C</p>",
    " A\n\n\nB \nC"
  ]
])("derives canonical leaf blocks: %s", (_name, html, expected) => { expect(htmlToPlainText(html)).toBe(expected); });

	it.each([["<div>A</div><div>B</div>", "A\nB"], ["<table><tr><td>A</td></tr><tr><td>B</td></tr></table>", "A\nB"], ["<div><p>A</p><div><p>B</p></div></div><p>C</p>", "A\nB\nC"], ["<div>A</div><div></div><div>B</div>", "A\n\nB"], ["<div><div></div></div><div>A</div>", "\nA"]])("preserves legacy leaf containers: %s", (html, expected) => { expect(htmlToPlainText(html)).toBe(expected); });

	it.each([["raw script less-than", "<script>if (a<b) alert(1)</script><p>Visible safe words</p>", "Visible safe words"], ["raw style less-than", "<style>.x:before{content:\"<b\"}</style><p>Visible safe words</p>", "Visible safe words"], ["escaped markup remains text", "<p>&lt;script&gt;if (a&lt;b) alert(1)&lt;/script&gt; &lt;style&gt;.x&lt;b&lt;/style&gt;</p>", "<script>if (a<b) alert(1)</script> <style>.x<b</style>"]])("preserves visible text after %s", (_name, html, expected) => { expect(htmlToPlainText(html)).toBe(expected); });

});

describe("initialHtmlFor", () => {
	it("prefers htmlContent when it is not blank", () => {
		expect(initialHtmlFor({ htmlContent: "<p>hi</p>", content: "{}" })).toBe("<p>hi</p>");
	});

	it("treats Tiptap's empty documents as blank and falls back to content", () => {
		expect(initialHtmlFor({ htmlContent: "<p></p>", content: "<p>legacy</p>" })).toBe(
			"<p>legacy</p>"
		);
	});

	it("returns an empty string when content holds Tiptap JSON", () => {
		expect(initialHtmlFor({ htmlContent: "", content: '{"type":"doc"}' })).toBe("");
		expect(initialHtmlFor({ htmlContent: "", content: "[]" })).toBe("");
	});

	it("returns an empty string when there is nothing to show", () => {
		expect(initialHtmlFor({ htmlContent: "", content: "" })).toBe("");
	});
});

describe("relativeTime", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
	});
	afterEach(() => vi.useRealTimers());

	const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

	it("returns an empty string for unparseable input", () => {
		expect(relativeTime("not-a-date")).toBe("");
	});

	it("reports anything under a minute as just now", () => {
		expect(relativeTime(isoAgo(0))).toBe("Just now");
		expect(relativeTime(isoAgo(59_000))).toBe("Just now");
	});

	it("reports minutes under an hour", () => {
		expect(relativeTime(isoAgo(60_000))).toBe("1m ago");
		expect(relativeTime(isoAgo(59 * 60_000))).toBe("59m ago");
	});

	it("reports hours under a day", () => {
		expect(relativeTime(isoAgo(60 * 60_000))).toBe("1h ago");
		expect(relativeTime(isoAgo(23 * 60 * 60_000))).toBe("23h ago");
	});

	it("reports days under a week", () => {
		expect(relativeTime(isoAgo(24 * 60 * 60_000))).toBe("1d ago");
		expect(relativeTime(isoAgo(6 * 24 * 60 * 60_000))).toBe("6d ago");
	});
});
