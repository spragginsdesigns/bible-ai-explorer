/* B6: the eight highlight colours can be named, the names ride in the account
 * preference document, and the assistant reads them beside the hue.
 *
 * highlights.server.ts and chat-day-context.ts import Prisma and other server
 * modules through "@/", so both are instantiated from the shipped source with
 * those dependencies stubbed - the same harness tests/chat-day-context.test.mjs
 * uses.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import { HIGHLIGHT_COLORS } from "../src/lib/highlights.ts";
import {
	HIGHLIGHT_COLOR_IDS,
	MAX_HIGHLIGHT_LABEL_LENGTH,
	highlightLabelFor,
	parsePreferencesPatch,
	toPreferencesDocument,
} from "../src/lib/preferences-contract.ts";
import {
	DEFAULT_MODEL_ID,
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

/* ---------------------------------------------------------------- the ids */

test("the colour ids the document accepts are the preset hues, lowercased", () => {
	// The list is duplicated because preferences-contract.ts holds no runtime
	// imports; this is what stops the copies drifting apart.
	assert.deepEqual(
		[...HIGHLIGHT_COLOR_IDS],
		HIGHLIGHT_COLORS.map((color) => color.name.toLowerCase()),
	);
	assert.equal(HIGHLIGHT_COLOR_IDS.length, 8);
});

/* -------------------------------------------------------------- validation */

test("a map of labels is accepted and trimmed", () => {
	const result = parse({ highlightLabels: { yellow: "  Promises  ", blue: "Commands" } });
	assert.deepEqual(result, { ok: true, data: { highlightLabels: { yellow: "Promises", blue: "Commands" } } });
});

test("an empty map is a real write: it clears every label", () => {
	assert.deepEqual(parse({ highlightLabels: {} }), { ok: true, data: { highlightLabels: {} } });
});

test("an empty or blank label clears that one colour", () => {
	const result = parse({ highlightLabels: { yellow: "Promises", blue: "", teal: "   " } });
	assert.deepEqual(result.data.highlightLabels, { yellow: "Promises" });
});

test(`a label longer than ${MAX_HIGHLIGHT_LABEL_LENGTH} characters is refused`, () => {
	const exact = "x".repeat(MAX_HIGHLIGHT_LABEL_LENGTH);
	assert.deepEqual(parse({ highlightLabels: { red: exact } }), {
		ok: true,
		data: { highlightLabels: { red: exact } },
	});

	const result = parse({ highlightLabels: { red: `${exact}y` } });
	assert.equal(result.ok, false);
	assert.match(result.error, /highlightLabels\.red/);
	assert.match(result.error, /24 characters or fewer/);
});

test("an unknown colour id is refused rather than stored", () => {
	const result = parse({ highlightLabels: { chartreuse: "Promises" } });
	assert.equal(result.ok, false);
	assert.match(result.error, /may only name these colours/);
	assert.match(result.error, /yellow, orange, red, pink, purple, blue, teal, green/);
});

test("a label that is not a string is refused", () => {
	for (const value of [{ yellow: 7 }, { yellow: null }, { yellow: ["Promises"] }]) {
		const result = parse({ highlightLabels: value });
		assert.equal(result.ok, false);
		assert.match(result.error, /highlightLabels\.yellow must be a string/);
	}
});

test("highlightLabels itself must be a JSON object", () => {
	for (const value of ["Promises", 7, null, ["Promises"]]) {
		const result = parse({ highlightLabels: value });
		assert.equal(result.ok, false);
		assert.equal(result.error, "highlightLabels must be a JSON object");
	}
});

test("labels patch alongside the other preferences, and one bad label writes nothing", () => {
	const together = parse({
		translation: "NKJV",
		highlightLabels: { green: "Growth" },
		chat: { modelId: DEFAULT_MODEL_ID },
	});
	assert.deepEqual(together, {
		ok: true,
		data: {
			translation: "NKJV",
			highlightLabels: { green: "Growth" },
			defaultModelId: DEFAULT_MODEL_ID,
		},
	});

	// The whole body is refused, so translation is not written either.
	const mixed = parse({ translation: "NKJV", highlightLabels: { green: "x".repeat(25) } });
	assert.equal(mixed.ok, false);
	assert.equal(mixed.data, undefined);
});

/* ---------------------------------------------------------- the document */

/** A stored User row with everything at its column default. */
function row(overrides = {}) {
	return {
		webSearchEnabled: true,
		memoryEnabled: true,
		translation: "KJV",
		parchment: true,
		listenRate: 1,
		defaultModelId: null,
		defaultEffort: null,
		defaultSpeed: null,
		defaultVerbosity: null,
		defaultMode: null,
		...overrides,
	};
}

