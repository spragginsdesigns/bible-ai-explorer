import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NOTE_HOUSE_STYLE } from "../src/utils/noteHouseStyle.ts";

// Written as an escape on purpose: tooling on this machine flattens a literal
// em dash to a hyphen, which would make the dash assertion pass for the wrong
// reason.
const EM_DASH = "\u2014";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

test("the verse attribution line carries a real em dash, not a hyphen", () => {
	assert.ok(NOTE_HOUSE_STYLE.includes(`"> ${EM_DASH} Book Chapter:Verse, KJV"`));
	assert.ok(!NOTE_HOUSE_STYLE.includes('"> - Book'));
});

test("the voice rule names first person and forbids the user's name", () => {
	assert.match(NOTE_HOUSE_STYLE, /first person/);
	assert.match(NOTE_HOUSE_STYLE, /Never use the user's name/);
	assert.match(NOTE_HOUSE_STYLE, /third person/);
});

test("the block carries every house-style rule", () => {
	for (const rule of [
		/400 to 900 words/,
		/never a bare reference/,
		/date, preacher, church and passage/,
		/3 to 7 "## " headings/,
		/inline in parentheses/,
		/Bold only a term being defined/,
		/what they will do next/,
		/Scripture is silent/,
		/Related: \[\[Exact Title\]\]/,
		/readNote it and rewrite it with updateNote/,
	]) {
		assert.match(NOTE_HOUSE_STYLE, rule);
	}
});

test("the block stays compact enough to ride on two tool descriptions", () => {
	assert.ok(NOTE_HOUSE_STYLE.length < 1400, `length ${NOTE_HOUSE_STYLE.length}`);
});

test("addToNote and updateNote both append the house style", () => {
	const source = read("../src/lib/ai-tools.ts");
	const section = (name, next) => source.slice(source.indexOf(`const ${name} = tool({`), source.indexOf(`const ${next} = tool({`));
	assert.match(section("addToNoteTool", "readNoteTool"), /\$\{NOTE_HOUSE_STYLE\}/);
	assert.match(section("updateNoteTool", "findNotesTool"), /\$\{NOTE_HOUSE_STYLE\}/);
	// The descriptions must not interpolate anything per user beyond what they
	// already did, or the prompt cache key would need to change.
	assert.doesNotMatch(section("addToNoteTool", "readNoteTool"), /context\.userId\}/);
});
