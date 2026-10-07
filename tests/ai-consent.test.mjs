/**
 * AI data-sharing consent (PRD A4, docs/ios/ai-consent.md): the version
 * rules, the preferences round trip that records and withdraws consent, the
 * morning Daily Cross gate that keeps study context away from the model until
 * a person has agreed, and the copy mirrors every client shows.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

import {
	REASONING_EFFORTS,
	REASONING_MODES,
	resolveDefinition,
	SPEEDS,
	VERBOSITIES,
} from "../src/lib/ai/models.ts";
import {
	AI_CONSENT_VERSION,
	aiConsentedUserIds,
	hasCurrentAiConsent,
	parsePreferencesPatch,
	readStoredAiConsent,
	toPreferencesDocument,
} from "../src/lib/preferences-contract.ts";

const read = (relativePath) =>
	readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

/** The copy module imports its version from the contract; inject the real one. */
function loadConsentCopy() {
	const source = read("../src/lib/ai-consent.ts")
		.replace(/^import\s[^;]*?;\s*$/gm, "")
		.replace(/^export\s*\{[^}]*\};\s*$/gm, "")
		.replace(/^export /gm, "");
	const names = [
		"AI_CONSENT_TITLE",
		"AI_CONSENT_BODY",
		"AI_CONSENT_PRIVACY_LABEL",
		"AI_CONSENT_PRIVACY_URL",
		"AI_CONSENT_AGREE",
		"AI_CONSENT_DECLINE",
		"AI_CONSENT_SETTINGS_TITLE",
		"AI_CONSENT_WITHDRAW",
		"aiConsentNeeded",
		"aiConsentStatusLabel",
	];
	return new Function(
		"AI_CONSENT_VERSION",
		`${stripTypeScriptTypes(source)}\nreturn { ${names.join(", ")} };`
	)(AI_CONSENT_VERSION);
}

const copy = loadConsentCopy();

const MODELS = {
	knowsModel: (modelId) => resolveDefinition(modelId) !== undefined,
	efforts: REASONING_EFFORTS,
	speeds: SPEEDS,
	verbosities: VERBOSITIES,
	modes: REASONING_MODES,
};

const NOW = new Date("2026-10-07T18:30:00.000Z");
const parse = (body) => parsePreferencesPatch(body, MODELS, NOW);

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

// -- version rules ------------------------------------------------------------

test("the first consent copy is version 1", () => {
	assert.equal(AI_CONSENT_VERSION, 1);
});

test("the sheet is needed until the account agreed to the version the server requires", () => {
	assert.equal(copy.aiConsentNeeded(null), true);
	assert.equal(copy.aiConsentNeeded(undefined), true);
	assert.equal(copy.aiConsentNeeded({ version: 1 }), false);
	// A bumped copy version asks everyone again, including people who agreed.
	assert.equal(copy.aiConsentNeeded({ version: 1 }, 2), true);
	assert.equal(copy.aiConsentNeeded({ version: 2 }, 2), false);
});

test("a stored consent needs both columns, a positive integer version and a real time", () => {
	const at = new Date("2026-10-07T12:00:00.000Z");
	assert.deepEqual(readStoredAiConsent(1, at), { version: 1, acceptedAt: "2026-10-07T12:00:00.000Z" });
	for (const [version, when] of [
		[null, at],
		[1, null],
		[0, at],
		[-1, at],
		[1.5, at],
		["1", at],
		[1, new Date(Number.NaN)],
		[1, "2026-10-07T12:00:00.000Z"],
	]) {
		assert.equal(readStoredAiConsent(version, when), null, `${version} / ${when}`);
	}
});

test("current consent is the required version with a time; anything else is not consent", () => {
	const at = new Date("2026-10-07T12:00:00.000Z");
	assert.equal(hasCurrentAiConsent({ aiConsentVersion: 1, aiConsentAt: at }), true);
	assert.equal(hasCurrentAiConsent({ aiConsentVersion: 1, aiConsentAt: null }), false);
	assert.equal(hasCurrentAiConsent({ aiConsentVersion: null, aiConsentAt: null }), false);
	assert.equal(hasCurrentAiConsent({}), false);
	assert.equal(hasCurrentAiConsent(null), false);
	assert.equal(hasCurrentAiConsent({ aiConsentVersion: 1, aiConsentAt: at }, 2), false);
});

