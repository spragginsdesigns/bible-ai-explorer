/* "Share an answer: a public page, and a card image" (docs/FEATURES.md).
 *
 * The snapshot rules are pure, so they are tested directly. The two things
 * that are not pure - which module strips the follow-up markers, and which
 * paths the middleware lets through signed out - are tested as source
 * contracts against the shipped files, because getting either one wrong is
 * silent: a marker leaks into a public page, or a mint/revoke route becomes
 * reachable without a session.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	MAX_SHARED_ANSWER_LENGTH,
	MAX_SHARED_QUESTION_LENGTH,
	MAX_SHARED_REFERENCES,
	SHARED_ANSWER_FALLBACK_TITLE,
	SHARED_ANSWER_ID_LENGTH,
	SHARED_CARD_EXCERPT_LENGTH,
	SHARED_DESCRIPTION_LENGTH,
	SHARED_TITLE_LENGTH,
	clipText,
	createSharedAnswerId,
	extractReferences,
	isSharedAnswerId,
	plainTextFromMarkdown,
	shareAnswer,
	shareCardExcerpt,
	shareDescription,
	shareQuestion,
	shareTitle,
	shareTranslation,
	sharedAnswerCardUrl,
	sharedAnswerUrl,
} from "../src/lib/shared-answer.ts";
import { stripFollowUpMarkers } from "../src/utils/assistantMarkdown.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

const ELLIPSIS = "…";

// ---------------------------------------------------------------------------
// The id is the capability
// ---------------------------------------------------------------------------

test("share ids are 16 URL-safe characters and never repeat", () => {
	const ids = new Set();
	for (let i = 0; i < 500; i += 1) {
		const id = createSharedAnswerId();
		assert.equal(id.length, SHARED_ANSWER_ID_LENGTH);
		assert.match(id, /^[A-Za-z0-9_-]{16}$/, `${id} is not URL-safe`);
		assert.equal(ids.has(id), false, `${id} was minted twice`);
		ids.add(id);
	}
});

test("share ids never carry base64 padding or a path character", () => {
	for (let i = 0; i < 200; i += 1) {
		const id = createSharedAnswerId();
		assert.equal(id.includes("="), false);
		assert.equal(id.includes("/"), false);
		assert.equal(id.includes("+"), false);
	}
});

test("only a well-formed id reaches the database", () => {
	assert.equal(isSharedAnswerId(createSharedAnswerId()), true);
	assert.equal(isSharedAnswerId("short"), false);
	assert.equal(isSharedAnswerId("../../../etc/passwd"), false);
	assert.equal(isSharedAnswerId("aaaaaaaaaaaaaaaaa"), false, "17 characters is not an id");
	assert.equal(isSharedAnswerId("aaaaaaaaaaaaaaa."), false, "a dot is not URL-safe here");
	assert.equal(isSharedAnswerId(null), false);
	assert.equal(isSharedAnswerId(12), false);
});

test("link shapes are absolute and point at sureword.app", () => {
	assert.equal(sharedAnswerUrl("abc123DEF456ghi7"), "https://sureword.app/shared/abc123DEF456ghi7");
	assert.equal(
		sharedAnswerCardUrl("abc123DEF456ghi7"),
		"https://sureword.app/api/shared/abc123DEF456ghi7/image",
	);
});

// ---------------------------------------------------------------------------
// Clipping
// ---------------------------------------------------------------------------

test("clipText leaves text inside the budget untouched", () => {
	assert.equal(clipText("  In the beginning  ", 50), "In the beginning");
});

test("clipText never exceeds the budget, ellipsis included", () => {
	const clipped = clipText("a ".repeat(400), 40);
	assert.equal(clipped.length <= 40, true, `clip was ${clipped.length} characters`);
	assert.equal(clipped.endsWith(ELLIPSIS), true);
});

test("clipText cuts at a word boundary rather than mid-word", () => {
	assert.equal(clipText("Jesus wept for Lazarus", 12), `Jesus wept${ELLIPSIS}`);
});

test("clipText still clips an unbroken token that has no boundary to find", () => {
	const clipped = clipText("x".repeat(100), 20);
	assert.equal(clipped.length, 20);
	assert.equal(clipped, `${"x".repeat(19)}${ELLIPSIS}`);
});

test("the question is collapsed to one line and fits the VarChar(500) column", () => {
	assert.equal(shareQuestion("  What does\n\n grace   mean? "), "What does grace mean?");
	const long = shareQuestion("grace ".repeat(400));
	assert.equal(long.length <= MAX_SHARED_QUESTION_LENGTH, true);
	assert.equal(long.includes("\n"), false);
});

test("the answer keeps its markdown line structure and is capped", () => {
	const answer = shareAnswer("# Grace\r\n\r\n- One\r\n- Two\r\n");
	assert.equal(answer, "# Grace\n\n- One\n- Two");
	const long = shareAnswer("word ".repeat(3000));
	assert.equal(long.length <= MAX_SHARED_ANSWER_LENGTH, true);
});

// ---------------------------------------------------------------------------
// Unfurl text
// ---------------------------------------------------------------------------

test("the title is the question clipped to 70 characters", () => {
	const title = shareTitle("What does the Bible say about ".repeat(5));
	assert.equal(title.length <= SHARED_TITLE_LENGTH, true, `title was ${title.length}`);
	assert.equal(shareTitle("Who was Melchizedek?"), "Who was Melchizedek?");
});

test("an answer with no question still has a title", () => {
	assert.equal(shareTitle(""), SHARED_ANSWER_FALLBACK_TITLE);
	assert.equal(shareTitle("   \n  "), SHARED_ANSWER_FALLBACK_TITLE);
});

test("the description is prose, not markdown syntax", () => {
	const description = shareDescription(
		"## Grace\n\nGrace is **unmerited** favour, see [John 3:16](/bible?v=John+3:16).\n\n> For God so loved\n\n- It is a gift\n",
	);
	assert.equal(description.length <= SHARED_DESCRIPTION_LENGTH, true);
	for (const token of ["##", "**", "](", ">", "- "]) {
		assert.equal(description.includes(token), false, `"${token}" survived into the description`);
	}
	assert.equal(description.startsWith("Grace Grace is unmerited favour, see John 3:16."), true);
});

test("fenced code and images are dropped from the preview text", () => {
	const plain = plainTextFromMarkdown("Before\n\n```js\nconst x = 1;\n```\n\n![a chart](/c.png)\n\nAfter");
	assert.equal(plain.includes("const x"), false);
	assert.equal(plain.includes("a chart"), false);
	assert.equal(plain, "Before After");
});

test("the card excerpt is about 200 characters of prose", () => {
	const excerpt = shareCardExcerpt("**Grace** is unmerited favour. ".repeat(40));
	assert.equal(excerpt.length <= SHARED_CARD_EXCERPT_LENGTH, true, `excerpt was ${excerpt.length}`);
	assert.equal(excerpt.includes("**"), false);
});

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

test("references come out of a legacy retrievedVerses metadata row", () => {
	assert.deepEqual(
		extractReferences({
			retrievedVerses: [
				{ reference: "John 3:16", text: "For God so loved" },
				{ reference: "Romans 5:8", text: "But God commendeth" },
			],
		}),
		["John 3:16", "Romans 5:8"],
	);
});

test("references come out of persisted tool parts", () => {
	const metadata = {
		parts: [
			{ type: "text", text: "Here is what Scripture says." },
			{
				type: "tool-searchScripture",
				state: "output-available",
				output: { verses: [{ reference: "Ephesians 2:8" }, { reference: "Ephesians 2:9" }] },
			},
			{ type: "tool-webSearch", state: "output-available", output: { results: [{ url: "x" }] } },
			{
				type: "tool-getPassage",
				state: "output-available",
				output: { verses: [{ reference: "Titus 3:5" }] },
			},
		],
	};
	assert.deepEqual(extractReferences(metadata), ["Ephesians 2:8", "Ephesians 2:9", "Titus 3:5"]);
});

test("references keep answer order, deduplicate, and stay capped", () => {
	const metadata = {
		retrievedVerses: [{ reference: "John 3:16" }],
		parts: [
			{
				type: "tool-findVerses",
				output: { verses: Array.from({ length: 40 }, (_, i) => ({ reference: `Psalm ${i + 1}:1` })) },
			},
			{ type: "tool-getPassage", output: { verses: [{ reference: "John 3:16" }] } },
		],
	};
	const references = extractReferences(metadata);
	assert.equal(references[0], "John 3:16");
	assert.equal(references.length, MAX_SHARED_REFERENCES);
	assert.equal(new Set(references).size, references.length);
});

test("junk metadata yields no references rather than throwing", () => {
	assert.deepEqual(extractReferences(null), []);
	assert.deepEqual(extractReferences("nope"), []);
	assert.deepEqual(extractReferences([1, 2, 3]), []);
	assert.deepEqual(extractReferences({ parts: "not an array" }), []);
	assert.deepEqual(extractReferences({ retrievedVerses: [{ reference: 42 }, null, {}] }), []);
	assert.deepEqual(extractReferences({ retrievedVerses: [{ reference: "x".repeat(200) }] }), []);
});

test("the translation falls back from the turn to the account to KJV", () => {
	assert.equal(shareTranslation({ translation: "BSB" }, "NKJV"), "BSB");
	assert.equal(shareTranslation({}, "NKJV"), "NKJV");
	assert.equal(shareTranslation(null, null), "KJV");
	assert.equal(shareTranslation(null, "  "), "KJV");
});

// ---------------------------------------------------------------------------
// Follow-up markers must not reach a public page
// ---------------------------------------------------------------------------

test("follow-up markers are stripped from an answer before it is snapshotted", () => {
	const raw = "Grace is unmerited favour.\n\n[FOLLOWUP] What is mercy?\n[FOLLOWUP] Who was Paul?";
	const snapshot = shareAnswer(stripFollowUpMarkers(raw, { streaming: false }));
	assert.equal(snapshot.includes("[FOLLOWUP]"), false);
	assert.equal(snapshot, "Grace is unmerited favour.");
});

test("the share route strips markers with the shared module, not a local copy", () => {
	const source = read("src/app/api/shared/route.ts");
	assert.match(source, /from "@\/utils\/assistantMarkdown"/);
	assert.match(source, /stripFollowUpMarkers\(message\.content, \{ streaming: false \}\)/);
});

// ---------------------------------------------------------------------------
// Only the page and the card are public
// ---------------------------------------------------------------------------

test("middleware lets the shared page and its card through signed out", () => {
	const source = read("src/middleware.ts");
	assert.equal(source.includes('"/shared/(.*)"'), true, "the public page is not exempt");
	assert.equal(
		source.includes('"/api/shared/(.*)/image"'),
		true,
		"the unfurl card is not exempt",
	);
});

test("the mint, list and revoke routes stay behind the session", () => {
	const source = read("src/middleware.ts");
	for (const pattern of ['"/api/shared"', '"/api/shared(.*)"', '"/api/shared/(.*)"']) {
		assert.equal(
			source.includes(pattern),
			false,
			`${pattern} would expose minting or revoking a share to anyone`,
		);
	}
});

test("neither public surface reads the Message table", () => {
	for (const file of ["src/app/shared/[id]/page.tsx", "src/app/api/shared/[id]/image/route.tsx"]) {
		const source = read(file);
		assert.equal(
			/prisma\.message\b/.test(source),
			false,
			`${file} reads Message; the snapshot is the only thing a public page may show`,
		);
		assert.match(source, /revokedAt: null/, `${file} does not exclude revoked shares`);
	}
});
