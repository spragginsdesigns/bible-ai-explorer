/**
 * Sermon to Study (LC-17643, docs/beta/sermons.md): how passages are found in
 * a transcript, and the rules that keep the sermon's words apart from
 * Scripture. Quotations are matched against the real bundled KJV.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
	CHUNK_SAMPLE_RATE,
	checkStudyDraft,
	excerptAround,
	findQuotations,
	findSpokenReferences,
	formatClock,
	isSermonWav,
	mergePassages,
	passageRefKeys,
	pieceOffset,
	placeSegments,
	quoteIsVerbatim,
	readSermonData,
	sermonBody,
	wavSeconds,
	withResearchMark,
} from "../src/lib/beta/sermons/sermons-rules.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const books = JSON.parse(readFileSync(join(repoRoot, "src/data/books.json"), "utf8"));

/** The bundled KJV as plain verses (markup stripped the simple way: no tags in these books' text matter here). */
const plainVerse = (markup) => markup.replace(/<[^>]+>/g, "").replace(/[{}[\]]/g, "");
const kjv = [];
for (const file of readdirSync(join(repoRoot, "src/data/kjv")).sort()) {
	const order = Number(file.slice(0, 2));
	JSON.parse(readFileSync(join(repoRoot, "src/data/kjv", file), "utf8")).forEach((chapter, c) =>
		chapter.forEach((text, v) => kjv.push({ book: order, chapter: c + 1, verse: v + 1, text: plainVerse(text) })),
	);
}

/** A stand-in for resolveReference over the real book list: "2 Corinthians 4:7", "Psalm 23". */
function resolve(reference) {
	const match = /^(?:([1-3]) )?([A-Za-z ]+?) (\d+)(?::(\d+))?$/.exec(reference);
	if (!match) return null;
	const name = `${match[1] ? `${match[1]} ` : ""}${match[2]}`;
	const book = books.find((entry) => entry.name === name || (name === "Psalm" && entry.name === "Psalms"));
	if (!book) return null;
	const chapter = Number(match[3]);
	if (chapter < 1 || chapter > book.chapters) return null;
	return { order: book.order, chapter, verse: match[4] ? Number(match[4]) : undefined };
}
const NAMES = [...books.map((book) => book.name), "Psalm"];
const seg = (start, text) => ({ start, end: start + 5, text });

test("spoken references: digits, words, ordinals and chapters", () => {
	const found = findSpokenReferences(
		[
			seg(10, "Turn with me to Second Corinthians chapter 4, verse 7."),
			seg(20, "As Paul says in Romans 5:8, God commendeth his love."),
			seg(30, "Psalm 23 is a comfort; read John chapter three, verse sixteen."),
			seg(40, "And in 1 John 4.8 we learn that God is love."),
			seg(50, "Romans chapter 8."),
			seg(60, "We have this treasure in earthen vessels. 2 Corinthians 4, 7."),
		],
		NAMES,
		resolve,
	);
	assert.deepEqual(
		found.map((ref) => `${ref.book}.${ref.chapter}${ref.verse ? `.${ref.verse}` : ""}@${ref.at}`),
		["47.4.7@10", "45.5.8@20", "19.23@30", "43.3.16@30", "62.4.8@40", "45.8@50", "47.4.7@60"],
	);
});

test("spoken references: ordinary words and impossible chapters are not passages", () => {
	const found = findSpokenReferences(
		[
			seg(0, "He made his mark 3 times and the acts 2 of them did were kind."),
			seg(5, "John 99 is not a chapter, and Corinthians 13 without its number is ambiguous."),
			seg(9, "The book of Romans teaches grace."),
		],
		NAMES,
		resolve,
	);
	assert.deepEqual(found, []);
});

test("quotations: a verse read in the KJV's words is found, at the moment it is read", () => {
	const quoted = findQuotations(
		[seg(0, "Let us begin."), seg(62.5, "But we have this treasure in earthen vessels, that the excellency of the power may be of God, and not of us.")],
		kjv,
	);
	assert.ok(quoted.some((q) => q.book === 47 && q.chapter === 4 && q.verse === 7 && q.at === 62.5), JSON.stringify(quoted));
});

