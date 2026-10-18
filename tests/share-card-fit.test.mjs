/* The personal card's length limits, measured by the renderer itself ("Send a
 * word", docs/FEATURES.md). MAX_WORD_LENGTH and MAX_PERSONAL_LINE_LENGTH in
 * src/lib/share-cards/personal.ts promise that the longest word and line draw
 * whole beside a passage of about 240 characters at every size and style; this
 * runs the real layout code to hold them to it.
 *
 * render.tsx is JSX and imports next/og and sharp, which node cannot load
 * here, so its measuring half is transpiled into a temporary folder with those
 * imports stubbed. Nothing here draws a picture. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const DIR = join(import.meta.dirname, "..", "src", "lib", "share-cards");

function build() {
	const out = mkdtempSync(join(tmpdir(), "share-card-fit-"));
	const stubs = [
		['import "server-only";', ""],
		['import { ImageResponse } from "next/og";', "const ImageResponse = class {};"],
		['import sharp from "sharp";', "const sharp = () => {};"],
		['from "react/jsx-runtime"', 'from "./jsx.mjs"'],
		['from "./glyph-widths"', 'from "./glyph-widths.mjs"'],
		['from "./layout"', 'from "./layout.mjs"'],
	];
	for (const [source, target] of [
		["render.tsx", "render.mjs"],
		["layout.ts", "layout.mjs"],
		["glyph-widths.ts", "glyph-widths.mjs"],
	]) {
		let code = ts.transpileModule(readFileSync(join(DIR, source), "utf8"), {
			compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
		}).outputText;
		for (const [from, to] of stubs) code = code.split(from).join(to);
		writeFileSync(join(out, target), code);
	}
	writeFileSync(join(out, "jsx.mjs"), "export const jsx = () => null, jsxs = () => null, Fragment = null;");
	return out;
}

function limit(name) {
	const source = readFileSync(join(DIR, "personal.ts"), "utf8");
	const match = source.match(new RegExp(`export const ${name} = ([0-9]+);`));
	assert.ok(match, `${name} is a plain number in personal.ts`);
	return Number(match[1]);
}

/** Ordinary prose cut at a word boundary, no longer than `length`. */
function prose(sample, length) {
	const cut = sample.slice(0, length);
	return cut.slice(0, cut.lastIndexOf(" ")).trim() + ".";
}

const WORD_SAMPLE =
	"Christopher, before the doctors arrive and long after they have gone home, the Lord is your refuge and your strength, and nothing you face this week will ever find you outside of His care, His keeping, or His deep and steady love.";
const LINE_SAMPLE =
	"Praying for you every hour today and tomorrow, and I will be right there in the waiting room with coffee when you wake up. We love you so much.";

test("a personal reflection is measured with its selected face at both placements", async () => {
	const out = build();
	try {
		const { cardFitsEverySize } = await import(pathToFileURL(join(out, "render.mjs")).href);
		for (const font of ["italic", "book", "simple"]) for (const placement of ["above", "below"]) {
			assert.equal(cardFitsEverySize({ kind: "personal", reference: "Psalms 46:1", translation: "KJV",
				text: "God is our refuge and strength, a very present help in trouble.", recipient: null, word: null,
				personalLine: "As I study this verse, I'm considering what it means to take refuge in God and trust His strength for my next step.",
				signature: "Austin", reflection: { font, placement }, door: "sureword.app/c/AbCdEfGhIjKlMnOp" }), true, `${font} ${placement}`);
		}
	} finally { rmSync(out, { recursive: true, force: true }); }
});

test("the longest word, line and name fit beside a 240 character passage at every size and style", async () => {
	const out = build();
	try {
		const { cardFitsEverySize } = await import(pathToFileURL(join(out, "render.mjs")).href);
		const { cardScriptureText } = await import(pathToFileURL(join(out, "layout.mjs")).href);
		const text = cardScriptureText([
			{
				verse: 6,
				text: "Be careful for nothing; but in every thing by prayer and supplication with thanksgiving let your requests be made known unto God.",
			},
			{
				verse: 7,
				text: "And the peace of God, which passeth all understanding, shall keep your hearts and minds through Christ Jesus.",
			},
		]);
		const card = (word, personalLine) => ({
			kind: "personal",
			reference: "Philippians 4:6-7",
			translation: "KJV",
			text,
			recipient: "Christopher",
			word,
			personalLine,
			signature: "C".repeat(limit("MAX_SIGNATURE_LENGTH")),
			door: "sureword.app/c/AbCdEfGhIjKlMnOp",
		});
		const word = prose(WORD_SAMPLE, limit("MAX_WORD_LENGTH"));
		const line = prose(LINE_SAMPLE, limit("MAX_PERSONAL_LINE_LENGTH"));
		assert.ok(word.length > limit("MAX_WORD_LENGTH") - 15, "the sample word is near the limit");
		assert.ok(line.length > limit("MAX_PERSONAL_LINE_LENGTH") - 15, "the sample line is near the limit");
		assert.equal(cardFitsEverySize(card(word, null)), true, "the longest word alone");
		assert.equal(cardFitsEverySize(card(word, line)), true, "the longest word and the longest line");
		// And the check is real: Scripture that cannot fit is refused.
		assert.equal(cardFitsEverySize({ ...card(word, line), text: text.repeat(4) }), false);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
});
