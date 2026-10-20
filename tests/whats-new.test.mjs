import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
	catchUpFor,
	fallbackTitle,
	joinEditorial,
	parseChangelog,
	WHATS_NEW_TARGETS,
} from "../src/lib/whats-new-rules.ts";

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const { releases } = json("src/content/whats-new/releases.json");
const editorial = json("src/content/whats-new/editorial.json");
const entries = joinEditorial(releases, editorial);

test("releases.json matches mobile/CHANGELOG.md (run node scripts/sync-whats-new.mjs)", () => {
	execFileSync(process.execPath, ["scripts/sync-whats-new.mjs", "--check"], { stdio: "pipe" });
});

test("only the Play block is published, never the Dev notes", () => {
	const sample = [
		"## 2.0.0 (versionCode 200) - 2026-11-01 - internal",
		"",
		"**What's new (Play):**",
		"",
		"NEW",
		"- A new thing.",
		"FIXED",
		"- A broken thing,",
		"  now whole.",
		"",
		"**Dev notes:** migration 2026_secret, PUSH_TOKEN_PROOF_SECRET.",
		"",
		"## 1.18.0 (versionCode 12) - 2026-08-19 - internal",
		"**What's new (Play):**",
		"- Too old to publish.",
	].join("\n");
	const parsed = parseChangelog(sample);
	assert.deepEqual(parsed, [
		{
			version: "2.0.0",
			versionCode: 200,
			date: "2026-11-01",
			sections: [
				{ kind: "new", items: ["A new thing."] },
				{ kind: "fixed", items: ["A broken thing, now whole."] },
			],
		},
	]);
	const published = JSON.stringify(releases);
	for (const leak of ["Dev notes", "migration", "versionCode ", "src/", "mobile/"]) {
		assert.ok(!published.includes(leak), `releases.json leaked "${leak}"`);
	}
});

test("a version built twice becomes one release under its newest code", () => {
	const twice = parseChangelog(
		[
			"## 1.61.0 (versionCode 64) - 2026-09-15 - internal",
			"**What's new (Play):**",
			"IMPROVED",
			"- Second.",
			"## 1.61.0 (versionCode 63) - 2026-09-13 - internal",
			"**What's new (Play):**",
			"NEW",
			"- First.",
		].join("\n")
	);
	assert.equal(twice.length, 1);
	assert.equal(twice[0].versionCode, 64);
	assert.equal(twice[0].date, "2026-09-15");
	assert.deepEqual(twice[0].sections, [
		{ kind: "new", items: ["First."] },
		{ kind: "improved", items: ["Second."] },
	]);
	assert.equal(new Set(releases.map((r) => r.version)).size, releases.length);
});

test("every editorial key is a real release, every target is known", () => {
	const versions = new Set(releases.map((r) => r.version));
	for (const [version, extra] of Object.entries(editorial.releases)) {
		assert.ok(versions.has(version), `editorial names ${version}, which has no Play notes`);
		if (extra.target) assert.ok(WHATS_NEW_TARGETS.includes(extra.target), `${version}: unknown target ${extra.target}`);
	}
	for (const r of releases) assert.ok(editorial.releases[r.version]?.title, `${r.version} has no editorial title`);
});

test("editorial and titles carry no dashes (Austin's no-em-dash rule)", () => {
	const text = JSON.stringify(editorial) + entries.map((e) => e.title).join("|");
	// Built from char codes: this PC's editors flatten a literal en/em dash, even escaped.
	const dashes = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
	assert.ok(!dashes.test(text), "found an en or em dash in editorial copy");
});

test("every verse is quoted exactly from the bundled KJV", () => {
	const books = json("src/data/books.json");
	const byName = new Map(books.map((b) => [b.name, b.file]));
	const verses = [...Object.values(editorial.releases).map((r) => r.verse).filter(Boolean)];
	assert.ok(verses.length > 5);
	for (const { text, reference } of verses) {
		const match = /^(.+) (\d+):(\d+)$/.exec(reference);
		assert.ok(match, `bad reference ${reference}`);
		const name = match[1] === "Psalm" ? "Psalms" : match[1];
		const file = byName.get(name);
		assert.ok(file, `unknown book ${name}`);
		const chapters = json(`src/data/kjv/${file}`);
		assert.equal(text, chapters[Number(match[2]) - 1][Number(match[3]) - 1], reference);
	}
});

test("fallback titles take the lead-in or clip at a word", () => {
	const mk = (item) => ({ version: "1.0.0", versionCode: 1, date: "2026-01-01", sections: [{ kind: "new", items: [item] }] });
	assert.equal(fallbackTitle(mk("Connections: a new tab that shows how")), "Connections");
	assert.equal(fallbackTitle(mk("Bible search is faster. And more.")), "Bible search is faster");
	assert.ok(fallbackTitle(mk("word ".repeat(30))).endsWith("..."));
});

test("catch-up: new accounts are never interrupted and start at the newest", () => {
	const result = catchUpFor(entries, null);
	assert.deepEqual(result.cards, []);
	assert.equal(result.seenUpTo, Math.max(...releases.map((r) => r.versionCode)));
});

test("catch-up: only releases with something NEW, newest first, capped", () => {
	const mk = (code, kind) => ({
		version: `1.${code}.0`,
		versionCode: code,
		date: "2026-10-01",
		sections: [{ kind, items: [`item ${code}`] }],
		title: `T${code}`,
		headline: null,
		why: null,
		verse: null,
		target: code === 5 ? "connections" : null,
	});
	const list = [mk(6, "fixed"), mk(5, "new"), mk(4, "new"), mk(3, "new"), mk(2, "new"), mk(1, "new")];
	const result = catchUpFor(list, 1);
	assert.deepEqual(result.cards.map((c) => c.versionCode), [5, 4, 3]);
	assert.equal(result.newReleaseCount, 4);
	assert.equal(result.seenUpTo, 6, "dismissing marks the fixes-only release seen too");
	assert.equal(result.cards[0].target, "connections");
	assert.equal(result.cards[0].summary, "item 5");

	assert.deepEqual(catchUpFor(list, 6).cards, []);
	const capped = catchUpFor(list, 1, 4);
	assert.deepEqual(capped.cards.map((c) => c.versionCode), [4, 3, 2], "an older build never hears about features it lacks");
	assert.equal(capped.seenUpTo, 4);
	assert.equal(catchUpFor(list, 9).seenUpTo, 9, "seen never moves backward");
});
