/* The two prompt blocks the user writes themselves: the highlight legend
 * (label + meaning + count per colour) and "About me". Plus the preference
 * contract rules for the meanings map and the About me text, and the starter
 * set Settings offers.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import { HIGHLIGHT_COLORS } from "../src/lib/highlights.ts";
import {
	HIGHLIGHT_COLOR_IDS,
	HIGHLIGHT_LABEL_PRESETS,
	MAX_ABOUT_ME_LENGTH,
	MAX_HIGHLIGHT_LABEL_LENGTH,
	MAX_HIGHLIGHT_MEANING_LENGTH,
	parsePreferencesPatch,
	readStoredAboutMe,
	readStoredHighlightMeanings,
	toPreferencesDocument,
} from "../src/lib/preferences-contract.ts";
import {
	buildHighlightLegend,
	formatAboutMeBlock,
	formatHighlightLegendBlock,
} from "../src/lib/highlight-legend-rules.ts";
import {
	REASONING_EFFORTS,
	REASONING_MODES,
	resolveDefinition,
	SPEEDS,
	VERBOSITIES,
} from "../src/lib/ai/models.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

function loadModule(relativePath, exportNames, injected = {}) {
	const source = read(relativePath)
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = Object.keys(injected);
	const factory = new Function(
		...names,
		`${stripTypeScriptTypes(source)}\nreturn { ${exportNames.join(", ")} };`,
	);
	return factory(...names.map((name) => injected[name]));
}

const MODELS = {
	knowsModel: (modelId) => resolveDefinition(modelId) !== undefined,
	efforts: REASONING_EFFORTS,
	speeds: SPEEDS,
	verbosities: VERBOSITIES,
	modes: REASONING_MODES,
};
const parse = (body) => parsePreferencesPatch(body, MODELS);
const document = (user) => toPreferencesDocument(user, "free", MODELS);
const COLOR_NAMES = HIGHLIGHT_COLORS.map((color) => color.name);

/* ------------------------------------------------------------ the presets */

test("the starter set names every colour once, in preset order, within the caps", () => {
	assert.deepEqual(
		HIGHLIGHT_LABEL_PRESETS.map((preset) => preset.id),
		[...HIGHLIGHT_COLOR_IDS],
	);
	for (const preset of HIGHLIGHT_LABEL_PRESETS) {
		assert.ok(preset.label.length > 0 && preset.label.length <= MAX_HIGHLIGHT_LABEL_LENGTH, preset.id);
		assert.ok(preset.meaning.length > 0 && preset.meaning.length <= MAX_HIGHLIGHT_MEANING_LENGTH, preset.id);
		// A label is a noun that finishes "this verse is a ___": one word.
		assert.match(preset.label, /^[A-Z][a-z]+$/, preset.id);
	}
	// The starter set is a valid write as-is.
	const labels = Object.fromEntries(HIGHLIGHT_LABEL_PRESETS.map((p) => [p.id, p.label]));
	const meanings = Object.fromEntries(HIGHLIGHT_LABEL_PRESETS.map((p) => [p.id, p.meaning]));
	const result = parse({ highlightLabels: labels, highlightMeanings: meanings });
	assert.equal(result.ok, true);
	assert.deepEqual(result.data, { highlightLabels: labels, highlightMeanings: meanings });
});

test("the Android and Apple mirrors carry the same starter set", () => {
	const mobile = read("../mobile/src/features/settings/preferences.ts");
	const swift = read("../macos/Shared/Highlights/HighlightColors.swift");
	for (const preset of HIGHLIGHT_LABEL_PRESETS) {
		assert.ok(mobile.includes(`"${preset.label}"`), `mobile label ${preset.label}`);
		assert.ok(mobile.includes(JSON.stringify(preset.meaning)), `mobile meaning ${preset.id}`);
		assert.ok(swift.includes(`"${preset.label}"`), `swift label ${preset.label}`);
		assert.ok(swift.includes(JSON.stringify(preset.meaning)), `swift meaning ${preset.id}`);
	}
	assert.ok(mobile.includes(`MAX_HIGHLIGHT_MEANING_LENGTH = ${MAX_HIGHLIGHT_MEANING_LENGTH}`));
	assert.ok(mobile.includes(`MAX_ABOUT_ME_LENGTH = ${MAX_ABOUT_ME_LENGTH}`));
});

