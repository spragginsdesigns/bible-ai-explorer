/* Share cards (docs/FEATURES.md, "Share cards").
 *
 * The layout half is pure and tested directly: what a card says and how big
 * its type is. The drawing half needs satori and the real fonts, so it is
 * proven by rendering (see the docs); what is pinned here as source
 * contracts is who may fetch a card, because getting that wrong is silent.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	MAX_CARD_VERSES,
	cardDateLabel,
	cardReferenceLabel,
	cardScriptureText,
	fitText,
	measureText,
	parseShareCardFormat,
	parseShareCardSize,
	parseShareCardStyle,
	quoteScripture,
	superscriptNumber,
	wrapText,
} from "../src/lib/share-cards/layout.ts";
import { GLYPH_WIDTHS } from "../src/lib/share-cards/glyph-widths.ts";
import { verseSlug as serverSlug, verseDoor } from "../src/lib/share-cards/layout.ts";
import { verseSlug as clientSlug, shareCardPath, SHARE_CARD_DESIGN_VERSION as CLIENT_VERSION } from "../src/lib/share-cards/targets.ts";
import { SHARE_CARD_DESIGN_VERSION as SERVER_VERSION } from "../src/lib/share-cards/layout.ts";

/** Built from its code point: some tools on this machine rewrite the literal. */
const NBSP = String.fromCharCode(0xa0);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");

const ESTHER_8_9 =
	"Then were the king's scribes called at that time in the third month, that is, the month Sivan, on the three and twentieth day thereof; and it was written according to all that Mordecai commanded unto the Jews, and to the lieutenants, and the deputies and rulers of the provinces which are from India unto Ethiopia, an hundred twenty and seven provinces, unto every province according to the writing thereof, and unto every people after their language, and to the Jews according to their writing, and according to their language.";

test("unknown styles, formats and sizes fall back instead of failing", () => {
	assert.equal(parseShareCardStyle("parchment"), "parchment");
	assert.equal(parseShareCardStyle("neon"), "dawn");
	assert.equal(parseShareCardStyle(null), "dawn");
	assert.equal(parseShareCardFormat("square"), "square");
	assert.equal(parseShareCardFormat("poster"), "story");
	assert.equal(parseShareCardFormat(undefined, "wide"), "wide");
	assert.equal(parseShareCardSize("preview"), "preview");
	assert.equal(parseShareCardSize("huge"), "full");
});

test("verse numbers in a range are superscript glyphs, one verse is bare", () => {
	assert.equal(superscriptNumber(16), "¹⁶");
	assert.equal(superscriptNumber(150), "¹⁵⁰");
	assert.equal(cardScriptureText([{ verse: 35, text: "Jesus wept." }]), "Jesus wept.");
	const range = cardScriptureText([
		{ verse: 1, text: "The LORD is my shepherd; I shall not want." },
		{ verse: 2, text: "He maketh me to lie down  in green pastures:" },
	]);
	assert.equal(range, `¹${NBSP}The LORD is my shepherd; I shall not want. ²${NBSP}He maketh me to lie down in green pastures:`);
	// The no-break space survives fitting, so a number never ends a line alone.
	const fitted = fitText({ text: range, table: GLYPH_WIDTHS.verse, maxWidth: 400, maxHeight: 2000, sizes: [40], lineHeight: 1.3 });
	assert.ok(fitted.text.includes(`²${NBSP}He`));
	for (const line of wrapText(range, 300, { table: GLYPH_WIDTHS.verse, fontSize: 40 })) {
		assert.doesNotMatch(line, /[¹²]$/, line);
	}
});

test("a range stays numbered even when one of its verses has no text", () => {
	// BSB omits Matthew 18:11; the card must still read as the range 10-11.
	const text = cardScriptureText([
		{ verse: 10, text: "See that you do not look down on any of these little ones." },
		{ verse: 11, text: "" },
	]);
	assert.ok(text.startsWith(`¹⁰${NBSP}See`), text);
	assert.equal(quoteScripture(text), text);
});

