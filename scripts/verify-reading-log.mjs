/** Real PostgreSQL acceptance checks. Only runs against an explicitly supplied
 * local database; benchmark fixtures never belong in a production account.
 * READING_TEST_DATABASE_URL=postgresql://... node scripts/verify-reading-log.mjs
 * Add --benchmark for a million-row, decades-long query workload.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { PrismaClient } from "@prisma/client";

const database = process.env.READING_TEST_DATABASE_URL;
if (!database || !["localhost", "127.0.0.1"].includes(new URL(database).hostname)) {
	throw new Error("READING_TEST_DATABASE_URL must explicitly name an isolated local PostgreSQL database.");
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const prisma = new PrismaClient({ datasources: { db: { url: database } } });
const modules = new Map();
function load(path) {
	if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
	if (modules.has(path)) return modules.get(path).exports;
	const module = { exports: {} };
	modules.set(path, module);
	const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
	}).outputText;
	const localRequire = (id) => {
		if (id === "server-only") return {};
		if (id === "@/lib/prisma") return { prisma };
		if (id.startsWith("@/") || id.startsWith(".")) {
			const candidate = id.startsWith("@/") ? resolve(root, "src", id.slice(2)) : resolve(dirname(path), id);
			return load(existsSync(candidate) ? candidate : `${candidate}.ts`);
		}
		return require(id);
	};
	new Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
	return module.exports;
}
const log = load(resolve(root, "src/lib/reading-log.ts"));
const prefix = `reading-acceptance-${randomUUID()}`;
const owner = `${prefix}-owner`, stranger = `${prefix}-stranger`;
const report = { checks: [], benchmark: null };
const check = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
const at = "2025-01-15T16:00:00.000Z";
const input = (sessionId, chapter, extra = {}) => ({
	eventId: `${sessionId}:${chapter}`, sessionId, source: "physical", book: 43, chapter,
	translation: "KJV", occurredAt: at, timezone: "America/Los_Angeles", completed: true, revision: 1, ...extra,
});
try {
	await prisma.user.createMany({ data: [{ id: owner }, { id: stranger }] });
	const morning = [1, 2, 3].map((chapter) => input("morning", chapter));
	const evening = [1, 2, 3].map((chapter) => input("evening", chapter, { occurredAt: "2025-01-16T04:00:00.000Z" }));
	await log.recordReadings(owner, morning);
	await log.recordReadings(owner, evening);
	let stats = await log.getReadingLogStats(owner);
	assert.equal(stats.sessions, 2); assert.equal(stats.chapterReadings, 6);
	assert.equal(stats.uniqueChapters, 3); assert.equal(stats.activeDays, 1);
	check("morning and evening John 1-3 are six readings, three chapters, two sessions, one local day");
	await Promise.all(Array.from({ length: 20 }, () => log.recordReadings(owner, morning)));
	assert.equal((await log.getReadingLogStats(owner)).chapterReadings, 6);
	check("20 concurrent lost-ack retries do not double count");
	await assert.rejects(() => log.recordReadings(owner, [{ ...morning[0], occurredAt: "2025-01-15T17:00:00.000Z" }, ...morning.slice(1)]));
	check("same revision with changed payload is rejected");
	await assert.rejects(() => log.recordReadings(owner, [input("atomic", 4), input("atomic", 99)]));
	assert.equal((await log.searchReadingLog(owner, { chapter: 4, book: 43 })).entries.length, 0);
	check("invalid range makes the entire multi-chapter save fail atomically");
	const partial = input("partial", 3, { verseStart: 16, verseEnd: 21, completed: false, source: "reader" });
	await log.recordReading(owner, partial);
	await Promise.all([
		log.recordReading(owner, { ...partial, revision: 2, verseEnd: 25 }),
		log.recordReading(owner, { ...partial, revision: 3, verseEnd: 30 }),
	]);
	const partialRow = await prisma.readingLogEntry.findUnique({ where: { userId_eventId: { userId: owner, eventId: partial.eventId } } });
	assert.equal(partialRow.revision, 3); assert.deepEqual(partialRow.verseRanges, [{ start: 16, end: 30 }]);
	assert.equal((await log.getReadingLogStats(owner)).chapterReadings, 6);
	check("concurrent revisions preserve newest partial coverage without crediting a full chapter");
	await assert.rejects(() => log.correctReading(stranger, partial.eventId, { chapter: 4 }));
	await assert.rejects(() => log.removeReading(stranger, partial.eventId));
	assert.equal((await log.searchReadingLog(stranger)).entries.length, 0);
	check("other accounts cannot read, correct, or delete entries");
	await log.removeReading(owner, partial.eventId);
	await log.recordReading(owner, { ...partial, revision: 100 });
	assert.equal((await log.searchReadingLog(owner)).entries.length, 6);
	assert.equal((await log.getReadingLogStats(owner)).partialReadings, 0);
	check("deletion updates summaries and prevents stale offline resurrection");
	await log.correctReading(owner, morning[0].eventId, { chapter: 4, revision: 1 });
	stats = await log.getReadingLogStats(owner);
	assert.equal(stats.chapterReadings, 6); assert.equal(stats.uniqueChapters, 4);
	check("correction moves chapter coverage without changing reading counts");
	const coarse = input("coarse", 5, { occurredAt: undefined, localDate: "2025-01-14", precision: "morning" });
	const coarseResult = await log.recordReading(owner, coarse);
	assert.equal(coarseResult.entry.occurredAt, null);
	assert.equal(coarseResult.entry.localDate, "2025-01-14");
	check("approximate morning retains calendar date without inventing an exact time");
	let cursor, ids = [];
	do {
		const page = await log.searchReadingLog(owner, { limit: 2, ...(cursor ? { cursor } : {}) });
		ids.push(...page.entries.map((entry) => entry.eventId)); cursor = page.nextCursor;
	} while (cursor);
	assert.equal(ids.length, 7); assert.equal(new Set(ids).size, 7);
	check("keyset pagination returns every entry once across timestamp ties");
	if (process.argv.includes("--benchmark")) {
		const benchOwner = `${prefix}-benchmark`;
		await prisma.user.create({ data: { id: benchOwner } });
		console.log("Seeding one million local history rows; no production database is involved.");
		await prisma.$executeRaw`INSERT INTO "ReadingLogEntry"
			("userId","eventId","sessionId",revision,source,book,chapter,"verseRanges",translation,"occurredAt","reportedAt","localDate",timezone,precision,completed,evidence,"activeSeconds","updatedAt")
			SELECT ${benchOwner}, 'bench:' || n, 'session:' || (n / 3), 1, 'reader', 43, 1 + (n % 21),
			'[{"start":1,"end":5}]'::jsonb, 'KJV', timestamp '1996-01-01' + n * interval '15 minutes',
			timestamp '1996-01-01' + n * interval '15 minutes',
			to_char(timestamp '1996-01-01' + n * interval '15 minutes', 'YYYY-MM-DD'), 'UTC', 'exact', false, 'active_view', 8, now()
			FROM generate_series(1,1000000) n`;
		await prisma.$executeRawUnsafe('ANALYZE "ReadingLogEntry"');
		const samples = [];
		for (let i = 0; i < 50; i++) {
			const start = performance.now();
			await log.searchReadingLog(benchOwner, { book: 43, chapter: 3, limit: 30 });
			samples.push(performance.now() - start);
		}
		const plan = await prisma.$queryRaw`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
			SELECT * FROM "ReadingLogEntry" WHERE "userId"=${benchOwner} AND "deletedAt" IS NULL AND book=43 AND chapter=3
			ORDER BY "occurredAt" DESC,"eventId" DESC LIMIT 31`;
		const sorted = samples.sort((a,b)=>a-b);
		report.benchmark = { rows: 1000000, iterations: 50, medianMs: sorted[25], p95Ms: sorted[47], maxMs: sorted[49], plan };
		if (process.env.READING_TEST_REPORT) writeFileSync(process.env.READING_TEST_REPORT, JSON.stringify(report, null, 2));
		const nodes = [];
		const visit = (node) => { if (node && typeof node === "object") { if (node["Node Type"]) nodes.push(node); Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(visit) : visit(value)); } };
		visit(plan[0]);
		assert.ok(nodes.some(node => node["Node Type"] === "Index Scan"), "Passage lookup must use an index at scale.");
		assert.ok(nodes.every(node => !["Sort", "Seq Scan"].includes(node["Node Type"])), "History pages must use index ordering instead of sorting the account history.");
		assert.ok(nodes.every(node => node["Actual Rows"] <= 62), "History page scan must stay bounded to the requested page.");
		assert.ok(sorted[47] < 250, "Local indexed history lookup p95 must stay below 250 ms.");
		check("million-row account passage query uses index with local p95 under 250 ms");
	}
	if (process.env.READING_TEST_REPORT) writeFileSync(process.env.READING_TEST_REPORT, JSON.stringify(report, null, 2));
	console.log(JSON.stringify({ checks: report.checks.length, benchmark: report.benchmark && { p95Ms: report.benchmark.p95Ms, rows: report.benchmark.rows } }));
} finally {
	await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
	await prisma.$disconnect();
}
