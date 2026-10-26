/**
 * The web's text size (src/lib/text-scale.ts) is a hand mirror of the server
 * contract, like Android's. A size the web can pick but the server rejects
 * would fail every save, and a factor that drifts makes "Large" mean two
 * different things on two screens of the same account.
 */
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { TEXT_SCALES } from "../src/lib/preferences-contract.ts";
import { TEXT_SCALE_FACTORS, TEXT_SCALE_OPTIONS, TEXT_SCALE_VALUES } from "../src/lib/onboarding-rules.ts";
import * as web from "../src/lib/text-scale.ts";

test("web text sizes match the server's", () => {
	assert.deepEqual([...web.TEXT_SCALES], [...TEXT_SCALES]);
	assert.deepEqual(web.TEXT_SCALE_FACTORS, TEXT_SCALE_FACTORS);
	for (const label of TEXT_SCALE_OPTIONS) assert.equal(web.textScaleForLabel(label), TEXT_SCALE_VALUES[label]);
	assert.equal(web.textScaleForLabel("Huge"), null);
	assert.equal(web.normalizeTextScale("nonsense"), "standard");
});

function runBoot(stored) {
	const properties = {};
	const dataset = {};
	const context = {
		localStorage: { getItem: (key) => (key === web.TEXT_SCALE_PREF_KEY ? stored : null) },
		document: { documentElement: { style: { setProperty: (name, value) => (properties[name] = value) }, dataset } },
	};
	vm.runInNewContext(web.TEXT_SCALE_BOOT_SCRIPT, context);
	return { properties, dataset };
}

test("the boot script sets the stored size before paint, and nothing for standard or junk", () => {
	assert.deepEqual(runBoot("largest").properties, { [web.TEXT_SCALE_CSS_VAR]: "1.3" });
	assert.equal(runBoot("large").dataset.textScale, "large");
	assert.deepEqual(runBoot("standard").properties, {});
	assert.deepEqual(runBoot("<script>").properties, {});
	assert.deepEqual(runBoot(null).properties, {});
});

test("the boot script survives storage that throws", () => {
	const context = {
		localStorage: {
			getItem: () => {
				throw new Error("blocked");
			},
		},
		document: {},
	};
	assert.doesNotThrow(() => vm.runInNewContext(web.TEXT_SCALE_BOOT_SCRIPT, context));
});
