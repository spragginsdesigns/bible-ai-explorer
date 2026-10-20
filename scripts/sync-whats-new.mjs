#!/usr/bin/env node
// Rebuild src/content/whats-new/releases.json from the Play blocks in
// mobile/CHANGELOG.md, the single source of truth for release notes.
// push-phone.sh runs it after the changelog check; tests/whats-new.test.mjs
// fails whenever the committed JSON has drifted from the changelog.
//
//   node scripts/sync-whats-new.mjs           write the JSON
//   node scripts/sync-whats-new.mjs --check   exit 1 if it is stale
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelog } from "../src/lib/whats-new-rules.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const changelog = readFileSync(resolve(root, "mobile/CHANGELOG.md"), "utf8");
const target = resolve(root, "src/content/whats-new/releases.json");
const next = `${JSON.stringify({ releases: parseChangelog(changelog) }, null, "\t")}\n`;

if (process.argv.includes("--check")) {
	let current = "";
	try {
		current = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
	} catch {}
	if (current !== next) {
		console.error("src/content/whats-new/releases.json is stale. Run: node scripts/sync-whats-new.mjs");
		process.exit(1);
	}
	process.exit(0);
}

writeFileSync(target, next);
console.log(`wrote ${JSON.parse(next).releases.length} releases to src/content/whats-new/releases.json`);
