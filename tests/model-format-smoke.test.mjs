/* D3: golden-output smoke test for the MARKDOWN OUTPUT RULES block.
 *
 * Opt-in and offline by default: it makes real, billed provider calls, so it
 * only runs with RUN_MODEL_SMOKE=1, and then only for providers whose key is
 * present. `pnpm test:logic` stays hermetic.
 *
 *   RUN_MODEL_SMOKE=1 node --experimental-strip-types --test tests/model-format-smoke.test.mjs
 *
 * It exercises the PROMPT, not the route: one fixed question, no tools, no
 * memories, no conversation history. What it proves is that the formatting
 * contract survives a real generation on each head - the normalized answer
 * carries none of the quirks the two renderers disagree on. Model ids come
 * from the curated registry (src/lib/ai/models.ts); this test never changes
 * what the picker offers.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeAssistantMarkdown } from "../src/utils/assistantMarkdown.ts";
import { chatSystemPrompt } from "../src/utils/systemPrompt.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Load .env.local into process.env without overwriting a real environment. */
function loadLocalEnv() {
	const envPath = join(repoRoot, ".env.local");
	if (!existsSync(envPath)) return;
	for (const line of readFileSync(envPath, "utf8").split("\n")) {
		const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
		if (!match || process.env[match[1]]) continue;
		process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
	}
}

const QUESTION =
	"What does 2 Peter 1:19 mean, and how should it shape the way I read my Bible each morning?";

const CANDIDATES = [
	{ id: "openai/gpt-5.6-terra", provider: "openai", model: "gpt-5.6-terra" },
	{ id: "anthropic/claude-opus-5", provider: "anthropic", model: "claude-opus-5" },
	{ id: "anthropic/claude-sonnet-5", provider: "anthropic", model: "claude-sonnet-5" },
	{ id: "moonshot/kimi-k3", provider: "moonshot", model: "kimi-k3" },
];

const KEY_ENV = {
	openai: "OPENAI_API_KEY",
	anthropic: "ANTHROPIC_API_KEY",
	moonshot: "MOONSHOT_API_KEY",
};

async function generate({ provider, model }, system, question) {
	const apiKey = process.env[KEY_ENV[provider]];
	if (provider === "anthropic") {
		const response = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model,
				max_tokens: 1200,
				system,
				messages: [{ role: "user", content: question }],
			}),
		});
		if (!response.ok) throw new Error(`anthropic ${response.status}`);
		const json = await response.json();
		return json.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n\n");
	}

	const baseUrl =
		provider === "moonshot" ? "https://api.moonshot.ai/v1" : "https://api.openai.com/v1";
	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: question },
			],
		}),
	});
	if (!response.ok) throw new Error(`${provider} ${response.status}`);
	const json = await response.json();
	return json.choices[0].message.content ?? "";
}

/** The quirks the two renderers disagree on, counted rather than just asserted. */
function countQuirks(markdown) {
	const lines = markdown.split("\n");
	let inFence = false;
	let bareQuoteLines = 0;
	let indentedListLines = 0;
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
		if (inFence) continue;
		if (/^\s*>\s*$/.test(line)) bareQuoteLines += 1;
		if (/^(\t| {4,})[-*+] /.test(line)) indentedListLines += 1;
	}
	return {
		bareQuoteLines,
		indentedListLines,
		exoticBullets: (markdown.match(/[•●▪◦○‣]/g) ?? []).length,
		htmlTags: (markdown.match(/<\/?(br|sup|sub|div|span|b|i|u|em|strong)\b[^>]*>/gi) ?? []).length,
		setextHeadings: lines.filter((line, index) => index > 0 && /^(=+|-{3,})\s*$/.test(line) && lines[index - 1].trim()).length,
		endsOnColon: markdown.trimEnd().endsWith(":") ? 1 : 0,
		leftoverMarkers: (markdown.match(/\[FOLLOWUP\]/g) ?? []).length,
	};
}

const enabled = process.env.RUN_MODEL_SMOKE === "1";
// Only read .env.local when this suite is actually going to run. A hermetic
// `pnpm test:logic` must not pull the developer's real provider keys into
// process.env as a side effect of importing a skipped test file.
if (enabled) loadLocalEnv();
const configured = enabled
	? CANDIDATES.filter((candidate) => process.env[KEY_ENV[candidate.provider]])
	: [];

test("model formatting smoke", { skip: !enabled || configured.length === 0, timeout: 300000 }, async (t) => {
	const system = chatSystemPrompt("KJV");

	for (const candidate of configured) {
		await t.test(candidate.id, async () => {
			const raw = await generate(candidate, system, QUESTION);
			const normalized = normalizeAssistantMarkdown(raw, { streaming: false });
			const quirks = countQuirks(normalized);
			// Printed so a run doubles as a measurement, not just a pass/fail.
			console.log(candidate.id, JSON.stringify(quirks));

			assert.equal(quirks.bareQuoteLines, 0, "a bare '>' line splits the blockquote in two");
			assert.equal(quirks.exoticBullets, 0, "a glyph bullet is not a list marker");
			assert.equal(quirks.htmlTags, 0, "inline HTML renders literally on Android");
			assert.equal(quirks.indentedListLines, 0, "4-space indent makes a list an indented code block");
			assert.equal(quirks.setextHeadings, 0, "setext underlines are not the agreed heading form");
			assert.equal(quirks.leftoverMarkers, 0, "markers must be stripped before rendering");
			assert.equal(quirks.endsOnColon, 0, "a dangling lead-in was left where the markers used to be");
		});
	}
});
