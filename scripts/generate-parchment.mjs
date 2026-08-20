#!/usr/bin/env node
/**
 * Generate photorealistic aged-parchment textures for the Bible reader's
 * "scroll page" surface with OpenAI's image models.
 *
 *   node scripts/generate-parchment.mjs            # every concept
 *   node scripts/generate-parchment.mjs aged       # one concept
 *
 * Writes PNGs to .logo-work/ (gitignored). The chosen texture ships as an
 * optimized JPEG/WebP asset for the reader background; see docs/FEATURES.md.
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
 * Every prompt fights the same two failure modes: cartoon clip-art scrolls
 * (wooden rods, ribbons, curls) and accidental writing on the paper.
 */
const STYLE = [
	"Photorealistic, high-resolution, top-down orthographic flat scan.",
	"Full-bleed texture filling the entire frame edge to edge.",
	"Absolutely no text, no letters, no writing, no ink marks, no symbols.",
	"No objects, no wooden rods, no ribbons, no wax seals, no curled 3D scroll shape.",
	"No cartoon style, no illustration, no vector art - a real photographed material.",
	"Soft even museum lighting, no harsh highlights or camera reflections.",
].join(" ");

const CONCEPTS = {
	aged: "Ancient parchment paper, warm golden-tan, centuries old: fine organic fiber grain, gentle mottling, faint tea-colored water stains, edges naturally darkened to a deep amber burnish. Rich, warm, reverent.",
	scroll: "A flat unrolled section of an ancient scroll of parchment: warm golden paper with subtle horizontal roll-shading bands near the top and bottom edges where it was once curled, fine cracks and fiber texture, deep amber vignette at the borders.",
	vellum: "Fine old vellum, pale warm gold, smooth with delicate visible calfskin grain and very subtle age mottling, softly darkened corners. Quieter and cleaner, made for long comfortable reading.",
	dark: "Very dark aged parchment for night reading: deep umber and near-black leather-toned paper with faint golden fiber grain and softly burnished darker edges, subtle and quiet, still clearly old organic material.",
};

function parseArgs(argv) {
	const names = [];
	const opts = { model: "gpt-image-2", size: "1024x1536", quality: "high" };
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

async function loadApiKey() {
	if (process.env.OPENAI_API_KEY) return { key: process.env.OPENAI_API_KEY, source: "environment" };
	const envPath = path.join(ROOT, ".env.local");
	if (!existsSync(envPath)) throw new Error("OPENAI_API_KEY is not set and .env.local does not exist");
	const line = (await readFile(envPath, "utf8"))
		.split(/\r?\n/)
		.find((l) => l.startsWith("OPENAI_API_KEY="));
	if (!line) throw new Error("OPENAI_API_KEY is not set and .env.local does not define it");
	const key = line.slice("OPENAI_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
	if (!key) throw new Error("OPENAI_API_KEY in .env.local is empty");
	return { key, source: ".env.local" };
}

async function generate(name, { key, opts }) {
	const prompt = `${CONCEPTS[name]} ${STYLE}`;
	const res = await fetch("https://api.openai.com/v1/images/generations", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify({ model: opts.model, prompt, n: 1, size: opts.size, quality: opts.quality }),
	});
	if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
	const data = await res.json();
	const item = data.data?.[0];
	const buffer = item?.b64_json
		? Buffer.from(item.b64_json, "base64")
		: Buffer.from(await (await fetch(item.url)).arrayBuffer());
	const out = path.join(OUT_DIR, `parchment-${name}.png`);
	await writeFile(out, buffer);
	console.log(`${name}: ${out} (${Math.round(buffer.length / 1024)} KB)`);
}

const { names, opts } = parseArgs(process.argv.slice(2));
const { key, source } = await loadApiKey();
console.log(`Using OPENAI_API_KEY from ${source}; model ${opts.model} ${opts.size}`);
await mkdir(OUT_DIR, { recursive: true });
for (const name of names) {
	if (!CONCEPTS[name]) {
		console.error(`Unknown concept "${name}". Known: ${Object.keys(CONCEPTS).join(", ")}`);
		process.exit(1);
	}
	await generate(name, { key, opts });
}