test("the Settings row reads 'Allowed on <date>' and nothing without consent", () => {
	assert.equal(
		copy.aiConsentStatusLabel({ acceptedAt: "2026-10-07T18:30:00.000Z" }, "en-US"),
		"Allowed on October 7, 2026"
	);
	assert.equal(copy.aiConsentStatusLabel(null), null);
	assert.equal(copy.aiConsentStatusLabel({ acceptedAt: "not a date" }), null);
});

// -- the preferences round trip ----------------------------------------------

test("the document carries the consent on record and the version required", () => {
	const none = toPreferencesDocument(row(), "free", MODELS);
	assert.equal(none.aiConsent, null);
	assert.equal(none.aiConsentRequired, AI_CONSENT_VERSION);

	const agreed = toPreferencesDocument(row({ aiConsentVersion: 1, aiConsentAt: NOW }), "free", MODELS);
	assert.deepEqual(agreed.aiConsent, { version: 1, acceptedAt: NOW.toISOString() });

	// No row yet (the lazy upsert race) reads as "not agreed", like every default.
	assert.equal(toPreferencesDocument(null, "free", MODELS).aiConsent, null);
});

test("agreeing records the current version and the server's time", () => {
	assert.deepEqual(parse({ aiConsent: { version: AI_CONSENT_VERSION } }), {
		ok: true,
		data: { aiConsentVersion: AI_CONSENT_VERSION, aiConsentAt: NOW },
	});
});

test("withdrawing clears both columns", () => {
	assert.deepEqual(parse({ aiConsent: null }), {
		ok: true,
		data: { aiConsentVersion: null, aiConsentAt: null },
	});
});

test("a stale or forged version is refused, so a build cannot agree to copy it never showed", () => {
	for (const version of [0, 2, AI_CONSENT_VERSION + 1, "1", null, undefined, 1.0001]) {
		const result = parse({ aiConsent: { version } });
		assert.equal(result.ok, false, `version ${String(version)}`);
		assert.match(result.error, /aiConsent\.version must be 1/);
	}
	assert.equal(parse({ aiConsent: {} }).ok, false);
});

test("the client never sends the time, and nothing but { version } or null is accepted", () => {
	assert.deepEqual(parse({ aiConsent: { version: 1, acceptedAt: "2020-01-01T00:00:00Z" } }), {
		ok: false,
		error: "Unknown preference: aiConsent.acceptedAt",
	});
	for (const value of [true, 1, "yes", [], [{ version: 1 }]]) {
		assert.deepEqual(parse({ aiConsent: value }), {
			ok: false,
			error: "aiConsent must be null or { version }",
		});
	}
});

test("one bad field writes nothing, consent included", () => {
	assert.equal(parse({ aiConsent: { version: 1 }, translation: "NIV" }).ok, false);
	assert.equal(parse({ aiConsent: { version: 9 }, parchment: false }).ok, false);
});

test("agreeing twice writes the same thing: the write is idempotent", () => {
	const first = parse({ aiConsent: { version: 1 } });
	const second = parse({ aiConsent: { version: 1 } });
	assert.deepEqual(first, second);
	// And what it writes reads back as current consent.
	const stored = { aiConsentVersion: first.data.aiConsentVersion, aiConsentAt: first.data.aiConsentAt };
	assert.equal(hasCurrentAiConsent(stored), true);
	assert.deepEqual(toPreferencesDocument(row(stored), "free", MODELS).aiConsent, {
		version: 1,
		acceptedAt: NOW.toISOString(),
	});
});

test("consent rides with the other preferences in one patch", () => {
	assert.deepEqual(parse({ aiConsent: { version: 1 }, webSearchEnabled: false }), {
		ok: true,
		data: { aiConsentVersion: 1, aiConsentAt: NOW, webSearchEnabled: false },
	});
});

test("the route reads and returns both columns, and counts the write as one setting", () => {
	const route = read("../src/app/api/preferences/route.ts");
	assert.match(route, /aiConsentVersion: true/);
	assert.match(route, /aiConsentAt: true/);
	assert.match(route, /key\.startsWith\("aiConsent"\) \? "aiConsent" : key/);
});

test("the columns live on User, so account deletion removes them with the row", () => {
	const schema = read("../prisma/schema.prisma");
	const user = schema.slice(schema.indexOf("model User {"), schema.indexOf("\n}", schema.indexOf("model User {")));
	assert.match(user, /aiConsentVersion\s+Int\?/);
	assert.match(user, /aiConsentAt\s+DateTime\?/);
	const migration = read("../prisma/migrations/20261007150000_ai_consent/migration.sql");
	assert.match(migration, /ADD COLUMN "aiConsentVersion" INTEGER/);
	assert.match(migration, /ADD COLUMN "aiConsentAt" TIMESTAMP\(3\)/);
});

