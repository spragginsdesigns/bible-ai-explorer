import { describe, it, expect } from "vitest";
import { applyReview, maskVerse, parseToday, verseWords, type LearnCard } from "./learn";
const verse = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
const card: LearnCard = { id:"a",book:43,chapter:3,verse:16,translation:"KJV",reference:"John 3:16",text:verse,stage:0,intervalDays:0,dueAt:"2026-09-12T00:00:00Z",knownAt:null };
describe("Learn contract", () => {
 it("keeps KJV text at the read stage", () => expect(maskVerse(verse,0)).toBe(verse));
 it("hides every fourth word", () => expect(maskVerse(verse,1)).toBe("For God so ____ the world, that ____ gave his only ____ Son, that whosoever ____ in him should ____ perish, but have ____ life."));
 it("hides half the words", () => expect(maskVerse(verse,2)).toBe("For ____ so ____ the ____, that ____ gave ____ only ____ Son, ____ whosoever ____ in ____ should ____ perish, ____ have ____ life."));
 it("hides all words for reference recall", () => expect(verseWords(verse,3).every(word => word.hidden)).toBe(true));
 it("preserves punctuation and trims surrounding whitespace", () => expect(maskVerse('  “For God so loved,”  ',3)).toBe('“____ ____ ____ ____,”'));
 it("retains same-day stages and resets to stage one on again", () => {
  const today={cards:[card],knownCount:0,queueCount:1};
  expect(applyReview(today,card,{...card,stage:1},"good").cards[0].stage).toBe(1);
  expect(applyReview(today,{...card,stage:3},{...card,stage:1},"again").cards).toHaveLength(1);
 });
 it("removes completed recall and counts newly known once", () => {
  const before={...card,stage:3 as const}; const updated={...before,intervalDays:16,knownAt:"2026-09-12T01:00:00Z"};
  expect(applyReview({cards:[before],knownCount:0,queueCount:1},before,updated,"good")).toEqual({cards:[],knownCount:1,queueCount:1});
  expect(applyReview({cards:[updated],knownCount:1,queueCount:1},updated,updated,"good").knownCount).toBe(1);
 });
 it("rejects malformed or mismatched responses", () => {
  expect(() => parseToday({cards:[card,card],knownCount:0,queueCount:2})).toThrow();
  expect(() => parseToday({cards:[{...card,translation:"unknown"}],knownCount:0,queueCount:1})).toThrow();
  expect(() => applyReview({cards:[card],knownCount:0,queueCount:1},card,{...card,id:"b"},"good")).toThrow();
 });
});