test("only a single verse is set in quotation marks", () => {
	assert.equal(quoteScripture("Jesus wept."), "“Jesus wept.”");
	assert.equal(quoteScripture(`¹${NBSP}The LORD is my shepherd`), `¹${NBSP}The LORD is my shepherd`);
});

test("a verse from the Psalms is Psalm, the book is Psalms", () => {
	assert.equal(cardReferenceLabel("Psalms 23:1-4"), "Psalm 23:1-4");
	assert.equal(cardReferenceLabel("Psalms"), "Psalms");
	assert.equal(cardReferenceLabel("John 3:16"), "John 3:16");
});

test("wrapping keeps words whole and never makes an empty line", () => {
	const metrics = { table: GLYPH_WIDTHS.verse, fontSize: 60 };
	const lines = wrapText(ESTHER_8_9, 872, metrics);
	assert.ok(lines.length > 5);
	assert.equal(lines.join(" "), ESTHER_8_9);
	for (const line of lines.slice(0, -1)) assert.ok(measureText(line, metrics) <= 872, line);
	// A word wider than the box gets a line of its own rather than vanishing.
	assert.deepEqual(wrapText("Mahershalalhashbaz", 50, metrics), ["Mahershalalhashbaz"]);
});

test("the fitter picks the largest size whose wrapped height fits", () => {
	const sizes = [112, 96, 80, 64, 48, 36];
	const short = fitText({ text: "Jesus wept.", table: GLYPH_WIDTHS.verse, maxWidth: 872, maxHeight: 900, sizes, lineHeight: 1.3 });
	assert.equal(short.fontSize, 112);
	assert.equal(short.truncated, false);

	const long = fitText({ text: ESTHER_8_9, table: GLYPH_WIDTHS.verse, maxWidth: 872, maxHeight: 900, sizes, lineHeight: 1.3 });
	assert.ok(long.fontSize < 112 && long.fontSize >= 36, `chose ${long.fontSize}`);
	assert.ok(long.lines * long.fontSize * 1.3 <= 900);
	assert.equal(long.truncated, false);
	// And it is the largest: one step up would not have fitted.
	const larger = sizes[sizes.indexOf(long.fontSize) - 1];
	const widerLines = wrapText(ESTHER_8_9, 872 * 0.98, { table: GLYPH_WIDTHS.verse, fontSize: larger });
	assert.ok(widerLines.length * larger * 1.3 > 900);
});

test("text that cannot fit is clipped at a word with an ellipsis, inside the box", () => {
	const result = fitText({
		text: ESTHER_8_9,
		table: GLYPH_WIDTHS.verse,
		maxWidth: 600,
		maxHeight: 200,
		sizes: [40, 32],
		lineHeight: 1.3,
	});
	assert.equal(result.truncated, true);
	assert.equal(result.fontSize, 32);
	assert.ok(result.text.endsWith("…"));
	assert.ok(!/[,;:]…$/.test(result.text), result.text);
	assert.ok(ESTHER_8_9.startsWith(result.text.slice(0, -1).trimEnd().replace(/[,;:.]$/, "")));
	assert.ok(result.lines * 32 * 1.3 <= 200);
});

test("the card date is the reader's day, and a bad zone falls back to UTC", () => {
	// 03:30 UTC on Oct 17 is still the 16th in Chicago.
	const instant = new Date("2026-10-17T03:30:00Z");
	assert.equal(cardDateLabel(instant, "America/Chicago"), "Friday, October 16");
	assert.equal(cardDateLabel(instant, "Not/AZone"), "Saturday, October 17");
});

