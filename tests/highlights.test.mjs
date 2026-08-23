import assert from "node:assert/strict";
import test from "node:test";

import { HIGHLIGHT_COLORS, highlightWash } from "../src/lib/highlights.ts";

// Keep these vectors mirrored in the mobile/macOS highlight modules — the
// preset list and wash alpha are shared across platforms.

test("HIGHLIGHT_COLORS keeps the shared preset order", () => {
	assert.deepEqual(
		HIGHLIGHT_COLORS.map((c) => c.hex),
		["#F5D76E", "#F5A623", "#E84C3D", "#E87EA1", "#9B59B6", "#4A90D9", "#1ABC9C", "#27AE60"]
	);
});

test("highlightWash converts hex to a 0.25-alpha rgba", () => {
	assert.equal(highlightWash("#F5D76E"), "rgba(245, 215, 110, 0.25)");
	assert.equal(highlightWash("#27AE60"), "rgba(39, 174, 96, 0.25)");
	assert.equal(highlightWash("#000000"), "rgba(0, 0, 0, 0.25)");
	assert.equal(highlightWash("#FFFFFF"), "rgba(255, 255, 255, 0.25)");
});

test("highlightWash is case-insensitive", () => {
	assert.equal(highlightWash("#f5d76e"), highlightWash("#F5D76E"));
	assert.equal(highlightWash("#1abc9c"), "rgba(26, 188, 156, 0.25)");
});

test("highlightWash passes non-hex input through unchanged", () => {
	assert.equal(highlightWash("red"), "red");
	assert.equal(highlightWash("#FFF"), "#FFF");
	assert.equal(highlightWash(""), "");
});