test("quotations: runs scattered across the sermon do not add up to a quotation", () => {
	const scattered = findQuotations(
		[
			seg(0, "Friends, we have this treasure in mind."),
			seg(120, "Look, treasure in earthen vessels that break."),
			seg(240, "Notice the excellency of the power here."),
			seg(360, "Remember it may be of God and yet."),
			seg(480, "Look again, and not of us."),
		],
		kjv,
	);
	assert.equal(scattered.some((q) => q.book === 47 && q.chapter === 4 && q.verse === 7), false, JSON.stringify(scattered));
	const twice = findQuotations(
		[seg(30, "We have this treasure in earthen vessels."), seg(600, "That the excellency of the power may be of God, and not of us.")],
		kjv,
	).find((q) => q.book === 47 && q.chapter === 4 && q.verse === 7);
	assert.deepEqual(twice?.times, [30, 600], "each separate place it is quoted is kept");
});

test("quotations: a stock phrase shared by many verses proves nothing", () => {
	const quoted = findQuotations([seg(0, "And it came to pass in those days that we went to the store.")], kjv);
	assert.deepEqual(quoted, []);
	const mercy = findQuotations([seg(0, "for his mercy endureth for ever, friends")], kjv);
	assert.deepEqual(mercy, [], "Psalm 136's refrain is in dozens of verses");
});

test("quotations: paraphrase is not a quotation", () => {
	const quoted = findQuotations([seg(0, "God loved the world so much that he gave his only son so we can live forever.")], kjv);
	assert.equal(quoted.some((q) => q.book === 43 && q.chapter === 3 && q.verse === 16), false);
});

test("passages merge named and quoted, verse beats its bare chapter, ordered by time", () => {
	const named = [
		{ book: 47, chapter: 4, verse: 7, at: 10, spoken: "" },
		{ book: 47, chapter: 4, at: 12, spoken: "" },
		{ book: 45, chapter: 8, at: 200, spoken: "" },
	];
	const quoted = [
		{ book: 47, chapter: 4, verse: 7, at: 63, times: [63], matched: 5 },
		{ book: 43, chapter: 3, verse: 16, at: 90, times: [90, 400], matched: 7 },
	];
	const passages = mergePassages(named, quoted);
	assert.deepEqual(passages.map((p) => [p.key, p.how, p.times]), [
		["47.4.7", "named", [10, 63]],
		["43.3.16", "quoted", [90, 400]],
		["45.8", "named", [200]],
	]);
	assert.deepEqual(passageRefKeys(passages), ["47.4", "47.4.7", "43.3", "43.3.16", "45.8"]);
});

test("audio pieces: only 16 kHz mono 16-bit WAV is accepted, and the clock carries across pieces", () => {
	const header = new Uint8Array(44);
	const view = new DataView(header.buffer);
	const write = (at, text) => [...text].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
	write(0, "RIFF"); write(8, "WAVE"); write(12, "fmt "); write(36, "data");
	view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, CHUNK_SAMPLE_RATE, true); view.setUint16(34, 16, true);
	assert.equal(isSermonWav(header), true);
	view.setUint16(22, 2, true);
	assert.equal(isSermonWav(header), false, "stereo is refused");
	view.setUint16(22, 1, true); view.setUint32(24, 44_100, true);
	assert.equal(isSermonWav(header), false, "44.1 kHz is refused");
	assert.equal(isSermonWav(new Uint8Array(10)), false);
	assert.equal(wavSeconds(44 + CHUNK_SAMPLE_RATE * 2 * 110), 110);
	assert.equal(pieceOffset([109.5, 110]), 219.5);
	assert.deepEqual(placeSegments([{ text: "  Hello   there ", startSecond: 1.23, endSecond: 2 }, { text: " ", startSecond: 2, endSecond: 3 }], 219.5), [{ start: 220.7, end: 221.5, text: "Hello there" }]);
	assert.equal(formatClock(3725), "1:02:05");
	assert.equal(formatClock(62.9), "1:02");
});

const transcript = "Brethren, we are frail, cracked jars of clay, yet God has put his treasure in us. The treasure is the light of the knowledge of the glory of God.";
const passages = [
	{ key: "47.4.7", book: 47, chapter: 4, verse: 7, how: "named", at: 10, times: [10] },
	{ key: "47.4", book: 47, chapter: 4, verse: null, how: "named", at: 5, times: [5] },
];
const resolveRef = (reference) => {
	const ref = resolve(reference);
	return ref ? { book: ref.order, chapter: ref.chapter, verse: ref.verse } : null;
};