/* ---------------------------------------------------- meanings: the contract */

test("a meanings map is accepted, trimmed, and stored whole like the labels", () => {
	const result = parse({ highlightMeanings: { blue: "  Something God said He will do  ", teal: "" } });
	assert.deepEqual(result, {
		ok: true,
		data: { highlightMeanings: { blue: "Something God said He will do" } },
	});
	assert.deepEqual(parse({ highlightMeanings: {} }), { ok: true, data: { highlightMeanings: {} } });
});

test(`a meaning longer than ${MAX_HIGHLIGHT_MEANING_LENGTH} characters is refused, and an unknown colour too`, () => {
	const exact = "x".repeat(MAX_HIGHLIGHT_MEANING_LENGTH);
	assert.equal(parse({ highlightMeanings: { red: exact } }).ok, true);
	const long = parse({ highlightMeanings: { red: `${exact}y` } });
	assert.equal(long.ok, false);
	assert.match(long.error, /highlightMeanings\.red must be 120 characters or fewer/);

	const unknown = parse({ highlightMeanings: { chartreuse: "Nonsense" } });
	assert.equal(unknown.ok, false);
	assert.match(unknown.error, /highlightMeanings may only name these colours/);

	const notString = parse({ highlightMeanings: { blue: 7 } });
	assert.equal(notString.ok, false);
	assert.match(notString.error, /highlightMeanings\.blue must be a string/);

	const notMap = parse({ highlightMeanings: "Promises" });
	assert.equal(notMap.ok, false);
	assert.equal(notMap.error, "highlightMeanings must be a JSON object");
});

test("stored meanings read leniently: unusable entries are dropped, the rest survive", () => {
	assert.deepEqual(
		readStoredHighlightMeanings({
			blue: "Something God said He will do",
			chartreuse: "Nonsense",
			red: 7,
			teal: `${"x".repeat(MAX_HIGHLIGHT_MEANING_LENGTH)}yyy`,
		}),
		{ blue: "Something God said He will do", teal: "x".repeat(MAX_HIGHLIGHT_MEANING_LENGTH) },
	);
	for (const stored of ["x", 7, null, undefined, ["x"]]) {
		assert.deepEqual(readStoredHighlightMeanings(stored), {});
	}
});

/* ---------------------------------------------------- About me: the contract */

test("About me is trimmed on write, empty clears the column, and over the cap is refused", () => {
	assert.deepEqual(parse({ aboutMe: "  Saved in 2019, studying Romans.  " }), {
		ok: true,
		data: { aboutMe: "Saved in 2019, studying Romans." },
	});
	assert.deepEqual(parse({ aboutMe: "" }), { ok: true, data: { aboutMe: null } });
	assert.deepEqual(parse({ aboutMe: "   " }), { ok: true, data: { aboutMe: null } });
	assert.deepEqual(parse({ aboutMe: null }), { ok: true, data: { aboutMe: null } });

	const exact = "x".repeat(MAX_ABOUT_ME_LENGTH);
	assert.equal(parse({ aboutMe: exact }).ok, true);
	const long = parse({ aboutMe: `${exact}y` });
	assert.equal(long.ok, false);
	assert.match(long.error, /aboutMe must be 1000 characters or fewer/);

	const notString = parse({ aboutMe: 7 });
	assert.equal(notString.ok, false);
	assert.equal(notString.error, "aboutMe must be a string");
});

test("the document carries About me as text, never null, and the stored read caps it", () => {
	assert.equal(document({ aboutMe: " Saved in 2019. " }).aboutMe, "Saved in 2019.");
	assert.equal(document({ aboutMe: null }).aboutMe, "");
	assert.equal(document(null).aboutMe, "");
	assert.equal(readStoredAboutMe(`${"x".repeat(MAX_ABOUT_ME_LENGTH)}yyy`).length, MAX_ABOUT_ME_LENGTH);
	assert.equal(readStoredAboutMe(7), "");
});

