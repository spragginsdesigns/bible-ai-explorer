import assert from "node:assert/strict";
import test from "node:test";

import {
	MAX_CONVERSATION_TITLE_LENGTH,
	cleanGeneratedTitle,
	shouldAutoTitle,
} from "../src/lib/conversation-title-rules.ts";

// Built from code points so the fixtures survive editors that flatten dashes.
const EM_DASH = String.fromCharCode(0x2014);
const EMOJI_CROSS = String.fromCodePoint(0x271d, 0xfe0f);
const EMOJI_PRAY = String.fromCodePoint(0x1f64f);

/** What web useChat.ts and Android useSureWordChat.ts store: the first 60 characters. */
const clientTitle = (text) => text.slice(0, 60);

const QUESTION = "What does Hebrews 7 teach about Melchizedek being a type of Christ and his priesthood?";

test("shouldAutoTitle: the raw client truncation after the first answer is un-titled", () => {
	assert.equal(
		shouldAutoTitle({ title: clientTitle(QUESTION), firstUserText: QUESTION, assistantMessageCount: 1 }),
		true,
	);
	// A short question is its own title and still a prefix.
	assert.equal(
		shouldAutoTitle({ title: "Who was Enoch?", firstUserText: "Who was Enoch?", assistantMessageCount: 1 }),
		true,
	);
});

test("shouldAutoTitle: a renamed conversation is never retitled", () => {
	assert.equal(
		shouldAutoTitle({ title: "Sunday school prep", firstUserText: QUESTION, assistantMessageCount: 1 }),
		false,
	);
});

test("shouldAutoTitle: only the first answer triggers it", () => {
	assert.equal(
		shouldAutoTitle({ title: clientTitle(QUESTION), firstUserText: QUESTION, assistantMessageCount: 2 }),
		false,
	);
	assert.equal(
		shouldAutoTitle({ title: clientTitle(QUESTION), firstUserText: QUESTION, assistantMessageCount: 0 }),
		false,
	);
});

test("shouldAutoTitle: a verse-first message and a blockquote title are un-titled", () => {
	const verseFirst = `John 3:16 ${EM_DASH} "For God so loved the world, that he gave his only begotten Son" (KJV)\n\nWhat does begotten mean?`;
	assert.equal(
		shouldAutoTitle({ title: clientTitle(verseFirst), firstUserText: verseFirst, assistantMessageCount: 1 }),
		true,
	);
	// Stored content that drifted from the title (e.g. re-composed server side) still counts by shape.
	assert.equal(
		shouldAutoTitle({ title: clientTitle(verseFirst), firstUserText: "different", assistantMessageCount: 1 }),
		true,
	);
	assert.equal(
		shouldAutoTitle({ title: `1 Corinthians 13:4-7 ${EM_DASH} "Charity suffereth long"`, firstUserText: null, assistantMessageCount: 1 }),
		true,
	);
	assert.equal(
		shouldAutoTitle({ title: "> In the beginning God created", firstUserText: "unrelated", assistantMessageCount: 1 }),
		true,
	);
});

test("shouldAutoTitle: attachment-only and placeholder titles are un-titled", () => {
	assert.equal(
		shouldAutoTitle({ title: "Attachment: sermon-notes.jpg", firstUserText: "", assistantMessageCount: 1 }),
		true,
	);
	assert.equal(shouldAutoTitle({ title: "New Conversation", firstUserText: null, assistantMessageCount: 1 }), true);
});

test("cleanGeneratedTitle: strips quotes of every style", () => {
	assert.equal(cleanGeneratedTitle('"Melchizedek and Christ\'s Priesthood"'), "Melchizedek and Christ's Priesthood");
	assert.equal(cleanGeneratedTitle("“Assurance of Salvation”"), "Assurance of Salvation");
	assert.equal(cleanGeneratedTitle("'Grace Alone'."), "Grace Alone");
	// An inner apostrophe is part of the word, not a quote.
	assert.equal(cleanGeneratedTitle("Jesus' Parables of the Kingdom"), "Jesus' Parables of the Kingdom");
});

test("cleanGeneratedTitle: strips labels, markdown and trailing punctuation", () => {
	assert.equal(cleanGeneratedTitle("Title: **The Armor of God**"), "The Armor of God");
	assert.equal(cleanGeneratedTitle("# Faith Without Works?!"), "Faith Without Works");
	assert.equal(cleanGeneratedTitle(`Walking in the Spirit ${EM_DASH}`), "Walking in the Spirit");
	assert.equal(cleanGeneratedTitle("The Prodigal Son...\nsecond line ignored"), "The Prodigal Son");
});

test("cleanGeneratedTitle: strips emoji", () => {
	assert.equal(cleanGeneratedTitle(`${EMOJI_CROSS} The Cross of Christ ${EMOJI_PRAY}`), "The Cross of Christ");
});

test("cleanGeneratedTitle: applies title case without lowering deliberate capitals", () => {
	assert.equal(cleanGeneratedTitle("the fear of the LORD"), "The Fear of the LORD");
	assert.equal(cleanGeneratedTitle("Reading Plan In McCheyne"), "Reading Plan in McCheyne");
});

test("cleanGeneratedTitle: rejects over-length, wrong word counts and empty output", () => {
	const long = "Understanding Melchizedekian Priesthood Typologically Throughout Scripture";
	assert.ok(long.length > MAX_CONVERSATION_TITLE_LENGTH);
	assert.equal(cleanGeneratedTitle(long), null);
	assert.equal(cleanGeneratedTitle("Grace"), null);
	assert.equal(cleanGeneratedTitle("One Two Three Four Five Six Seven"), null);
	assert.equal(cleanGeneratedTitle(`"" ${EMOJI_PRAY}`), null);
	assert.equal(cleanGeneratedTitle(""), null);
});

test("cleanGeneratedTitle: rejects a title that names the user", () => {
	assert.equal(cleanGeneratedTitle("Austin's Study of Romans", { forbiddenNames: ["Austin", "Spraggins"] }), null);
	assert.equal(cleanGeneratedTitle("Prayer for austin", { forbiddenNames: ["Austin"] }), null);
	// Whole words only: a name inside another word is not the name.
	assert.equal(cleanGeneratedTitle("The Book of Job", { forbiddenNames: ["Jo"] }), "The Book of Job");
	assert.equal(cleanGeneratedTitle("The Book of Ruth", { forbiddenNames: [null, ""] }), "The Book of Ruth");
});
