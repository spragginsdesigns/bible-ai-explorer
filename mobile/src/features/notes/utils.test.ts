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
		).toBe("John 3:16\nFor God so loved\n\nEnd");
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

	it("collapses runs of blank lines", () => {
		expect(htmlToPlainText("<p>one</p><p></p><p></p><p>two</p>")).toBe("one\n\ntwo");
	});
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
