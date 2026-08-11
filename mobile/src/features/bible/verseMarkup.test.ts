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
});
