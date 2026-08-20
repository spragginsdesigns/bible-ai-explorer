#!/usr/bin/env node
// Extract the Google Play "What's new" text for a versionCode from
// mobile/CHANGELOG.md - the single source of truth for Play release notes.
// Exits non-zero when the entry or block is missing, empty, or over Play's
// 500-character limit, so push-phone.sh can refuse to publish.
//
//   node mobile/scripts/play-notes.mjs <changelog.md> <versionCode> [versionName]
import { readFileSync } from "node:fs";

const [file, codeArg, versionName] = process.argv.slice(2);
if (!file || !codeArg) {
	console.error("usage: play-notes.mjs <changelog.md> <versionCode> [versionName]");
	process.exit(1);
}
const code = String(parseInt(codeArg, 10));
const lines = readFileSync(file, "utf8").split(/\r?\n/);
const isHeading = (l) => /^## /.test(l);

const start = lines.findIndex((l) => isHeading(l) && l.includes(`(versionCode ${code})`));
if (start < 0) {
	console.error(`No changelog entry for versionCode ${code} in ${file}.`);
	process.exit(2);
}
if (versionName && !lines[start].includes(versionName)) {
	console.error(
		`Entry heading "${lines[start]}" does not carry versionName ${versionName} (app.json's version).`
	);
	process.exit(3);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
	if (isHeading(lines[i])) {
		end = i;
		break;
	}
}
const entry = lines.slice(start + 1, end);

const blockStart = entry.findIndex((l) => /^\*\*What's new \(Play\):?\*\*/.test(l));
if (blockStart < 0) {
	console.error(`Entry for versionCode ${code} has no "**What's new (Play):**" block.`);
	process.exit(4);
}
let blockEnd = entry.length;
for (let i = blockStart + 1; i < entry.length; i++) {
	if (/^\*\*Dev notes/.test(entry[i]) || /^---\s*$/.test(entry[i]) || /^#/.test(entry[i])) {
		blockEnd = i;
		break;
	}
}
const notes = entry.slice(blockStart + 1, blockEnd).join("\n").trim();
if (!notes) {
	console.error(`The "What's new (Play)" block for versionCode ${code} is empty.`);
	process.exit(5);
}
if (notes.length > 500) {
	console.error(
		`The "What's new (Play)" block for versionCode ${code} is ${notes.length} characters - Play rejects release notes over 500.`
	);
	process.exit(6);
}
process.stdout.write(notes);
