import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { generateText, Output } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { doctrinalFoundation } from "../src/utils/systemPrompt.ts";
import { normalizeAssistantMarkdown } from "../src/utils/assistantMarkdown.ts";
import { analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore } from "../src/lib/ai/markdown-underscore-guard.ts";
import { gateAnswer } from "../src/lib/ai/answer-gate.ts";
import { createDashStripper } from "../src/lib/ai/plain-dashes.ts";
import { traceTurn, classifyTurnError } from "../src/lib/ai/turn-trace.ts";
import { HISTORY_REVIEW_CONTEXT_CHARS, COMPLETE_VERIFICATION_REQUEST_CHARS } from "../src/lib/ai/verification-limits.mjs";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
const plain = source => stripTypeScriptTypes(source.replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export /gm, ""));
const books = JSON.parse(read("src/data/books.json"));
const names = JSON.parse(read("src/data/book-names.json"));
const localized = ["es", "de"].flatMap(language => [...names[language].names.map((name, index) => [name, index + 1]), ...Object.entries(names[language].aliases)]);
const forbidden = () => { throw Error("No network, private DB, real model or external corpus allowed"); };
const chapter = async (translation, order, number) => { assert.equal(translation, "KJV"); return JSON.parse(read("src/data/kjv/" + books.find(book => book.order === order).file))[number - 1] ?? []; };
const verifyScriptureDraft = new Function("normalizeAssistantMarkdown", "analyzeMarkdownUnderscores", "markdownRangeHasLiteralUnderscore", "BOOKS", "LOCALIZED_BOOK_NAMES", "getChapter", "isTranslationId", "getOriginalVerse", "getOriginalVerseForKjv", "loadBsbChapter", plain(read("src/lib/ai/scripture-verification.ts")) + "\nreturn verifyScriptureDraft;")(normalizeAssistantMarkdown, analyzeMarkdownUnderscores, markdownRangeHasLiteralUnderscore, books, localized, chapter, value => value === "KJV", forbidden, forbidden, forbidden);
const production = read("src/lib/ai/verified-generation.ts");
// Exact previous neighborhood construction. Only this region is substituted so
// both paths run the same gate, prompts, source parser, SDK and request budget.
const oldNeighborhoods = `
            const allContextVerses = evidence.flatMap(ref => ref.verses);
            if (options.historyReview && allContextVerses.length > 120) { sourceBoundExceeded = true; throw new Error("Saved history canonical context exceeds complete review bounds"); }
            const context = await Promise.all((options.historyReview ? allContextVerses : allContextVerses.slice(0, 120)).map(async verse => {
                const chapter = await getChapter(options.translation, verse.order, verse.chapter);
                return { order: verse.order, chapter: verse.chapter, verses: chapter.slice(Math.max(0, verse.verse - 3), verse.verse + 2).map((text, i) => ({ verse: Math.max(1, verse.verse - 2) + i, text })) };
            }));
`;
const start = production.indexOf("\t\t\t// Nearby verses expose");
const end = production.indexOf("\t\t\tconst questionEvidence =", start);
assert.ok(start > 0 && end > start);
const previous = production.slice(0, start) + oldNeighborhoods + production.slice(end);
function fixture({ old = false, check = verifyScriptureDraft } = {}) {
    const requests = [], reads = [];
    const model = new MockLanguageModelV4({ doGenerate: async options => {
        const prompt = JSON.parse(options.prompt.find(message => message.role === "user").content.find(part => part.type === "text").text);
        return { content: [{ type: "text", text: JSON.stringify({ checkedReferences: prompt.expectedCheckedReferences, checkedOriginalSources: prompt.expectedCheckedOriginalSources,
            allScriptureQuotationsVerified: true, allCitationsSupportTheirClaims: true, faithfulToFoundation: true, answersRequestedQuestion: true, issues: [], requiredReferences: [] }) }],
            finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [] };
    } });
    const verify = new Function("generateText", "Output", "z", "doctrinalFoundation", "getChapter", "verifyScriptureDraft", "gateAnswer", "createDashStripper", "HISTORY_REVIEW_CONTEXT_CHARS", "COMPLETE_VERIFICATION_REQUEST_CHARS", "traceTurn", "classifyTurnError", "console", plain(old ? previous : production) + "\nreturn verifyGeneratedAnswer;")(
        async request => { requests.push(request); return generateText(request); }, Output, z, doctrinalFoundation,
        async (...args) => { reads.push(args); return chapter(...args); }, check, gateAnswer, createDashStripper, HISTORY_REVIEW_CONTEXT_CHARS, COMPLETE_VERIFICATION_REQUEST_CHARS, traceTurn, classifyTurnError, { info() {} });
    return { verify, model, requests, reads };
}
const options = (state, extra = {}) => ({ model: state.model, translation: "KJV", question: "Study the supplied passages.", historyReview: true, allowRepair: false, requireCompleteContext: true, ...extra });
const coordinates = context => {
    const words = new Map();
    for (const group of context) for (const verse of group.verses) {
        const key = `${group.order}:${group.chapter}:${verse.verse}`;
        if (words.has(key)) assert.equal(words.get(key), verse.text);
        words.set(key, verse.text);
    }
    return [...words].sort(([a], [b]) => a.localeCompare(b));
};
const prompt = state => JSON.parse(state.requests.at(-1).prompt);
const countWords = context => context.reduce((sum, group) => sum + group.verses.length, 0);
const target = (order, chapter, verse, text = "trusted target") => ({ order, chapter, verse, text });
const checked = (text, verses) => ({ text, ok: true, issues: [], references: [{ reference: "preserved reference", start: 2, end: 5, sourceText: "label", verses }], originalEvidence: [] });

