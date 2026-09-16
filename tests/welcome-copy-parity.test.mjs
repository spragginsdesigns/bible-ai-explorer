import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const welcomeSurfaces = [
	["web", read("src/components/WelcomeScreen.tsx")],
	["Android", read("mobile/src/features/chat/WelcomeState.tsx")],
	["macOS", read("macos/SureWord/Chat/Views/WelcomeState.swift")],
	["iOS", read("macos/SureWord-iOS/Views/Chat/WelcomeState.swift")],
];

const headline = "Come hungry for the Word.";
// The em dash is an escape on purpose: this file is edited on Windows, where a
// literal U+2014 does not survive every editor round-trip, and a flattened dash
// would make the negative check below pass against the very copy it guards.
const companionPromise =
	"SureWord is your personal Bible study companion, shaped by your reading, questions, notes, and daily walk\u2014helping you go deeper in Scripture every day.";
const verse = "As newborn babes, desire the sincere milk of the word, that ye may grow thereby:";
const trust =
	"Scripture comes first. Every answer is grounded in God's inerrant, infallible Word.";

test("active clients open a chat, not a brochure: headline and the study heading only", () => {
	for (const [client, source] of welcomeSurfaces) {
		const normalized = source.replaceAll("&apos;", "'").replace(/\s+/g, " ");
		assert.ok(normalized.includes(headline), `${client} is missing the approved headline`);
		assert.ok(source.includes("CHOSEN FROM YOUR STUDY"), `${client} is missing the study heading`);
	}
});

test("marketing copy stays on the signed-out landing page, off every empty-chat surface", () => {
	for (const [client, source] of welcomeSurfaces) {
		const normalized = source.replaceAll("&apos;", "'").replace(/\s+/g, " ");
		assert.ok(!normalized.includes(companionPromise), `${client} restored the companion pitch`);
		// Dash-insensitive twin of the line above: a restore whose em dash was
		// flattened to a hyphen must fail the same way.
		assert.ok(!normalized.includes("personal Bible study companion"), `${client} restored the companion pitch`);
		assert.ok(!normalized.includes(verse), `${client} restored the 1 Peter 2:2 lead`);
		assert.ok(!source.includes("1 Peter 2:2, KJV"), `${client} restored the verse citation`);
		assert.ok(!normalized.includes(trust), `${client} restored the trust statement`);
		assert.ok(!source.includes("light that shineth in a dark place"), `${client} restored the old brand verse lead`);
		assert.ok(!source.includes("AI that actually believes it"), `${client} restored the old AI-first lead`);
		assert.ok(!source.includes("QUESTIONS FOR YOUR STUDY"), `${client} restored the generic study heading`);
	}
});

test("release-facing copy leads with the same product promise", () => {
	for (const path of ["README.md", "mobile/README.md", "docs/PLAY_STORE.md", "src/app/layout.tsx"]) {
		const source = read(path);
		assert.ok(source.includes("Come hungry for the Word"), `${path} is missing the approved lead`);
		assert.ok(source.includes("personal Bible study companion"), `${path} is missing the companion positioning`);
	}
});
