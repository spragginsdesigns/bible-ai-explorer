#!/usr/bin/env node
/**
 * Generate SureWord brand artwork with OpenAI's image models.
 *
 * The app icon is the one asset no amount of code review catches being wrong,
 * so this exists to make regenerating it a repeatable command rather than a
 * hand-carried file: same prompts, same size, same output names every time.
 *
 *   node scripts/generate-logo.mjs                 # every concept in CONCEPTS
 *   node scripts/generate-logo.mjs star lamp       # only the named concepts
 *   node scripts/generate-logo.mjs --model gpt-image-1 --size 1024x1024
 *
 * Writes PNGs to .logo-work/ (gitignored). Turning a chosen concept into the
 * real icon set is `scripts/apply-logo.mjs`.
 *
 * OPENAI_API_KEY comes from the environment or .env.local - never from source.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".logo-work");

/**
 * Shared tail on every prompt. The size floor matters most: a launcher icon is
 * ~48dp on a phone, and anything with fine linework turns to mud there.
 */
const STYLE = [
	"Warm antique gold (#E8B44A) artwork on a solid near-black (#0A0A0A) square background.",
	"Flat 2D vector illustration: bold confident strokes, strictly symmetrical, high contrast.",
	"Generous even padding around the mark; centered composition.",
	"Absolutely no text, no letters, no words, no numbers, no signature.",
	"No photorealism, no gradients, no drop shadows, no 3D rendering, no bevels.",
	"Must stay legible when scaled down to 48 pixels.",
	"Reverent, elegant, modern app icon for a Bible study application.",
].join(" ");

/**
 * Concepts all read from 2 Peter 1:19 - "a more sure word of prophecy ... a
 * light that shineth in a dark place, until the day dawn, and the day star
 * arise in your hearts" - which is where the name SureWord comes from.
 */
const CONCEPTS = {
	star: "An open book rendered as clean geometric line art, with a single radiant eight-pointed morning star directly above it casting symmetrical rays down onto the pages.",
	lamp: "A simple upright oil lamp with a steady flame, its light radiating outward in clean symmetrical rays that push back a surrounding darkness.",
	seal: "A circular emblem: an open book at the centre beneath a single eight-pointed star, enclosed by a thin clean ring, composed like an engraved seal.",
	dawn: "A single eight-pointed morning star rising above a horizon line, with an open book forming the horizon itself, rays fanning upward like first light.",
};

function parseArgs(argv) {
	const names = [];
	const opts = { model: "gpt-image-2", size: "1024x1024", quality: "high" };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--model" || a === "--size" || a === "--quality") {
			opts[a.slice(2)] = argv[++i];
		} else if (!a.startsWith("-")) {
			names.push(a);
		}
	}
	return { names: names.length ? names : Object.keys(CONCEPTS), opts };
}

/**
 * Read OPENAI_API_KEY from the environment, falling back to .env.local.
 *
 * An inherited environment variable wins over the file, which is the same trap
 * documented for DATABASE_URL in CLAUDE.md - so report which source was used
 * rather than leaving a wrong key to surface as a confusing 401.
 */
async function loadApiKey() {
	if (process.env.OPENAI_API_KEY) return { key: process.env.OPENAI_API_KEY, source: "environment" };

	const envPath = path.join(ROOT, ".env.local");
	if (!existsSync(envPath)) throw new Error("OPENAI_API_KEY is not set and .env.local does not exist");

	const line = (await readFile(envPath, "utf8"))
		.split(/\r?\n/)
		.find((l) => l.startsWith("OPENAI_API_KEY="));
	if (!line) throw new Error("OPENAI_API_KEY is not set and .env.local does not define it");

	// Values in .env.local may be quoted; dotenv strips those, so match it.
	const key = line.slice("OPENAI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
	if (!key) throw new Error("OPENAI_API_KEY in .env.local is empty");
	return { key, source: ".env.local" };
}

async function generate(name, { key, opts }) {
	const prompt = `${CONCEPTS[name]} ${STYLE}`;
	const res = await fetch("https://api.openai.com/v1/images/generations", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify({
			model: opts.model,
			prompt,
			n: 1,
			size: opts.size,
			quality: opts.quality,
		}),
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`${name}: HTTP ${res.status} ${body.slice(0, 400)}`);
	}

	const data = await res.json();
	const item = data.data?.[0];
	if (!item) throw new Error(`${name}: response contained no image`);

	// gpt-image-* return b64_json; the dall-e models return a URL.
	const bytes = item.b64_json
		? Buffer.from(item.b64_json, "base64")
		: Buffer.from(await (await fetch(item.url)).arrayBuffer());

	const file = path.join(OUT_DIR, `${name}.png`);
	await writeFile(file, bytes);
	return { file, bytes: bytes.length };
}

const { names, opts } = parseArgs(process.argv.slice(2));

const unknown = names.filter((n) => !CONCEPTS[n]);
if (unknown.length) {
	console.error(`Unknown concept(s): ${unknown.join(", ")}`);
	console.error(`Available: ${Object.keys(CONCEPTS).join(", ")}`);
	process.exit(1);
}

const { key, source } = await loadApiKey();
console.log(`Using OPENAI_API_KEY from ${source}; model ${opts.model} at ${opts.size}`);
await mkdir(OUT_DIR, { recursive: true });

// Sequential: these are a handful of slow calls, and serialising them keeps a
// rate-limit rejection from taking the whole batch down with it.
let failed = 0;
for (const name of names) {
	try {
		const { file, bytes } = await generate(name, { key, opts });
		console.log(`  ${name}: ${path.relative(ROOT, file)} (${(bytes / 1024).toFixed(0)} KB)`);
	} catch (err) {
		failed++;
		console.error(`  ${name}: FAILED - ${err.message}`);
	}
}

if (failed) {
	console.error(`\n${failed} of ${names.length} concept(s) failed.`);
	process.exit(1);
}
console.log(`\nDone. Review ${path.relative(ROOT, OUT_DIR)}/ and pick one.`);
