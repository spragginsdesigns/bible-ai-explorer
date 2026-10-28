import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALIVE_ASV_BASE_URL, ALIVE_BASE_URL, AUDIO_BIBLE_BASE_URL, EDITION_CHOICES, LC_GREEK, LISTEN_ORDER, RECOMMENDED_EDITION, RECOMMENDED_LABEL, adjacentVerse, aliveSources, editionDetail, hasLcGreek, hasNarration, lcGreekNote, needsStillListening, parseChapterTiming, parseEdition, parseLcGreek, verseAt, verseStart } from "./audioBible";
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
    expect(parseChapterTiming({ ...data, verses: [verses[1], verses[0]] }, 43, 3)).toBe(null);
    expect(parseChapterTiming(data, 43, 3)?.verses).toEqual(verses);
  });
  it("accepts timings that skip a verse the ASV leaves out, and steps over it (LC-17800)", () => {
    const skipping = [{ verse: 20, start: 100, end: 110 }, { verse: 22, start: 111, end: 118 }];
    const audio = parseChapterTiming({ book: 40, chapter: 17, duration: 120, verses: skipping }, 40, 17, "alive", "ASV");
    expect(audio?.verses.map(t => t.verse)).toEqual([20, 22]);
    expect(audio?.text).toBe("ASV"); expect(audio?.audioUrl).toBe(`${ALIVE_ASV_BASE_URL}/40/17.mp3`);
    expect(verseStart(skipping, 21)).toBe(111);
    expect(adjacentVerse(skipping, 20, 1)).toBe(22); expect(adjacentVerse(skipping, 22, 1)).toBe(22); expect(adjacentVerse(skipping, null, 1)).toBe(20);
  });
  it("asks for Alive on every book: the ASV folder, then the LC Greek one for Matthew to John (LC-17800)", () => {
    expect(aliveSources(1)).toEqual(["ASV"]); expect(aliveSources(44)).toEqual(["ASV"]); expect(aliveSources(41)).toEqual(["ASV", "LC Greek"]);
    expect(editionDetail("alive", "ASV")).toBe("Full cast, in the American Standard Version");
    expect(editionDetail("alive", null)).toBe("Full cast, in our LC Greek translation");
  });
  it("offers Mark's Alive recording beside the narration (LC-15532)", () => {
    expect(parseEdition(null)).toBe("regular"); expect(parseEdition("alive")).toBe("alive"); expect(parseEdition("drama")).toBe(null);
    const data = { book: 41, chapter: 1, duration: 20, verses };
    expect(parseChapterTiming(data, 41, 1, "alive")?.audioUrl).toBe(`${ALIVE_BASE_URL}/41/1.mp3`);
    expect(parseChapterTiming(data, 41, 1)?.audioUrl).toBe(`${AUDIO_BIBLE_BASE_URL}/41/1.mp3`);
    expect(EDITION_CHOICES.alive.label).toBe("Alive"); expect(EDITION_CHOICES.regular.label).toBe("Regular");
  });
  it("recommends Alive first and reads the LC Greek beside it (LC-15842)", () => {
    expect(LISTEN_ORDER[0]).toBe(RECOMMENDED_EDITION); expect(RECOMMENDED_EDITION).toBe("alive"); expect(RECOMMENDED_LABEL).toBe("Recommended");
    expect(editionDetail("alive", "LC Greek")).toContain(LC_GREEK.label);
    expect(hasLcGreek(41)).toBe(true); expect(hasLcGreek(40)).toBe(true); expect(hasLcGreek(42)).toBe(true); expect(hasLcGreek(43)).toBe(true); expect(hasLcGreek(44)).toBe(false); expect(hasLcGreek(1)).toBe(false);
    expect(lcGreekNote("LC Greek")).toBe("Our own translation of the Greek · the text Alive reads"); expect(lcGreekNote("ASV")).toBe("Our own translation of the Greek");
    const ready = { status: "ready", book: 41, chapter: 1, verses: ["The beginning.", "As it is written."] };
    expect(parseLcGreek(ready, 41, 1)).toEqual(ready.verses);
    expect(parseLcGreek(ready, 41, 2)).toBe(null);
    expect(parseLcGreek({ status: "unavailable" }, 41, 1)).toBe(null);
    expect(parseLcGreek({ ...ready, verses: ["ok", " "] }, 41, 1)).toBe(null);
  });
  it("is the same contract file as web's src/lib/bible/audioBible.ts", () => {
    const read = (path: string) => readFileSync(resolve(import.meta.dirname, path), "utf8");
    expect(read("audioBible.ts")).toBe(read("../../../../src/lib/bible/audioBible.ts"));
  });
  it("pauses precisely after one idle hour", () => { expect(needsStillListening(500, 3600499)).toBe(false); expect(needsStillListening(500, 3600500)).toBe(true); });
});