test("study: quotes must be verbatim, passages must resolve, memory verses must be the sermon's own", () => {
	const checked = checkStudyDraft(
		{
			bigIdea: "God keeps his treasure in weak vessels.",
			summary: "The sermon argues weakness shows God's power.",
			sections: [
				{ heading: "Jars of clay", minute: 1.5, pastorQuote: "we are frail, cracked jars of clay", passage: "2 Corinthians 4:7", explanation: "Paul calls the gospel a treasure.", reflection: "Where do you feel weak?" },
				{ heading: "Made up", minute: 99, pastorQuote: "God helps those who help themselves", passage: "Hezekiah 3:16", explanation: "Not in the sermon.", reflection: "" },
			],
			application: "Lean on God's power.",
			questions: ["What is the treasure?", "What is the treasure?", "Why clay?"],
			memory: ["2 Corinthians 4:7", "John 3:16", "2 Corinthians 4"],
		},
		{ transcript, durationSec: 600, passages, resolve: resolveRef, model: "test-model", now: "2026-10-27T00:00:00Z" },
	);
	assert.ok(!("error" in checked));
	assert.equal(checked.sections[0].pastorQuote, "we are frail, cracked jars of clay");
	assert.equal(checked.sections[0].startSec, 90);
	assert.equal(checked.sections[1].pastorQuote, null, "a quote not in the transcript is dropped");
	assert.equal(checked.sections[1].passage, null, "a passage that does not resolve is dropped");
	assert.equal(checked.sections[1].startSec, 600, "a minute past the end is clamped");
	assert.deepEqual(checked.memory, ["47.4.7"], "only the sermon's own verse-level passages");
	assert.deepEqual(checked.questions, ["What is the treasure?", "Why clay?"]);
	assert.deepEqual(checkStudyDraft({ bigIdea: "", sections: [], questions: [], memory: [] }, { transcript, durationSec: 1, passages, resolve: resolveRef, model: "m", now: "n" }), { error: "no big idea" });
});

test("verbatim check ignores case and punctuation but not words", () => {
	assert.equal(quoteIsVerbatim("WE ARE FRAIL cracked jars", transcript), true);
	assert.equal(quoteIsVerbatim("we are weak cracked jars", transcript), false);
	assert.equal(quoteIsVerbatim("jars of", transcript), false, "too short to be a quote");
});

test("research marks: only the sermon's own questions, toggled, and they reach the Vault body", () => {
	const data = readSermonData({
		status: "ready", preacher: "John Wesley", permissionAt: "x", source: "upload", fileName: "a.mp3", durationSec: 70, parts: [70],
		segments: [{ start: 0, end: 5, text: "We have this treasure." }, { start: 65, end: 70, text: "Amen." }],
		passages, study: { bigIdea: "Big", summary: "S", sections: [], application: "", questions: ["Why clay?"], memory: [], model: "m", createdAt: "n" },
		comparisons: [{ key: "47.4.7", context: "c", sermonUse: "u", fit: "close", fitNote: "f", questions: ["Who is speaking?"], model: "m", createdAt: "n" }],
		research: [],
	});
	assert.equal(withResearchMark(data, "Is this a trick?", true), null);
	const marked = withResearchMark(withResearchMark(data, "Why clay?", true), "Who is speaking?", true);
	assert.deepEqual(marked.research, ["Why clay?", "Who is speaking?"]);
	assert.deepEqual(withResearchMark(marked, "Why clay?", false).research, ["Who is speaking?"]);
	const body = sermonBody(marked, "Earthen vessels", (key) => key);
	assert.match(body, /preached by John Wesley/);
	assert.match(body, /Marked for later research:\n- Why clay\?\n- Who is speaking\?/);
	assert.match(body, /Transcript \(the sermon's words\):\n\[0:00\] We have this treasure\.\n\[1:05\] Amen\./);
	assert.equal(readSermonData({ status: "weird" }), null);
	assert.equal(excerptAround(marked.segments, 66, 3), "Amen.");
});