// -- the morning Daily Cross gate --------------------------------------------

test("only accounts with current consent are personalised by the morning cron", () => {
	const at = new Date("2026-10-01T00:00:00.000Z");
	const consented = aiConsentedUserIds([
		{ id: "agreed", aiConsentVersion: 1, aiConsentAt: at },
		{ id: "never", aiConsentVersion: null, aiConsentAt: null },
		{ id: "withdrew", aiConsentVersion: null, aiConsentAt: null },
		{ id: "half-write", aiConsentVersion: 1, aiConsentAt: null },
		{ id: "old-copy", aiConsentVersion: 0, aiConsentAt: at },
	]);
	assert.deepEqual([...consented], ["agreed"]);
	assert.deepEqual([...aiConsentedUserIds([{ id: "agreed", aiConsentVersion: 1, aiConsentAt: at }], 2)], []);
	assert.deepEqual([...aiConsentedUserIds([])], []);
});

test("the cron writes a no-context day and skips the questions refresh without consent", () => {
	const cron = read("../src/app/api/cron/verse-of-day/route.ts");
	assert.match(cron, /aiConsentedUserIds\(rows\)/);
	assert.match(cron, /const personalContext = consented\.has\(userId\);/);
	assert.match(cron, /generateDailyCross\(userId, \{ abortSignal: generationSignal, personalContext \}\)/);
	assert.match(cron, /if \(!existing && personalContext && !generationSignal\.aborted\)/);
	// A failed consent read narrows to nobody, never to everybody.
	assert.match(cron, /Consent lookup failed[\s\S]*?return new Set\(\);/);
});

test("without personal context the generator reads nothing about the person", () => {
	const cross = read("../src/lib/daily-cross.ts");
	// The selector gets empty loaders instead of the defaults that read
	// messages, notes, reading, plan, church and memories.
	assert.match(cross, /loadPersonalContext: async \(\) => \[\],\s*loadUserMemories: async \(\) => \[\],/);
	assert.match(cross, /personalContext \? \{\} : NO_PERSONAL_CONTEXT/);
	// The writer skips the study context (it only read the plan block from it).
	assert.match(cross, /personalContext \? \(await loadStudyContext\(userId\)\)\.planBlock : NO_PLAN_BLOCK/);
	assert.equal(cross.match(/loadStudyContext\(/g).length, 1);
	// Every model path threads the flag; the default stays personal for the
	// on-demand routes a person opens themselves.
	assert.match(cross, /const personalContext = request\.personalContext \?\? true;/);
	assert.equal(cross.match(/request\.abortSignal, personalContext\)/g).length, 2);
});

// -- copy -----------------------------------------------------------------------

test("the approved copy, verbatim", () => {
	assert.equal(copy.AI_CONSENT_TITLE, "How SureWord answers you");
	assert.equal(copy.AI_CONSENT_AGREE, "Agree and continue");
	assert.equal(copy.AI_CONSENT_DECLINE, "Not now");
	assert.equal(copy.AI_CONSENT_PRIVACY_LABEL, "Privacy Policy");
	assert.equal(copy.AI_CONSENT_PRIVACY_URL, "https://sureword.app/privacy");
	assert.equal(copy.AI_CONSENT_SETTINGS_TITLE, "AI data sharing");
	assert.equal(copy.AI_CONSENT_WITHDRAW, "Withdraw");
	// The spec's body, joined from its wrapped lines.
	const spec = read("../docs/ios/ai-consent.md");
	const quoted = spec
		.slice(spec.indexOf("**Body**"), spec.indexOf("**Link**"))
		.split("\n")
		.filter((line) => line.startsWith("> "))
		.map((line) => line.slice(2).trim())
		.join(" ");
	assert.equal(copy.AI_CONSENT_BODY, quoted);
	assert.equal(copy.AI_CONSENT_BODY.split(/\s+/).length, 99);
});

test("the privacy policy names every provider the sheet names, and the sheet itself", () => {
	const policy = read("../src/lib/marketing/legal-content.ts");
	for (const provider of ["OpenAI", "Tavily", "ElevenLabs"]) {
		assert.ok(copy.AI_CONSENT_BODY.includes(provider));
		assert.ok(policy.includes(provider), provider);
	}
	assert.ok(policy.includes(`\\"${copy.AI_CONSENT_TITLE}\\"`));
	assert.ok(policy.includes(`Settings → AI → ${copy.AI_CONSENT_SETTINGS_TITLE}`));
});
