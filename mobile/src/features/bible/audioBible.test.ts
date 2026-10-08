import { describe, expect, it } from "vitest";
import { hasNarration, needsStillListening, parseChapterTiming, verseAt, verseStart } from "./audioBible";
describe("chapter narration timing", () => {
  const verses = [{ verse: 1, start: 3, end: 10 }, { verse: 2, start: 10, end: 18 }];
  it("keeps headings outside read-along and selects the boundary verse", () => {
    expect(verseAt(verses, 0)).toBe(null); expect(verseAt(verses, 9.99)).toBe(1); expect(verseAt(verses, 10)).toBe(2);
    expect(verseStart(verses, 2)).toBe(10); expect(verseStart(verses, 50)).toBe(0);
  });
  it("doesn't offer narration for books without recordings", () => { expect(hasNarration(39)).toBe(false); expect(hasNarration(40)).toBe(true); expect(hasNarration(66)).toBe(true); expect(hasNarration(67)).toBe(false); });
  it("rejects timings from a different chapter or missing verse", () => {
    const data = { book: 43, chapter: 3, duration: 20, verses };
    expect(parseChapterTiming(data, 43, 4)).toBe(null);
    expect(parseChapterTiming({ ...data, verses: [verses[1]] }, 43, 3)).toBe(null);
    expect(parseChapterTiming(data, 43, 3)?.verses).toEqual(verses);
  });
  it("pauses precisely after one idle hour", () => { expect(needsStillListening(500, 3600499)).toBe(false); expect(needsStillListening(500, 3600500)).toBe(true); });
});
