/* Answering challenges to Scripture: mistranslation claims, borrowed beliefs,
 * skeptics, and the /check and /reply commands.
 *
 * Pins that the guidance reaches the chat prompt in every translation, that the
 * tools it tells the model to call are real registered tools (a renamed tool
 * would leave the guidance pointing at nothing), and that the two commands are
 * on every client's palette and taught to the model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	appKnowledge,
	chatSystemPrompt,
	discernmentGuidance,
	slashCommandGuidance,
	taskGuidance,
} from "../src/utils/systemPrompt.ts";
import { CHAT_SLASH_COMMANDS } from "../src/lib/chat/slashCommands.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("chat prompt carries the discernment guidance in every translation", () => {
	for (const translation of ["KJV", "NKJV", "BSB"]) {
		const prompt = chatSystemPrompt(translation, { userText: "Does the KJV mistranslate this?" });
		assert.ok(prompt.includes(discernmentGuidance));
		assert.match(prompt, /never concede that the KJV is wrong/);
		assert.doesNotMatch(prompt, /never concede that the (?:NKJV|BSB) is wrong/);
	}
});

test("every chat answer carries the discernment guidance, with no trigger words", () => {
	// Austin, 2026-10-27: this question matched none of the old keywords, so
	// the model never saw the guidance and answered like a neutral scholar.
	const question =
		"why did the bible keep changing? the original bible for Christians didn't have the old testament, and they constantly have been adding and removing books and verses, like the apocrypha. why, if we're told the bible never changes?";
	// The route caches chatSystemPrompt(translation, {}) as the stable prefix,
	// so the guidance has to be in it with no user text at all.
	assert.ok(chatSystemPrompt("KJV", {}).includes(discernmentGuidance));
	assert.ok(chatSystemPrompt("KJV", { userText: question }).includes(discernmentGuidance));
	assert.equal(taskGuidance({ userText: "Does the KJV mistranslate this?" }).includes(discernmentGuidance), false, "sent twice");
	assert.equal(chatSystemPrompt("KJV", {}).split(discernmentGuidance).length, 2, "exactly once");
});

test("the foundation makes every answer a saved believer's, Scripture the only truth", async () => {
	const { doctrinalFoundation } = await import("../src/utils/systemPrompt.ts");
	assert.match(doctrinalFoundation, /ALWAYS ANSWER AS A SAVED BELIEVER WHERE SCRIPTURE IS THE ONLY TRUTH/);
	assert.ok(chatSystemPrompt("KJV", {}).startsWith(doctrinalFoundation));
});

test("guidance answers whether the Bible changed as a believer", () => {
	for (const pattern of [/Psalm 12:6-7/, /Romans 3:2/, /Apocrypha/, /Received Text/, /their omissions, not KJV additions/, /Isaiah 40:8/, /not "one position"/]) {
		assert.match(discernmentGuidance, pattern);
	}
});

test("guidance covers mistranslation claims, borrowed beliefs, skeptics, checking and replying", () => {
	assert.match(discernmentGuidance, /mistranslates/);
	assert.match(discernmentGuidance, /karma/);
	assert.match(discernmentGuidance, /Skeptics/);
	assert.match(discernmentGuidance, /what they get right/);
	assert.match(discernmentGuidance, /Never claim the reply was sent/);
});

test("every tool the guidance names is a registered tool", () => {
	const tools = read("src/lib/ai-tools.ts");
	for (const name of ["getOriginalText", "lookupStrongs", "searchOriginalLanguage", "webSearch"]) {
		assert.match(discernmentGuidance, new RegExp(`\\b${name}\\b`), name);
		assert.match(tools, new RegExp(`\\b${name}:`), `${name} is not registered in ai-tools.ts`);
	}
});

test("/check and /reply are on the web and Android palettes and taught to the model", () => {
	const androidTable = read("mobile/src/features/chat/slashCommands.ts");
	const appleTable = read("macos/Shared/Chat/SlashCommands.swift");
	for (const command of ["/check", "/reply"]) {
		const def = CHAT_SLASH_COMMANDS.find((c) => c.command === command);
		assert.ok(def, `${command} missing on web`);
		assert.equal(def.kind, "ai");
		// Works with only an attachment, so it must never block a bare send.
		assert.notEqual(def.requiresArgs, true, command);
		assert.ok(def.hint, `${command} needs a hint so the palette fills the input`);
		assert.ok(androidTable.includes(`command: "${command}"`), `${command} missing on Android`);
		assert.ok(appleTable.includes(`command: "${command}"`), `${command} missing on Apple`);
		assert.ok(slashCommandGuidance.includes(`"${command}"`), `${command} not in slashCommandGuidance`);
		assert.ok(appKnowledge.includes(command), `${command} not in appKnowledge`);
	}
	assert.deepEqual(CHAT_SLASH_COMMANDS.find((c) => c.command === "/reply").aliases, ["/answer"]);
});
