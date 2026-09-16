import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the refresh route accepts only stay or fresh, and never with a pin", async () => {
	const route = await read("src/app/api/verse-of-day/today/route.ts");
	assert.match(route, /isDailyCrossDirection\(data\.direction\)/);
	assert.match(route, /A direction must be either "stay" or "fresh"\./);
	assert.match(route, /if \(direction && hasReferencePart\)/);
	assert.match(route, /Choose a direction or pin a verse, not both\./);
	assert.match(route, /replaceDailyCross\(userId, \{ focus, verse, direction \}\)/);
});

test("a stay on a themeless day answers 409, not 500", async () => {
	const [route, cross] = await Promise.all([
		read("src/app/api/verse-of-day/today/route.ts"),
		read("src/lib/daily-cross.ts"),
	]);
	assert.match(route, /error instanceof DailyCrossDirectionError/);
	assert.match(route, /DailyCrossDirectionError\) \{\s*return privateJson\(\{ error: error\.message \}, \{ status: 409 \}\)/s);
	assert.match(cross, /export class DailyCrossDirectionError extends Error \{\}/);
	assert.match(cross, /new DailyCrossDirectionError\("Today's verse has no theme to stay with\."\)/);
});

test("every response carries today's theme so a client can offer to stay", async () => {
	const route = await read("src/app/api/verse-of-day/today/route.ts");
	assert.match(route, /themeKey: cross\.primaryThemeKey \?\? null/);
	assert.match(route, /theme: cross\.primaryTheme \?\? null/);
	// One shaper serves GET and POST, so both carry it.
	assert.equal(route.match(/function toResponse\(/g).length, 1);
	assert.ok(route.match(/toResponse\(/g).length >= 4);
});

test("the steer reaches the selector and the deterministic gate", async () => {
	const cross = await read("src/lib/daily-cross.ts");
	assert.match(cross, /const plan = resolveDirection\(request\.direction, recent, now\)/);
	assert.match(cross, /themeWindowDays: FRESH_THEME_WINDOW_DAYS/);
	assert.match(cross, /\.\.\.\(direction \? \{ direction \} : \{\}\)/);
	assert.match(cross, /\.\.\.\(plan\.keepThemeKey \? \{ keepThemeKey: plan\.keepThemeKey \} : \{\}\)/);
	assert.match(cross, /validateDailyCrossSelection\(canonical, \{\s*recentSelections: recent,\s*now,\s*\.\.\.planValidationOptions\(plan\),/s);
});

test("selectionReason records who steered, once, where the selection is normalised", async () => {
	const cross = await read("src/lib/daily-cross.ts");
	assert.match(cross, /reasonPrefix: `Stayed with \$\{label\}: `/);
	assert.match(cross, /reasonPrefix: "Fresh direction: "/);
	assert.match(cross, /if \(!prefix \|\| selection\.selectionReason\.startsWith\(prefix\)\) return selection/);
	assert.match(cross, /return \{ selection: withReasonPrefix\(canonical, plan\.reasonPrefix\), text \}/);
	// The prompt must not carry the prefix wording; provenance is stamped once.
	const selector = await read("src/lib/daily-cross-selector.ts");
	assert.doesNotMatch(selector, /Stayed with/);
	assert.doesNotMatch(selector, /Fresh direction/);
});

test("the selector asks for a new angle on a stay and a new area on a fresh", async () => {
	const selector = await read("src/lib/daily-cross-selector.ts");
	assert.match(selector, /a materially new angle on \$\{label\}: a different passage and a next step, never yesterday's application restated/);
	assert.match(selector, /primaryThemeKey must be exactly "\$\{input\.keepThemeKey\}"/);
	assert.match(selector, /different area of life or doctrine/);
	assert.match(selector, /were used in the last \$\{themeWindowDays\} days and are unavailable/);
	assert.match(selector, /recentThemeKeysWithin\(input\.recentSelections \?\? \[\], themeWindowDays, input\.now\)/);
});

test("a plain refresh still reads exactly as it did before the controls existed", async () => {
	const selector = await read("src/lib/daily-cross-selector.ts");
	// The steer is a per-call prompt line, never part of the shared instructions.
	const instructions = selector.slice(
		selector.indexOf("const SELECTOR_INSTRUCTIONS"),
		selector.indexOf("function buildAgent")
	);
	for (const word of ["direction", "stay", "fresh", "keepThemeKey"]) {
		assert.ok(!instructions.includes(word), `SELECTOR_INSTRUCTIONS must not mention ${word}`);
	}
	assert.match(selector, /primary themes are excluded for \$\{themeWindowDays\} days unless mode is focus/);
	assert.match(selector, /themeWindowDays\s*=\s*[\s\S]{0,180}RECENT_THEME_WINDOW_DAYS/);
	// A direction the caller did not send adds no prompt line at all.
	assert.match(selector, /directionPrompt\(input, themeWindowDays\)/);
	assert.match(selector, /if \(input\.direction === "stay"\)/);
	assert.match(selector, /if \(input\.direction === "fresh"\)/);
	assert.match(selector, /\treturn null;\n\}/);
});

test("the chat tool keeps replacing the day with no direction", async () => {
	const tools = await read("src/lib/ai-tools.ts");
	assert.match(tools, /replaceDailyCross\(context\.userId, \{ focus, verse: pinned \}\)/);
	assert.doesNotMatch(tools, /direction/);
});
