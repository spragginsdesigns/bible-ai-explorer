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
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2022,
			esModuleInterop: true,
		},
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
const prefix = `reading-integrity-${randomUUID()}`;
const users = [prefix, `${prefix}-legacy`];
const input = (eventId, day, chapter = 3, extra = {}) => ({
	eventId,
	sessionId: eventId,
	source: "reader",
	book: 43,
	chapter,
	occurredAt: `2024-06-${String(day).padStart(2, "0")}T16:00:00.000Z`,
	timezone: "America/Los_Angeles",
	completed: true,
	revision: 1,
	...extra,
});
const owner = users[0];
async function assertSummaries() {
	const entries = await prisma.readingLogEntry.findMany({ where: { userId: owner, deletedAt: null } });
	const stats = await log.getReadingLogStats(owner);
	assert.equal(stats.sessions, new Set(entries.map((entry) => entry.sessionId)).size);
	assert.equal(stats.activeDays, new Set(entries.map((entry) => entry.localDate)).size);
	assert.equal(stats.chapterReadings, entries.filter((entry) => entry.completed).length);
	assert.equal(stats.partialReadings, entries.filter((entry) => !entry.completed).length);
	assert.equal(
		stats.uniqueChapters,
		new Set(entries.filter((entry) => entry.completed).map((entry) => `${entry.book}:${entry.chapter}`)).size,
	);
	const chapters = await prisma.readingLogChapter.findMany({ where: { userId: owner } });
	for (const chapter of chapters) {
		const matching = entries.filter(
			(entry) => entry.book === chapter.book && entry.chapter === chapter.chapter,
		);
		assert.equal(chapter.entries, matching.length);
		for (let verse = 1; verse <= chapter.verseCounts.length; verse++) {
			assert.equal(
				chapter.verseCounts[verse - 1],
				matching.filter((entry) =>
					entry.verseRanges.some((range) => range.start <= verse && range.end >= verse),
				).length,
			);
		}
	}
	const activeDays = new Set(entries.map((entry) => entry.localDate));
	const streaks = await prisma.readingLogStreak.findMany({
		where: { userId: owner },
		orderBy: { startDate: "asc" },
	});
	const intervalDays = new Set();
	for (const interval of streaks) {
		for (
			let at = new Date(interval.startDate);
			at <= new Date(interval.endDate);
			at = new Date(at.getTime() + 86400_000)
		) {
			const day = at.toISOString().slice(0, 10);
			assert.ok(!intervalDays.has(day));
			intervalDays.add(day);
		}
	}
	assert.deepEqual([...intervalDays].sort(), [...activeDays].sort());
}
try {
	await prisma.user.createMany({ data: users.map((id) => ({ id })) });
	for (const day of [1, 3, 2, 5, 4]) await log.recordReading(owner, input(`day-${day}`, day));
	assert.equal(await prisma.readingLogStreak.count({ where: { userId: owner } }), 1);
	await log.removeReading(owner, "day-3");
	assert.equal(await prisma.readingLogStreak.count({ where: { userId: owner } }), 2);
	await assertSummaries();
	await log.correctReading(owner, "day-2", { occurredAt: "2024-06-08T16:00:00.000Z", revision: 1 });
	await assertSummaries();
	const replay = await log.recordReading(owner, input("day-2", 2, 3, { revision: 100 }));
	assert.equal(replay.recorded, false);
	assert.equal(replay.entry.occurredAt, "2024-06-08T16:00:00.000Z");
	assert.ok(replay.entry.correctedAt);
	await assertSummaries();
	await assert.rejects(
		() => log.correctReading(owner, "day-2", { chapter: 4, revision: 1 }),
		(error) => error.status === 409,
	);
	await assert.rejects(
		() => log.removeReading(owner, "day-2", 1),
		(error) => error.status === 409,
	);
	console.log("PASS streak merge/split, date corrections, stale correction and removal guards");
	for (let i = 0; i < 24; i++) {
		const event = input(`mixed-${i}`, (i % 8) + 1, (i % 3) + 1, {
			completed: false,
			verseRanges: [{ start: 1 + (i % 7), end: 12 + (i % 7) }],
		});
		await log.recordReading(owner, event);
		if (i % 2 === 0)
			await log.recordReading(owner, { ...event, revision: 2, completed: true, verseRanges: undefined });
		if (i % 5 === 0) await log.removeReading(owner, event.eventId);
	}
	await assertSummaries();
	const dated = await log.getReadingLogStats(owner, {
		book: 43,
		chapter: 3,
		fromDate: "2024-01-01",
		toDate: "2024-12-31",
		verseStart: 7,
		verseEnd: 9,
	});
	assert.ok(dated.coverage[0].verseReadings.every((verse) => verse.verse >= 7 && verse.verse <= 9));
	const matched = await log.searchReadingLog(owner, {
		book: 43,
		chapter: 3,
		verseStart: 7,
		verseEnd: 9,
		limit: 100,
	});
	assert.ok(
		matched.entries.every((entry) => entry.verseRanges.some((range) => range.start <= 9 && range.end >= 7)),
	);
	console.log(
		"PASS mixed partial/revision/delete summaries match independently folded events and verse filters",
	);
	for (const [id, localDate, timezone, expected] of [
		["dst-start", "2024-03-10", "America/Los_Angeles", "2024-03-10T08:00:00.000Z"],
		["dst-after", "2024-03-11", "America/Los_Angeles", "2024-03-11T07:00:00.000Z"],
		["date-line", "2024-03-11", "Pacific/Kiritimati", "2024-03-10T10:00:00.000Z"],
	]) {
		const saved = await log.recordReading(
			owner,
			input(id, 1, 3, { precision: "day", occurredAt: undefined, localDate, timezone }),
		);
		assert.equal(saved.entry.occurredAt, null);
		const raw = await prisma.readingLogEntry.findUniqueOrThrow({
			where: { userId_eventId: { userId: owner, eventId: id } },
		});
		assert.equal(raw.occurredAt.toISOString(), expected);
	}
	console.log(
		"PASS coarse date bounds respect DST and international date-line offsets without exposing fabricated times",
	);

	await prisma.readingEvent.createMany({
		data: [1, 2, 3].map((chapter) => ({
			id: `${prefix}-old-${chapter}`,
			userId: users[1],
			book: "John",
			chapter,
			translation: "KJV",
			readAt: new Date("2006-05-01T12:00:00Z"),
		})),
	});
	const before = await log.getReadingLogStats(users[1]);
	assert.equal(before.historicalBackfillPending, true);
	const first = await log.backfillReadingHistoryBatch(users[1], 2);
	assert.equal(first.migrated, 2);
	assert.equal(first.complete, false);
	const second = await log.backfillReadingHistoryBatch(users[1], 2);
	assert.equal(second.migrated, 1);
	assert.equal(second.complete, true);
	const again = await log.backfillReadingHistoryBatch(users[1], 2);
	assert.equal(again.migrated, 0);
	const migrated = await log.searchReadingLog(users[1]);
	assert.equal(migrated.entries.length, 3);
	assert.ok(
		migrated.entries.every(
			(entry) =>
				entry.source === "legacy" &&
				entry.precision === "legacy" &&
				entry.reportedAt === "2006-05-01T12:00:00.000Z",
		),
	);
	assert.equal((await log.getReadingLogStats(users[1])).historicalBackfillPending, false);
	assert.equal(await prisma.readingEvent.count({ where: { userId: users[1] } }), 3);
	console.log(
		"PASS resumable legacy migration preserves original dates/provenance and original rows without duplicates",
	);
} finally {
	await prisma.user.deleteMany({ where: { id: { in: users } } });
	await prisma.$disconnect();
}