test("verse cards are public; the personal cross card is not", () => {
	const middleware = read("src/middleware.ts");
	assert.ok(middleware.includes('"/api/cards/verse",'), "the verse card is public by its exact path");
	assert.equal(middleware.includes('"/api/cards/verse('), false, "a wildcard would make any route under it public");
	assert.equal(/"\/api\/cards\/cross[^"]*"/.test(middleware), false, "the cross card must stay behind the session");
	assert.equal(/"\/api\/cards\(\.\*\)"/.test(middleware), false, "a blanket /api/cards would expose the cross card");
});

test("nothing else lives under the public verse path", () => {
	const entries = readdirSync(join(root, "src/app/api/cards/verse"));
	assert.deepEqual(entries, ["route.tsx"], "a second route here would be public and could draw caller text");
});

test("the public verse card draws only Scripture the server looked up", () => {
	const route = read("src/app/api/cards/verse/route.tsx");
	assert.match(route, /canonicalPassage\(reference, translation\)/);
	// One URL per card: anything else redirects before a render.
	assert.match(route, /status: 308/);
	assert.match(route, /CardTooLongError\) return failure\(422/);
	for (const param of ["text", "question", "excerpt", "body"]) {
		assert.equal(route.includes(`searchParams.get("${param}")`), false, `the route reads ${param} from the caller`);
	}
	assert.match(route, new RegExp(`MAX_CARD_VERSES`));
	assert.equal(MAX_CARD_VERSES, 10);
});

test("the cross card is owner-scoped and never draws why-today", () => {
	const route = read("src/app/api/cards/cross/[id]/route.tsx");
	assert.match(route, /await getAuthUser\(\)/);
	assert.match(route, /where: \{ id, userId \}/);
	assert.match(route, /err instanceof CardTooLongError/);
	assert.equal(route.includes("whyToday: true"), false);
	assert.equal(route.includes("application: true"), false);
});

test("the web and Android card modules are one file", () => {
	assert.equal(
		read("src/lib/share-cards/targets.ts"),
		read("mobile/src/features/shareCards/shareCards.ts"),
		"copy mobile/src/features/shareCards/shareCards.ts over src/lib/share-cards/targets.ts (or the reverse)"
	);
});

test("Send to someone offers only a passage the word route takes", () => {
	// The clients hide the button past this length; the server refuses past its own.
	const client = read("src/lib/share-cards/targets.ts").match(/MAX_WORD_VERSES = ([0-9]+);/);
	const server = read("src/lib/share-cards/personal.ts").match(/MAX_WORD_PASSAGE_VERSES = ([0-9]+);/);
	assert.ok(client && server, "both limits are declared as plain numbers");
	assert.equal(client[1], server[1]);
	const swift = read("macos/Shared/Share/ShareCards.swift").match(/maxWordVerses = ([0-9]+)/);
	if (swift) assert.equal(swift[1], server[1], "the Apple sheet carries the same limit");
});

test("clients and server agree on the design version, the door and the canonical URL", () => {
	assert.equal(CLIENT_VERSION, SERVER_VERSION);
	for (const reference of ["John 3:16", "1 John 1:9", "Song of Solomon 2:1-3", "Psalms 23:1-4"]) {
		assert.equal(clientSlug(reference), serverSlug(reference), reference);
	}
	assert.equal(verseDoor("Psalms 23:1-4"), "sureword.app/v/psalms-23-1-4");
	// The client builds exactly the query the verse route treats as canonical.
	const path = shareCardPath(
		{ kind: "verse", reference: "John 3:16", translation: "KJV" },
		{ style: "dawn", format: "story", size: "preview", note: true }
	);
	assert.equal(path, `/api/cards/verse?ref=John+3%3A16&translation=KJV&style=dawn&format=story&note=1&size=preview&v=${SERVER_VERSION}`);
	const route = read("src/app/api/cards/verse/route.tsx");
	assert.ok(route.includes("new URLSearchParams({ ref: parsed.label, translation, style, format })"));
	assert.ok(route.indexOf('canonical.set("note", "1")') < route.indexOf('canonical.set("size", "preview")'));
});

