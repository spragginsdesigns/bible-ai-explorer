import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALIVE_BASE_URL, AUDIO_BIBLE_BASE_URL, EDITION_CHOICES, hasAlive, hasNarration, needsStillListening, parseChapterTiming, parseEdition, verseAt, verseStart } from "./audioBible";
describe("chapter narration timing", () => {
  const verses = [{ verse: 1, start: 3, end: 10 }, { verse: 2, start: 10, end: 18 }];
  it("keeps headings outside read-along and selects the boundary verse", () => {
    expect(verseAt(verses, 0)).toBe(null); expect(verseAt(verses, 9.99)).toBe(1); expect(verseAt(verses, 10)).toBe(2);
    expect(verseStart(verses, 2)).toBe(10); expect(verseStart(verses, 50)).toBe(0);
  });
  it("offers narration for every book and none outside the Bible", () => { expect(hasNarration(0)).toBe(false); expect(hasNarration(1)).toBe(true); expect(hasNarration(39)).toBe(true); expect(hasNarration(66)).toBe(true); expect(hasNarration(67)).toBe(false); });
  it("rejects timings from a different chapter or missing verse", () => {
    const data = { book: 43, chapter: 3, duration: 20, verses };
    expect(parseChapterTiming(data, 43, 4)).toBe(null);
    expect(parseChapterTiming({ ...data, verses: [verses[1]] }, 43, 3)).toBe(null);
    expect(parseChapterTiming(data, 43, 3)?.verses).toEqual(verses);
  });
  it("offers Mark's Alive recording beside the narration (LC-15532)", () => {
    expect(hasAlive(41)).toBe(true); expect(hasAlive(40)).toBe(false); expect(hasAlive(43)).toBe(false);
    expect(parseEdition(null)).toBe("regular"); expect(parseEdition("alive")).toBe("alive"); expect(parseEdition("drama")).toBe(null);
    const data = { book: 41, chapter: 1, duration: 20, verses };
    expect(parseChapterTiming(data, 41, 1, "alive")?.audioUrl).toBe(`${ALIVE_BASE_URL}/41/1.mp3`);
    expect(parseChapterTiming(data, 41, 1)?.audioUrl).toBe(`${AUDIO_BIBLE_BASE_URL}/41/1.mp3`);
    expect(EDITION_CHOICES.alive.label).toBe("Alive"); expect(EDITION_CHOICES.regular.label).toBe("Regular");
  });
  it("is the same contract file as web's src/lib/bible/audioBible.ts", () => {
    const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");
    expect(read("audioBible.ts")).toBe(read("../../../../src/lib/bible/audioBible.ts"));
  });
  it("pauses precisely after one idle hour", () => { expect(needsStillListening(500, 3600499)).toBe(false); expect(needsStillListening(500, 3600500)).toBe(true); });
});
