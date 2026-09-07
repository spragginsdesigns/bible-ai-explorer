/** Opt-in integration proof: real Postgres + Astra high. Creates and removes
 * only uniquely named QA users; never mutates an existing user's data.
 * Run: node scripts/verify-memory-tools.mjs --live
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { stripTypeScriptTypes } from "node:module";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, isStepCount, tool, Output } from "ai";
import { z } from "zod";

if (!process.argv.includes("--live")) throw new Error("Pass --live to run the paid Astra integration check.");
const env = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
if (!env.DATABASE_URL || !env.OPENAI_API_KEY) throw new Error("Required local credentials are missing.");
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const model = createOpenAI({ apiKey: env.OPENAI_API_KEY })("gpt-6-astra");
function loadModule(path, dependencies, exports) {
	const source = readFileSync(new URL(path, import.meta.url), "utf8")
		.replace(/^import\s[^;]*?;\s*$/gm, "").replace(/^export\s+/gm, "");
	return new Function(...Object.keys(dependencies), `${stripTypeScriptTypes(source)}\nreturn { ${exports.join(", ")} };`)(...Object.values(dependencies));
}
const policy = loadModule("../src/lib/memory-policy.ts", {}, ["allowsMemoryUse", "usedMemoryTools"]);
const memory = loadModule("../src/lib/memory.ts", {
	prisma, z, generateText, Output, ...policy,
	resolveModel: async () => ({ model: createOpenAI({ apiKey: env.OPENAI_API_KEY })("gpt-5.6-terra"), providerOptions: { openai: { reasoningEffort: "low" } } }),
}, ["MAX_MEMORIES_PER_USER", "MAX_MEMORY_CONTENT_LENGTH", "MEMORY_CATEGORIES", "extractAndStoreMemories"]);
const { buildMemoryTools } = loadModule("../src/lib/memory-tools.ts", { prisma, tool, z, ...memory }, ["buildMemoryTools"]);
const { chatSystemPrompt } = loadModule("../src/utils/systemPrompt.ts", {}, ["chatSystemPrompt"]);
const prefix = `memory-qa-${randomUUID()}`;
const owner = `${prefix}-owner`, other = `${prefix}-other`;
const evidence = [];
try {
	const [identity] = await prisma.$queryRaw`SELECT current_database() AS database, current_schema() AS schema`;
	assert.deepEqual(identity, { database: "neondb", schema: "public" });
	await prisma.user.createMany({ data: [{ id: owner }, { id: other }] });
	const tools = buildMemoryTools(owner);
	const otherTools = buildMemoryTools(other);
	const foreign = await otherTools.saveMemory.execute({ content: "Private marker owned by a different QA account.", category: "general" });
	assert.equal(foreign.success, true);
	assert.equal((await tools.updateMemory.execute({ id: foreign.memory.id, content: "Unauthorized change", category: "general" })).success, false);
	assert.equal((await tools.deleteMemories.execute({ ids: [foreign.memory.id] })).success, false);
	assert.deepEqual((await tools.listMemories.execute({})).memories, []);
	evidence.push("Cross-user read/update/delete isolation passed against Postgres.");
	const turn = async (prompt) => {
		const result = await generateText({ model, providerOptions: { openai: { reasoningEffort: "high" } }, instructions: chatSystemPrompt("KJV"), tools, stopWhen: isStepCount(8), prompt });
		const calls = result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
		evidence.push({ prompt, calls, response: result.text });
		return { result, calls };
	};
	const saved = await turn("Please remember that I study the Gospel of John every Tuesday evening. Save this in memory now.");
	assert.ok(saved.calls.includes("saveMemory"));
	let rows = await prisma.userMemory.findMany({ where: { userId: owner } });
	assert.equal(rows.length, 1);
	assert.match(rows[0].content, /Tuesday/i);
	const updated = await turn("My weekly Gospel of John study moved from Tuesday to Thursday evening. Please update the saved memory.");
	assert.ok(updated.calls.includes("updateMemory"));
	rows = await prisma.userMemory.findMany({ where: { userId: owner } });
	assert.equal(rows.length, 1);
	assert.match(rows[0].content, /Thursday/i);
	const recalled = await turn("/memory");
	assert.ok(recalled.calls.includes("listMemories"));
	assert.match(recalled.result.text, /Thursday/i);
	const removed = await turn("Please forget my weekly Gospel of John study schedule. Delete that saved memory now.");
	assert.ok(removed.calls.includes("deleteMemories"));
	assert.equal(await prisma.userMemory.count({ where: { userId: owner } }), 0);
	await prisma.user.update({ where: { id: owner }, data: { memoryEnabled: false } });
	assert.equal((await tools.listMemories.execute({})).success, false);
	assert.equal((await tools.saveMemory.execute({ content: "Should not save", category: "general" })).success, false);
	await prisma.user.update({ where: { id: owner }, data: { memoryEnabled: true } });
	await memory.extractAndStoreMemories({ userId: owner, userText: "My name is Memory QA and I study the Gospel of John every Thursday evening." });
	assert.ok(await prisma.userMemory.count({ where: { userId: owner } }) > 0);
	evidence.push("Background extraction persisted real user facts; disabled memory blocked reads and writes.");
	assert.equal((await prisma.userMemory.findUnique({ where: { id: foreign.memory.id } })).content, "Private marker owned by a different QA account.");
	console.log(JSON.stringify({ passed: true, model: "gpt-6-astra", reasoning: "high", evidence }, null, 2));
} finally {
	await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
	await prisma.$disconnect();
}
