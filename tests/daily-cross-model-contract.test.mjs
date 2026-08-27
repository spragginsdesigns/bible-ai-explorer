import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Daily Cross selection is pinned to built-in GPT-5.6 Sol at xhigh", async () => {
	const [model, selector] = await Promise.all([
		read("src/lib/ai/built-in-openai.ts"),
		read("src/lib/daily-cross-selector.ts"),
	]);
	assert.match(model, /DAILY_CROSS_MODEL_ID = "gpt-5\.6-sol"/);
	assert.match(selector, /reasoning: "xhigh"/);
	assert.match(selector, /new ToolLoopAgent/);
	assert.match(selector, /get_personal_context/);
	assert.match(selector, /get_scripture_context/);
});

test("the writer and Listen use the locked Sol path at high reasoning", async () => {
	const [cross, audio] = await Promise.all([
		read("src/lib/daily-cross.ts"),
		read("src/lib/daily-cross-audio.ts"),
	]);
	assert.match(cross, /model: builtInDailyCrossModel\(\),\s*reasoning: "high"/s);
	assert.match(audio, /model: builtInDailyCrossModel\(\),\s*reasoning: "high"/s);
	assert.doesNotMatch(cross, /resolveModel\(/);
	assert.doesNotMatch(audio, /resolveModel\(/);
	assert.doesNotMatch(audio, /loadStudyContext\(/);
});

test("new Daily Cross rows persist selection and fallback provenance", async () => {
	const cross = await read("src/lib/daily-cross.ts");
	for (const field of [
		"primaryTheme",
		"primaryThemeKey",
		"selectionMode",
		"selectionReason",
		"selectionEvidence",
		"selectorModel",
		"selectorEffort",
		"writerModel",
		"writerEffort",
		"isFallback",
		"fallbackReason",
	]) {
		assert.match(cross, new RegExp(`${field}:.*cross\\.${field}`), `${field} must be persisted`);
	}
});

test("Listen claims generation atomically and only its claimant may finish", async () => {
	const audio = await read("src/lib/daily-cross-audio.ts");
	assert.match(audio, /const claim = await prisma\.verseOfDay\.updateMany/);
	assert.match(audio, /if \(claim\.count === 0\)/);
	assert.match(audio, /audioStatus: "pending", audioGeneratedAt: claimedAt/);
	assert.match(audio, /where: \{ id: cross\.id, audioStatus: "pending", audioGeneratedAt: claimedAt \}/);
	assert.match(audio, /`\$\{cross\.id\}-\$\{claimedAt\.getTime\(\)\}`/);
	assert.match(audio, /allowOverwrite: false/);
	assert.match(audio, /deleteAttachmentBlob\(blob\.pathname\)/);
});

test("the hourly cron bounds the whole cohort with a shared abort deadline", async () => {
	const cron = await read("src/app/api/cron/verse-of-day/route.ts");
	assert.match(cron, /DAILY_CROSS_CONCURRENCY = MAX_USERS_PER_RUN/);
	assert.match(cron, /AbortSignal\.timeout\(DAILY_CROSS_GENERATION_BUDGET_MS\)/);
	assert.match(cron, /generateDailyCross\(userId, \{ abortSignal: generationSignal \}\)/);
	assert.match(cron, /refreshSuggestedQuestions\(userId, \{ abortSignal: generationSignal \}\)/);
});