for (const [name, text] of [
    ["Matthew and Mark full chapters", "[[SCRIPTURE:Matthew 5]]\n\n[[SCRIPTURE:Mark 7]]"],
    ["multiple chapters, books and edge verses", "[[SCRIPTURE:Matthew 5:1-2]]\n[[SCRIPTURE:Matthew 6:33-34]]\n[[SCRIPTURE:Mark 7:1]]\n[[SCRIPTURE:Mark 7:37]]"],
    ["disjoint neighborhoods", "[[SCRIPTURE:Matthew 5:1]]\n[[SCRIPTURE:Matthew 5:48]]"],
]) {
    test(`${name}: the exact old coordinate/word union is retained with source occurrences untouched`, async () => {
        const before = fixture({ old: true }), after = fixture();
        const blocks = [{ id: "prose", text }];
        assert.equal((await before.verify(blocks, options(before))).verified, true);
        assert.equal((await after.verify(blocks, options(after))).verified, true);
        const oldPrompt = prompt(before), newPrompt = prompt(after);
        assert.deepEqual(coordinates(newPrompt.canonical.context), coordinates(oldPrompt.canonical.context));
        for (const key of ["evidence", "questionEvidence", "contextEvidence"]) assert.deepEqual(newPrompt.canonical[key], oldPrompt.canonical[key]);
        assert.deepEqual(newPrompt.blocks, oldPrompt.blocks);
        assert.deepEqual(newPrompt.expectedCheckedReferences, oldPrompt.expectedCheckedReferences);
        assert.equal(new Set(after.reads.map(args => args.join(":"))).size, after.reads.length, "one chapter load per group");
        for (const group of newPrompt.canonical.context) assert.deepEqual(group.verses.map(verse => verse.verse), [...group.verses.map(verse => verse.verse)].sort((a, b) => a - b));
        if (name.startsWith("Matthew and Mark")) {
            const ratio = countWords(oldPrompt.canonical.context) / countWords(newPrompt.canonical.context);
            assert.ok(ratio > 4.7 && ratio <= 5, `overlapping copies reduced ${ratio}x`);
        }
        if (name === "disjoint neighborhoods") assert.deepEqual(newPrompt.canonical.context[0].verses.map(verse => verse.verse), [1, 2, 3, 46, 47, 48]);
    });
}