test("stored labels read back, and a row that has never saved any reads as an empty map", () => {
	assert.deepEqual(
		document(row({ highlightLabels: { yellow: "Promises", blue: "Commands" } })).highlightLabels,
		{ yellow: "Promises", blue: "Commands" },
	);
	assert.deepEqual(document(row()).highlightLabels, {});
	assert.deepEqual(document(null).highlightLabels, {});
});

test("a stored map keeps its usable labels when part of it is unusable", () => {
	// A label written by a newer build - a ninth colour, a number, an over-long
	// string - must not blank the labels the user can see.
	assert.deepEqual(
		document(
			row({
				highlightLabels: {
					yellow: "Promises",
					chartreuse: "Nonsense",
					blue: 7,
					red: `${"x".repeat(MAX_HIGHLIGHT_LABEL_LENGTH)}yyy`,
				},
			}),
		).highlightLabels,
		{ yellow: "Promises", red: "x".repeat(MAX_HIGHLIGHT_LABEL_LENGTH) },
	);
});

test("a stored value that is not a map at all reads as no labels", () => {
	for (const stored of ["Promises", 7, null, ["Promises"]]) {
		assert.deepEqual(document(row({ highlightLabels: stored })).highlightLabels, {});
	}
});

/* -------------------------------------------------------------- the lookup */

test("highlightLabelFor matches the preset name case-insensitively", () => {
	const labels = { blue: "Promises" };
	assert.equal(highlightLabelFor(labels, "Blue"), "Promises");
	assert.equal(highlightLabelFor(labels, "blue"), "Promises");
	assert.equal(highlightLabelFor(labels, "Green"), null);
	assert.equal(highlightLabelFor(labels, null), null);
	assert.equal(highlightLabelFor({}, "Blue"), null);
});

/* ------------------------------------------------- what the assistant sees */

const ROMANS_8 = [
	...Array(27).fill("..."),
	"And we know that all things work together for good to them that love God, to them who are the called according to his purpose.",
];

function loadHighlightsServer(rows) {
	return loadModule(
		"../src/lib/highlights.server.ts",
		["listUserHighlights", "formatHighlightsForModel"],
		{
			prisma: {
				verseHighlight: {
					count: async () => rows.length,
					findMany: async () => rows,
				},
			},
			HIGHLIGHT_COLORS,
			highlightLabelFor,
			getChapter: async (_translation, _book, _chapter) => ROMANS_8,
			resolveReference: () => null,
			getKjvBookName: (order) => (order === 45 ? "Romans" : `Book ${order}`),
		},
	);
}

const BLUE_ROMANS_8_28 = [
	{
		book: 45,
		chapter: 8,
		verse: 28,
		color: "#4A90D9",
		updatedAt: new Date("2026-09-11T17:00:00.000Z"),
	},
];

test("a highlight carries the user's name for its colour, and says only the hue without one", async () => {
	const { listUserHighlights } = loadHighlightsServer(BLUE_ROMANS_8_28);

	const named = await listUserHighlights("user_1", { translation: "KJV" }, { blue: "Promises" });
	assert.equal(named.highlights[0].colorName, "Blue");
	assert.equal(named.highlights[0].label, "Promises");

	const unnamed = await listUserHighlights("user_1", { translation: "KJV" });
	assert.equal(unnamed.highlights[0].colorName, "Blue");
	assert.equal(unnamed.highlights[0].label, undefined);
});

test("the block the model reads names the colour the way the user does", async () => {
	const { listUserHighlights, formatHighlightsForModel } = loadHighlightsServer(BLUE_ROMANS_8_28);

	const named = await listUserHighlights("user_1", { translation: "KJV" }, { blue: "Promises" });
	const block = formatHighlightsForModel(named, "KJV", "in Romans");
	assert.match(block, /- Romans 8:28 \(Blue: Promises\) - "And we know that all things/);

	const unnamed = await listUserHighlights("user_1", { translation: "KJV" });
	assert.match(
		formatHighlightsForModel(unnamed, "KJV", "in Romans"),
		/- Romans 8:28 \(Blue\) - "And we know that all things/,
	);
});

test("the today block names the colour the way the user does", () => {
	const { formatTodayBlock } = loadModule(
		"../src/lib/chat-day-context.ts",
		["formatTodayBlock"],
		{
			bookByOrder: () => null,
			firstNameOf: () => null,
			findTodayCross: async () => null,
			HIGHLIGHT_COLORS,
			highlightLabelFor,
			prisma: {},
			getTodayPlanReading: async () => null,
		},
	);
	const context = {
		cross: null,
		plan: null,
		recentChapters: [],
		highlights: [
			{ reference: "Romans 8:28", colorName: "Blue", label: "Promises" },
			{ reference: "James 1:12", colorName: "Yellow" },
			{ reference: "Psalms 46:1", colorName: null },
		],
	};
	assert.match(
		formatTodayBlock(context),
		/- Their most recent highlights: Romans 8:28 \(Blue: Promises\), James 1:12 \(Yellow\), Psalms 46:1\./,
	);
});
