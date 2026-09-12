#!/usr/bin/env node
/**
 * Opt-in authenticated answer evaluator.
 *
 * Hermetic scoring lives in src/lib/ai/answer-eval.ts. This script is the thin
 * real-route adapter: it sends UI messages to /api/ask-question, parses the AI
 * SDK UI-message SSE stream, and scores the answer plus successful tool output.
 * It never runs by default and never prints the bearer token or answer text.
 *
 *   ANSWER_EVAL_TOKEN=... ANSWER_EVAL_BASE_URL=https://sureword.app \
 *     node --experimental-strip-types scripts/eval-answers.mjs --live
 *
 * Write fixtures are skipped unless both --allow-mutations and
 * ANSWER_EVAL_ALLOW_MUTATIONS=1 are present. Read-only fixtures omit a
 * conversationId, but the route can still run other side effects (for example,
 * a model choosing a write tool), so the scorer treats those tools as failures.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

import { scoreAnswer, validateAnswerFixtures } from "../src/lib/ai/answer-eval.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = JSON.parse(
	await readFile(join(root, "scripts/fixtures/answer-evals.json"), "utf8"),
);
const fixtureErrors = validateAnswerFixtures(fixtures);

function parseJson(value) {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function uiMessages(fixture) {
	const messages = fixture.requestMessages ?? [
		...(fixture.history ?? []),
		{ role: "user", content: fixture.prompt },
	];
	return messages.map((message, index) => ({
		id: `eval-${fixture.id}-${index}`,
		role: message.role,
		parts: [{ type: "text", text: message.content }],
	}));
}

/** Parse current JSON UI-message events and legacy 0:/2: streams. */
export function parseUiMessageStream(raw) {
	const textParts = [];
	const calls = new Map();
	const stepIds = new Set();
	let sawStepStart = false;
	let routeError;
	let usage;
	let complete = false;
	for (const line of raw.split(/\r?\n/)) {
		if (!line.startsWith("data:")) continue;
		const data = line.slice(5).trim();
		if (!data) continue;
		if (data === "[DONE]") {
			complete = true;
			continue;
		}
		let event = parseJson(data);
		if (typeof event === "string" && /^[0-9A-Za-z]:/.test(event)) event = parseJson(event.slice(2));
		if (typeof event === "string") {
			if (data.startsWith("0:")) textParts.push(event);
			continue;
		}
		if (!event || typeof event !== "object") continue;
		const type = typeof event.type === "string" ? event.type : "";
		if (type === "start-step" || type === "step-start") {
			sawStepStart = true;
			stepIds.add(event.stepId ?? event.id ?? `step-${stepIds.size}`);
		}
		if (!sawStepStart && (type === "finish-step" || type === "step-finish")) {
			stepIds.add(event.stepId ?? event.id ?? `step-${stepIds.size}`);
		}
		if (type === "finish" || type === "finish-message" || type === "message-finish" || type === "done") complete = true;
		if (type === "text-delta" || type === "text") {
			const delta = event.delta ?? event.text;
			if (typeof delta === "string") textParts.push(delta);
		}
		if (type === "error" || type === "finish-error") {
			const error = event.error ?? event.errorText ?? event.message;
			routeError = typeof error === "string" ? error : error?.message ? String(error.message) : JSON.stringify(error);
		}
		if (event.usage && typeof event.usage === "object") usage = event.usage;
		if (event.totalUsage && typeof event.totalUsage === "object") usage = event.totalUsage;
		const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
		const toolName = typeof event.toolName === "string" ? event.toolName : typeof event.name === "string" ? event.name : undefined;
		if (type === "tool-input-start" || type === "tool-call" || type === "tool-input-available") {
			const id = toolCallId ?? `tool-${calls.size}`;
			const prior = calls.get(id) ?? {};
			calls.set(id, {
				...prior,
				name: toolName ?? prior.name ?? "unknown",
				input: event.input ?? event.args ?? prior.input,
				state: "input-available",
			});
		}
		if (type === "tool-input-delta" && toolCallId) {
			const prior = calls.get(toolCallId) ?? { name: toolName ?? "unknown" };
			calls.set(toolCallId, { ...prior, input: `${prior.input ?? ""}${event.delta ?? ""}` });
		}
		if (type === "tool-output-available" || type === "tool-result" || type === "tool-output") {
			const id = toolCallId ?? `tool-${calls.size}`;
			const prior = calls.get(id) ?? { name: toolName ?? "unknown" };
			calls.set(id, { ...prior, output: event.output ?? event.result, state: "output-available" });
		}
		if (type === "tool-output-error" || type === "tool-error") {
			const id = toolCallId ?? `tool-${calls.size}`;
			const prior = calls.get(id) ?? { name: toolName ?? "unknown" };
			const error = event.error ?? event.errorText ?? event.message ?? "tool failed";
			calls.set(id, { ...prior, state: "output-error", error: typeof error === "string" ? error : JSON.stringify(error) });
		}
	}
	return {
		text: textParts.join(""),
		toolCalls: [...calls.values()].map((call) => ({ ...call, input: parseJson(call.input) })),
		routeError,
		complete,
		usage: usage
			? {
				inputTokens: usage.inputTokens ?? usage.promptTokens,
				outputTokens: usage.outputTokens ?? usage.completionTokens,
				totalTokens: usage.totalTokens,
			}
			: undefined,
		steps: stepIds.size || undefined,
	};
}