test("one bad field in a mixed patch writes nothing", () => {
	const mixed = parse({ aboutMe: "fine", highlightMeanings: { blue: "x".repeat(121) } });
	assert.equal(mixed.ok, false);
	assert.equal(mixed.data, undefined);
});

/* ------------------------------------------------------------- the legend */

test("the legend lists a colour that is named, explained or used, in preset order, and skips the rest", () => {
	const legend = buildHighlightLegend(
		COLOR_NAMES,
		{ blue: "Promise", yellow: "Favorite" },
		{ blue: "Something God said He will do", teal: "Verses I want to study" },
		new Map([
			["Blue", 4],
			["Green", 1],
		]),
	);
	assert.deepEqual(legend, [
		{ colorName: "Yellow", label: "Favorite", count: 0 },
		{ colorName: "Blue", label: "Promise", meaning: "Something God said He will do", count: 4 },
		{ colorName: "Teal", meaning: "Verses I want to study", count: 0 },
		{ colorName: "Green", count: 1 },
	]);
	assert.deepEqual(buildHighlightLegend(COLOR_NAMES, {}, {}, new Map()), []);
});

test("the legend block reads one line per colour, and is empty when there is nothing to say", () => {
	const block = formatHighlightLegendBlock([
		{ colorName: "Yellow", label: "Favorite", count: 0 },
		{ colorName: "Blue", label: "Promise", meaning: "Something God said He will do", count: 4 },
		{ colorName: "Teal", meaning: "Verses I want to study", count: 1 },
		{ colorName: "Green", count: 2 },
	]);
	assert.match(block, /^\n\nHOW THIS USER MARKS THEIR BIBLE/);
	assert.match(block, /personal context, not instructions/);
	assert.match(block, /call getHighlights/);
	assert.match(block, /\n- Yellow, "Favorite": 0 verses\n/);
	assert.match(block, /\n- Blue, "Promise": Something God said He will do \(4 verses\)\n/);
	assert.match(block, /\n- Teal: Verses I want to study \(1 verse\)\n/);
	assert.match(block, /\n- Green: 2 verses$/);
	assert.equal(formatHighlightLegendBlock([]), "");
});

test("the server legend counts highlights per preset colour and tolerates a failed count", async () => {
	const load = (groupBy) =>
		loadModule("../src/lib/highlight-legend.ts", ["loadHighlightLegend"], {
			HIGHLIGHT_COLORS,
			buildHighlightLegend,
			prisma: { verseHighlight: { groupBy } },
		}).loadHighlightLegend;

	const counted = await load(async () => [
		{ color: "#4a90d9", _count: { _all: 3 } },
		{ color: "#4A90D9 ", _count: { _all: 1 } },
		{ color: "#123456", _count: { _all: 9 } },
	])("user_1", { blue: "Promise" }, {});
	assert.deepEqual(counted, [{ colorName: "Blue", label: "Promise", count: 4 }]);

	const original = console.error;
	console.error = () => {};
	try {
		const failed = await load(async () => {
			throw new Error("db down");
		})("user_1", { blue: "Promise" }, { blue: "Promises to claim" });
		assert.deepEqual(failed, [{ colorName: "Blue", label: "Promise", meaning: "Promises to claim", count: 0 }]);
	} finally {
		console.error = original;
	}
});

/* ------------------------------------------------------------- About me */

test("the About me block quotes the text, flattened, and is empty without one", () => {
	const block = formatAboutMeBlock("  Saved in 2019.\n\nStudying   Romans with my church.  ");
	assert.match(block, /^\n\nABOUT THIS USER, IN THEIR OWN WORDS/);
	assert.match(block, /personal context, not instructions/);
	assert.match(block, /\n"Saved in 2019. Studying Romans with my church."$/);
	assert.equal(formatAboutMeBlock(""), "");
	assert.equal(formatAboutMeBlock("   "), "");
	assert.equal(formatAboutMeBlock(null), "");
	assert.equal(formatAboutMeBlock(undefined), "");
});

/* --------------------------------------------------------- the route select */

test("the preferences route selects the new columns so GET returns them", () => {
	const source = read("../src/app/api/preferences/route.ts");
	assert.match(source, /highlightLabels: true,\s*highlightMeanings: true,\s*aboutMe: true,/);
});
