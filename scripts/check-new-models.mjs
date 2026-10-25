#!/usr/bin/env node
/**
 * Which chat models the providers released since the last check.
 *
 *   node --experimental-strip-types scripts/check-new-models.mjs [--accept]
 *
 * Asks every provider whose key is set (OPENAI_API_KEY, ANTHROPIC_API_KEY,
 * MOONSHOT_API_KEY; OpenRouter's catalog is public) for its live model list
 * and prints the ids in SureWord's families that are neither curated in
 * `MODELS` (src/lib/ai/models.ts) nor already in the baseline,
 * scripts/fixtures/known-provider-models.json. The baseline is what makes it
 * "new": every older head a provider still serves is in it. Keys come from
 * the environment, then .env.local, then .env.
 *
 * It adds no model itself, because an entry needs its price, context window
 * and effort list from the vendor's model page, and the included plans
 * (`HOUSE_CHAT_MODEL_IDS`) only move on Austin's say-so. Once the new heads
 * are curated or deliberately skipped, `--accept` writes them into the
 * baseline. A provider whose key is missing keeps its old baseline entries.
 *
 * Exit code 0 means nothing new, 2 means at least one new model.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS } from "../src/lib/ai/models.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselineFile = path.join(root, "scripts", "fixtures", "known-provider-models.json");
const accept = process.argv.includes("--accept");

function readEnvFile(name) {
	const file = path.join(root, name);
	if (!fs.existsSync(file)) return {};
	return Object.fromEntries(
		fs
			.readFileSync(file, "utf8")
			.split(/\r?\n/)
			.filter((line) => /^[A-Z0-9_]+=/.test(line))
			.map((line) => {
				const index = line.indexOf("=");
				return [line.slice(0, index), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
			}),
	);
}

const fileEnv = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
const key = (name) => process.env[name]?.trim() || fileEnv[name]?.trim() || null;

// Only the families SureWord offers; dated snapshots, audio, image, embedding
// and realtime heads are not chat models the picker could list.
const SKIP = /(\d{4}-\d{2}-\d{2}|\d{8}|audio|realtime|transcribe|tts|image|embedding|moderation|search|codex|instruct|vision)/i;
const PROVIDERS = [
	{
		id: "openai",
		key: "OPENAI_API_KEY",
		url: "https://api.openai.com/v1/models",
		headers: (k) => ({ Authorization: `Bearer ${k}` }),
		family: /^gpt-[5-9]/,
	},
	{
		id: "anthropic",
		key: "ANTHROPIC_API_KEY",
		url: "https://api.anthropic.com/v1/models?limit=100",
		headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
		family: /^claude-(opus|sonnet|haiku)-[4-9]/,
	},
	{
		id: "moonshot",
		key: "MOONSHOT_API_KEY",
		url: "https://api.moonshot.ai/v1/models",
		headers: (k) => ({ Authorization: `Bearer ${k}` }),
		family: /^kimi-k\d/,
	},
	{
		id: "openrouter",
		key: null,
		url: "https://openrouter.ai/api/v1/models",
		headers: () => ({}),
		// OpenRouter lists hundreds of vendors; watch only the ones SureWord curates.
		family: /^z-ai\/glm-/,
	},
];

const curated = new Set(MODELS.map((model) => model.id));
const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, "utf8")) : {};
let found = 0;
for (const provider of PROVIDERS) {
	const apiKey = provider.key ? key(provider.key) : "";
	if (apiKey === null) {
		console.log(`${provider.id}: skipped, ${provider.key} is not set`);
		continue;
	}
	try {
		const response = await fetch(provider.url, { headers: provider.headers(apiKey) });
		if (!response.ok) {
			console.log(`${provider.id}: HTTP ${response.status}`);
			continue;
		}
		const ids = ((await response.json()).data ?? [])
			.map((model) => model.id)
			.filter((id) => provider.family.test(id) && !SKIP.test(id));
		const known = new Set(baseline[provider.id] ?? []);
		const fresh = ids.filter((id) => !known.has(id) && !curated.has(`${provider.id}/${id}`)).sort();
		found += fresh.length;
		console.log(`${provider.id}: ${fresh.length ? `new: ${fresh.join(", ")}` : "nothing new"}`);
		if (accept) baseline[provider.id] = [...new Set([...known, ...ids])].sort();
	} catch (error) {
		console.log(`${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
	}
}
if (accept) {
	fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
	fs.writeFileSync(baselineFile, `${JSON.stringify(baseline, null, "\t")}\n`);
	console.log(`baseline written: ${path.relative(root, baselineFile)}`);
	process.exit(0);
}
process.exit(found ? 2 : 0);
