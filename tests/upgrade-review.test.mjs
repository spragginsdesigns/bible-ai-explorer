import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getKjvBookName, getKjvBookNumber, getKjvVerseText } from "../src/utils/kjvBible.ts";
import { countWords, htmlToPlainText, markdownToNoteHtml } from "../src/lib/markdown.ts";

test("both chat routes run GPT-5.6 Terra through the AI SDK with tools", async () => {
	for (const route of ["ask-question", "note-ai"]) {
		const source = await readFile(
			new URL(`../src/app/api/${route}/route.ts`, import.meta.url),
			"utf8"
		);

		assert.match(source, /openai\("gpt-5\.6-terra"\)/, route);
		assert.match(source, /reasoningEffort/, route);
		assert.match(source, /buildSureWordTools/, route);
		assert.match(source, /toUIMessageStream/, route);
		assert.match(source, /result\.consumeStream\(\)/, route);
		assert.doesNotMatch(source, /langchain/i, route);
		assert.doesNotMatch(source, /\btemperature\s*:/, route);
	}
});

test("main chat escalates reasoning effort for opening questions only", async () => {
	const source = await readFile(
		new URL("../src/app/api/ask-question/route.ts", import.meta.url),
		"utf8"
	);
	assert.match(source, /isOpeningQuestion \? "high" : "medium"/);
});

test("resolves KJV book names, numbers, and aliases", () => {
	assert.equal(getKjvBookName(43), "John");
	assert.equal(getKjvBookNumber("John"), 43);
	assert.equal(getKjvBookNumber("psalm"), 19);
	assert.equal(getKjvBookNumber("Song of Songs"), 22);
	assert.equal(getKjvBookNumber("1st John"), 62);
	assert.equal(getKjvBookNumber("II Timothy"), 55);
	assert.equal(getKjvBookNumber("Revelations"), 66);
	assert.equal(getKjvBookNumber("Book of Mormon"), undefined);
});

test("resolves representative KJV verses from the shared corpus", async () => {
	assert.equal(
		await getKjvVerseText(1, 1, 1),
		"In the beginning God created the heaven and the earth."
	);
	assert.equal(
		await getKjvVerseText(43, 3, 16),
		"For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life."
	);
	assert.equal(
		await getKjvVerseText(66, 22, 21),
		"The grace of our Lord Jesus Christ be with you all. Amen."
	);
});

test("renders note markdown to Tiptap-compatible HTML", () => {
	const html = markdownToNoteHtml(
		"## Faith and Works\n\n> James 2:17 KJV: \"Even so faith, if it hath not works, is dead, being alone.\"\n\n- point one\n- point two"
	);

	assert.match(html, /<h2>Faith and Works<\/h2>/);
	assert.match(html, /<blockquote>/);
	assert.match(html, /<ul>/);
	assert.match(html, /<li>point one<\/li>/);
});

test("strips active content from generated note HTML", () => {
	const html = markdownToNoteHtml(
		'Hello <script>alert("x")</script> world <a href="javascript:alert(1)" onclick="alert(2)">link</a>'
	);

	assert.doesNotMatch(html, /<script/);
	assert.doesNotMatch(html, /onclick=/);
	assert.doesNotMatch(html, /javascript:/);
	assert.match(html, /Hello/);
	assert.match(html, /world/);
});

test("derives plain text and word counts from note HTML", () => {
	const plain = htmlToPlainText("<h2>Title</h2><p>One &amp; two</p><ul><li>three</li></ul>");
	assert.equal(plain, "Title\nOne & two\nthree");
	assert.equal(countWords(plain), 5);
});
