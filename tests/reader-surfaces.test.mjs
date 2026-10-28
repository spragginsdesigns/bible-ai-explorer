import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	DEFAULT_READER_SURFACE,
	READER_SURFACES,
	parseReaderSurface,
	readerPageChoice,
	readerPageLabel,
} from "../src/lib/reader-surfaces.ts";

test("unknown or missing stored pages read as the default parchment", () => {
	assert.equal(DEFAULT_READER_SURFACE, "parchment");
	for (const raw of [null, undefined, "", "plain", "PAPER", "chessboard", 3]) {
		assert.equal(parseReaderSurface(raw), "parchment");
	}
	for (const { id } of READER_SURFACES) assert.equal(parseReaderSurface(id), id);
});

test("the parchment switch decides plain; the stored page decides which sheet", () => {
	assert.equal(readerPageChoice(false, "twilight"), "plain");
	assert.equal(readerPageChoice(true, "twilight"), "twilight");
	assert.equal(readerPageLabel("plain"), "Plain");
	assert.equal(readerPageLabel("stone"), "Jerusalem Stone");
});

test("every page has a light and a dark face with its own ink in globals.css", () => {
	const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
	const ids = READER_SURFACES.map((surface) => surface.id);
	assert.equal(new Set(ids).size, ids.length);
	for (const id of ids) {
		for (const selector of [`.reader-page-${id} {`, `.dark .reader-page-${id} {`]) {
			// Anchored at the line start, so ".reader-page-x {" never matches inside ".dark .reader-page-x {".
			const match = new RegExp(`^${selector.replace(/[.{]/g, "\\$&")}`, "m").exec(css);
			assert.ok(match, `${selector} is missing`);
			const block = css.slice(match.index, css.indexOf("}", match.index));
			assert.match(block, /--reader-ink:/, `${selector} sets no ink`);
		}
	}
});
