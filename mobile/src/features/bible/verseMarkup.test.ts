import { describe, expect, it } from "vitest";
import { bibleVersePlainText, parseBibleVerseMarkup } from "./verseMarkup";

describe("parseBibleVerseMarkup", () => {
	it("turns the NKJV supplied-word tag into an italic segment", () => {
		expect(parseBibleVerseMarkup("Blessed <i>be</i> the God and Father")).toEqual([
			{ text: "Blessed ", italic: false },
			{ text: "be", italic: true },
			{ text: " the God and Father", italic: false }
		]);
	});

	it("supports equivalent emphasis tags and nested emphasis", () => {
		expect(parseBibleVerseMarkup("He <em>really <i>is</i></em> risen")).toEqual([
			{ text: "He ", italic: false },
			{ text: "really is", italic: true },
			{ text: " risen", italic: false }
		]);
	});

	it("removes unsupported provider tags and decodes common entities", () => {
		expect(bibleVersePlainText("A <span>B &amp; C</span> &#39;D&#39;")).toBe("A B & C 'D'");
	});

	it("does not leak malformed closing tags into visible text", () => {
		expect(bibleVersePlainText("Blessed <i>be</i></i> the Lord")).toBe("Blessed be the Lord");
	});

	// The bundled KJV never carries markup, so tag-free text takes a fast path
	// that skips the scan entirely; it must return exactly what the scan did.
	it("returns tag-free text as one plain segment", () => {
		expect(parseBibleVerseMarkup("In the beginning God created the heaven")).toEqual([
			{ text: "In the beginning God created the heaven", italic: false }
		]);
		expect(parseBibleVerseMarkup("")).toEqual([]);
	});

	it("still parses NKJV-style markup when the fast path does not apply", () => {
		const marked = "Blessed <i>be</i> the God &amp; Father";
		expect(parseBibleVerseMarkup(marked)).toEqual([
			{ text: "Blessed ", italic: false },
			{ text: "be", italic: true },
			{ text: " the God & Father", italic: false }
		]);
		// An entity with no tags must keep decoding rather than fall through.
		expect(bibleVersePlainText("Alpha &amp; Omega")).toBe("Alpha & Omega");
	});
});