test("repeated reference occurrences preserve provenance while sharing their neighborhoods", async () => {
    const text = Array(4).fill("[[SCRIPTURE:Matthew 5]]").join("\n\n");
    const state = fixture();
    const result = await state.verify([{ id: "prose", text }], options(state));
    assert.equal(result.verified, true);
    const request = prompt(state);
    assert.equal(request.canonical.evidence.length, 4);
    assert.equal(request.canonical.evidence.reduce((sum, ref) => sum + ref.verses.length, 0), 192);
    assert.equal(request.canonical.context.length, 1);
    assert.equal(request.canonical.context[0].verses.length, 48);
    assert.equal(state.reads.length, 1);
    assert.equal(new Set(request.canonical.evidence.map(ref => ref.start)).size, 4);
});

test("120 unique targets pass and 121 fail closed without dropping context", async () => {
    for (const [count, expected] of [[120, true], [121, false]]) {
        const state = fixture();
        const text = `[[SCRIPTURE:Psalms 119:1-${count}]]`;
        const result = await state.verify([{ id: "prose", text }], options(state));
        assert.equal(result.verified, expected);
        assert.equal(state.requests.length, expected ? 1 : 0);
    }
});

test("malformed target coordinates and conflicting duplicate words fail before provider use", async () => {
    for (const verses of [[target(0, 5, 1)], [target(40, 0, 1)], [target(40, 5, 0)], [target(40, 5, 1.5)], [target(40, 5, 1), target(40, 5, 1, "conflicting trusted words")]]) {
        const state = fixture({ check: async text => checked(text, verses) });
        const result = await state.verify([{ id: "prose", text: "synthetic checked input" }], options(state));
        assert.equal(result.verified, false);
        assert.equal(state.requests.length, 0);
    }
});

test("synthetic target text need not equal the neighboring chapter loader's words", async () => {
    const state = fixture({ check: async text => checked(text, [target(40, 5, 1)]) });
    assert.equal((await state.verify([{ id: "prose", text: "synthetic checked input" }], options(state))).verified, true);
    assert.equal(prompt(state).canonical.evidence[0].verses[0].text, "trusted target");
    assert.equal(prompt(state).canonical.context[0].verses[0].text, (await chapter("KJV", 40, 5))[0]);
});

test("lossless neighborhoods bring an oversized complete request below its unchanged cap through the actual SDK", async () => {
    const text = "[[SCRIPTURE:Deuteronomy 28]]\n\n[[SCRIPTURE:Leviticus 26]]";
    const blocks = [{ id: "prose", text }];
    const completeContext = "Complete synthetic context. ".padEnd(64_000, "x");
    const oldSizing = fixture({ old: true });
    assert.equal((await oldSizing.verify(blocks, options(oldSizing, { context: completeContext, maxContextChars: HISTORY_REVIEW_CONTEXT_CHARS, requireCompleteContext: false }))).verified, true);
    const oldRequest = oldSizing.requests[0];
    const oldChars = oldRequest.system.length + oldRequest.prompt.length;
    const state = fixture();
    const result = await state.verify(blocks, options(state, { context: completeContext, maxContextChars: HISTORY_REVIEW_CONTEXT_CHARS }));
    assert.equal(result.verified, true);
    const current = state.requests[0];
    const newChars = current.system.length + current.prompt.length;
    assert.ok(oldChars > COMPLETE_VERIFICATION_REQUEST_CHARS, `old request ${oldChars}`);
    assert.ok(newChars < COMPLETE_VERIFICATION_REQUEST_CHARS, `new request ${newChars}`);
    assert.equal(JSON.parse(oldRequest.prompt).extraContext, JSON.parse(current.prompt).extraContext);
    assert.deepEqual(prompt(state).canonical.evidence, prompt(oldSizing).canonical.evidence);
    assert.deepEqual(prompt(state).blocks, prompt(oldSizing).blocks);
    assert.deepEqual(coordinates(prompt(state).canonical.context), coordinates(prompt(oldSizing).canonical.context));
    const oldGuard = fixture({ old: true });
    assert.equal((await oldGuard.verify(blocks, options(oldGuard, { context: completeContext, maxContextChars: HISTORY_REVIEW_CONTEXT_CHARS }))).verified, false);
    assert.equal(oldGuard.requests.length, 0);
    console.info(JSON.stringify({ fixture: "complete-neighborhood-budget", oldChars, newChars, requestLimitChars: COMPLETE_VERIFICATION_REQUEST_CHARS }));
});