export async function runOneFixture(fixture, options = {}) {
	if (fixture.sideEffects === "write" && !options.allowMutations) {
		return { fixtureId: fixture.id, category: fixture.category, skipped: "side effects disabled" };
	}
	const requestToken = options.token ?? (options.getToken ? await options.getToken(fixture) : process.env.ANSWER_EVAL_TOKEN);
	if (!requestToken) throw new Error("Missing ANSWER_EVAL_TOKEN in the environment.");
	const baseUrl = (options.baseUrl ?? process.env.ANSWER_EVAL_BASE_URL ?? "https://sureword.app").replace(/\/$/, "");
	const timeoutMs = Math.max(5_000, Number(options.timeoutMs ?? 120_000) || 120_000);
	const started = Date.now();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${baseUrl}/api/ask-question`, {
			method: "POST",
			headers: { accept: "text/event-stream", "content-type": "application/json", authorization: `Bearer ${requestToken}` },
			body: JSON.stringify({ messages: uiMessages(fixture), translation: fixture.translation ?? "KJV" }),
			signal: controller.signal,
		});
		const raw = await response.text();
		if (options.outputDir) {
			await mkdir(options.outputDir, { recursive: true });
			await writeFile(join(options.outputDir, `${fixture.id}.sse`), raw, "utf8");
		}
		const isStream = response.headers.get("content-type")?.includes("text/event-stream");
		const parsed = isStream ? parseUiMessageStream(raw) : { text: "", toolCalls: [], routeError: raw.slice(0, 300), complete: true };
		if (isStream && !parsed.complete && !parsed.routeError) parsed.routeError = "truncated SSE stream";
		return scoreAnswer(fixture, {
			status: response.status,
			text: parsed.text,
			translation: fixture.translation ?? "KJV",
			toolCalls: parsed.toolCalls,
			routeError: parsed.routeError,
			durationMs: Date.now() - started,
			steps: parsed.steps,
			usage: parsed.usage,
		});
	} catch (error) {
		return scoreAnswer(fixture, {
			status: 0,
			text: "",
			translation: fixture.translation ?? "KJV",
			toolCalls: [],
			routeError: error instanceof Error ? error.name : "request failed",
			durationMs: Date.now() - started,
		});
	} finally {
		clearTimeout(timeout);
	}
}

export async function main(argv = process.argv) {
	if (fixtureErrors.length > 0) {
		console.error(JSON.stringify({ error: "invalid answer fixtures", details: fixtureErrors }));
		return 1;
	}
	if (!argv.includes("--live")) {
		console.error("Refusing to call the real route without --live.");
		return 2;
	}
	const option = (name) => {
		const index = argv.indexOf(name);
		return index >= 0 ? argv[index + 1] : undefined;
	};
	const requestedIds = [
		...(process.env.ANSWER_EVAL_FIXTURES ?? "").split(",").map((value) => value.trim()).filter(Boolean),
		...(option("--fixture") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
	];
	const unknownIds = requestedIds.filter((id) => !fixtures.some((fixture) => fixture.id === id));
	if (unknownIds.length > 0) {
		console.error(JSON.stringify({ error: "unknown fixture id", ids: unknownIds }));
		return 2;
	}
	const selected = fixtures.filter((fixture) => requestedIds.length === 0 || requestedIds.includes(fixture.id));
	const allowMutations = argv.includes("--allow-mutations") && process.env.ANSWER_EVAL_ALLOW_MUTATIONS === "1";
	const options = {
		baseUrl: option("--base-url"),
		timeoutMs: option("--timeout-ms"),
		allowMutations,
		outputDir: option("--output-dir"),
		getToken: async () => process.env.ANSWER_EVAL_TOKEN,
	};
	const results = [];
	for (const fixture of selected) results.push(await runOneFixture(fixture, options));
	const scored = results.filter((result) => !result.skipped);
	console.log(JSON.stringify({
		baseUrl: options.baseUrl ?? process.env.ANSWER_EVAL_BASE_URL ?? "https://sureword.app",
		fixtureCount: selected.length,
		mutationsAllowed: allowMutations,
		passed: scored.filter((result) => result.pass).length,
		failed: scored.filter((result) => !result.pass).length,
		skipped: results.filter((result) => result.skipped).length,
		results,
	}, null, 2));
	return scored.some((result) => !result.pass) ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await main();
}