test("the public card never writes an encouragement; only the signed-in route does", () => {
	const route = read("src/app/api/cards/verse/route.tsx");
	assert.ok(route.includes("readEncouragement("));
	assert.equal(route.includes("ensureEncouragement"), false, "a public cache miss must never spend a model call");
	const writer = read("src/app/api/cards/encouragement/route.ts");
	assert.ok(writer.includes("await getAuthUser()"));
	assert.ok(writer.includes("generationLimiter.check(userId)"));
	const middleware = read("src/middleware.ts");
	assert.equal(middleware.includes("/api/cards/encouragement"), false);
});

// ---------------------------------------------------------------------------
// Send a word: personal cards carry caller text, so every rule is pinned here
// ---------------------------------------------------------------------------

test("what the sender says about the situation is never stored", () => {
	const route = read("src/app/api/cards/word/route.ts");
	const create = route.slice(route.indexOf("prisma.sharedCard.create"));
	assert.ok(create.length > 0);
	assert.equal(create.slice(0, create.indexOf("select:")).includes("situation"), false, "situation must not reach the row");
	assert.equal(read("prisma/schema.prisma").match(/model SharedCard \{[\s\S]*?\n\}/)?.[0].includes("situation"), false);
	assert.ok(route.includes("await getAuthUser()"));
	assert.ok(route.includes("draftLimiter.check(userId)"));
});

test("SureWord's word is written by the server, never taken from a request", () => {
	const publish = read("src/app/api/cards/personal/route.ts");
	assert.equal(publish.includes("body?.message"), false);
	assert.equal(publish.includes("body?.word"), false);
	const edit = read("src/app/api/cards/personal/[id]/route.ts");
	assert.equal(edit.includes("message:"), false, "PATCH may only change the sender's own line and name");
	assert.ok(edit.includes("status: 409"), "a sent card is frozen");
});

test("only published, unrevoked personal cards are public, and only by their own paths", () => {
	for (const file of ["src/app/api/cards/c/[id]/image/route.tsx", "src/app/c/[id]/page.tsx"]) {
		const source = read(file);
		assert.ok(source.includes("revokedAt: null, publishedAt: { not: null }"), file);
	}
	assert.ok(read("src/app/c/[id]/page.tsx").includes("robots: { index: false }"));
	const middleware = read("src/middleware.ts");
	assert.ok(middleware.includes('"/c/(.*)",'));
	assert.ok(middleware.includes('"/api/cards/c/(.*)/image",'));
	assert.equal(middleware.includes('"/api/cards/personal'), false, "drafting, listing and revoking stay behind the session");
	assert.equal(middleware.includes('"/api/cards/word'), false);
	const preview = read("src/app/api/cards/personal/[id]/image/route.tsx");
	assert.ok(preview.includes("where: { id, userId, revokedAt: null }"), "the draft preview is owner-only");
});

test("the model only names references; Scripture text always comes from the bundled Bible", () => {
	const personal = read("src/lib/share-cards/personal.ts");
	assert.ok(personal.includes("canonicalPassage(parsed.label, \"KJV\")"));
	assert.equal(/text:\s*output/.test(personal), false, "no verse text may come from model output");
});

test("a sent card is frozen by a conditional write, on publish and on edit", () => {
	const publish = read("src/app/api/cards/personal/route.ts");
	assert.ok(publish.includes("publishedAt: null }"), "publish writes only an unsent draft");
	assert.ok(publish.includes("if (draft.publishedAt) return json({ id: draftId"), "publishing a sent card changes nothing");
	assert.equal(publish.includes('kind: "verse"'), false, "the no-draft publish path is gone");
	assert.ok(publish.includes("cardFitsEverySize(content)"), "a card that cannot draw whole is refused");
	const edit = read("src/app/api/cards/personal/[id]/route.ts");
	assert.ok(edit.includes("where: { id, userId, revokedAt: null, publishedAt: null }"));
});
