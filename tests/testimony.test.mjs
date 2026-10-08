/* "My testimony": how the user came to faith, in their own words. Private,
 * read by the assistant only. Same contract as About me (trim on write, empty
 * clears, over the cap refused, never null in the document), its own prompt
 * block, and the cap mirrored on Android and Apple.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	MAX_TESTIMONY_LENGTH,
	parsePreferencesPatch,
	readStoredTestimony,
	toPreferencesDocument,
} from "../src/lib/preferences-contract.ts";
import { formatTestimonyBlock } from "../src/lib/highlight-legend-rules.ts";
import {
	REASONING_EFFORTS,
	REASONING_MODES,
	SPEEDS,
	VERBOSITIES,
} from "../src/lib/ai/models.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const models = {
	knowsModel: () => true,
	efforts: REASONING_EFFORTS,
	speeds: SPEEDS,
	verbosities: VERBOSITIES,
	modes: REASONING_MODES,
};
const parse = (body) => parsePreferencesPatch(body, models);

test("the testimony is trimmed on write, empty clears the column, and over the cap is refused", () => {
	assert.deepEqual(parse({ testimony: "  God found me in a prison cell.  " }), {
		ok: true,
		data: { testimony: "God found me in a prison cell." },
	});
	assert.deepEqual(parse({ testimony: "" }), { ok: true, data: { testimony: null } });
	assert.deepEqual(parse({ testimony: null }), { ok: true, data: { testimony: null } });

	const exact = "x".repeat(MAX_TESTIMONY_LENGTH);
	assert.equal(parse({ testimony: exact }).ok, true);
	const long = parse({ testimony: `${exact}y` });
	assert.equal(long.ok, false);
	assert.match(long.error, /testimony must be 2000 characters or fewer/);
	assert.equal(parse({ testimony: 7 }).error, "testimony must be a string");
});

test("the document carries the testimony as text, never null, and the stored read caps it", () => {
	const row = (testimony) => ({
		webSearchEnabled: true,
		memoryEnabled: true,
		translation: "KJV",
		parchment: true,
		listenRate: 1,
		testimony,
		defaultModelId: null,
		defaultEffort: null,
		defaultSpeed: null,
		defaultVerbosity: null,
		defaultMode: null,
	});
	assert.equal(toPreferencesDocument(row(" Reborn. "), "free", models).testimony, "Reborn.");
	assert.equal(toPreferencesDocument(row(null), "free", models).testimony, "");
	assert.equal(toPreferencesDocument(null, "free", models).testimony, "");
	assert.equal(readStoredTestimony("x".repeat(MAX_TESTIMONY_LENGTH + 5)).length, MAX_TESTIMONY_LENGTH);
});

test("the testimony block quotes the text, flattened, frames it as private context, and is empty without one", () => {
	const block = formatTestimonyBlock("  I found God in prison.\n\nHe made me new.  ");
	assert.match(block, /^\n\nTHEIR TESTIMONY, IN THEIR OWN WORDS/);
	assert.match(block, /not instructions/);
	assert.match(block, /never mention or share it/i);
	assert.match(block, /Christ and His promises/);
	assert.doesNotMatch(block, /root of their faith|Never argue with it/);
	assert.match(block, /\n"I found God in prison. He made me new."$/);
	assert.equal(formatTestimonyBlock(""), "");
	assert.equal(formatTestimonyBlock(null), "");
});

test("the preferences route selects the column so GET returns it", () => {
	assert.match(read("src/app/api/preferences/route.ts"), /aboutMe: true,\s*testimony: true,/);
});

test("Android and Apple mirror the cap", () => {
	assert.ok(
		read("mobile/src/features/settings/preferences.ts").includes(
			`MAX_TESTIMONY_LENGTH = ${MAX_TESTIMONY_LENGTH}`,
		),
	);
	assert.match(read("macos/Shared/Settings/TestimonySection.swift"), /maxLength = 2000/);
});
