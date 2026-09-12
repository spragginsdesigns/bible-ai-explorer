import "server-only";

import { Prisma, type ReadingLogEntry } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bookByOrder, BOOKS } from "@/lib/bible/books";
import { getKjvChapter } from "@/lib/bible/kjv";
import { localDayKey } from "@/lib/reading-history";

const key = z
	.string()
	.min(1)
	.max(160)
	.regex(/^[A-Za-z0-9_.:-]+$/);
const rangeSchema = z.object({ start: z.number().int().positive(), end: z.number().int().positive() });
export const readingLogSchema = z.object({
	eventId: key,
	sessionId: key,
	revision: z.number().int().min(1).max(2_147_483_647).default(1),
	source: z.enum(["reader", "physical"]),
	book: z.number().int().min(1).max(66),
	chapter: z.number().int().min(1).max(150),
	verseStart: z.number().int().positive().optional(),
	verseEnd: z.number().int().positive().optional(),
	verseRanges: z.array(rangeSchema).min(1).max(176).optional(),
	translation: z.string().min(1).max(20).default("KJV"),
	occurredAt: z.string().datetime({ offset: true }).optional(),
	localDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/)
		.optional(),
	timezone: z.string().min(1).max(80),
	precision: z.enum(["exact", "day", "morning", "afternoon", "evening"]).default("exact"),
	completed: z.boolean(),
	evidence: z.enum(["active_view", "chapter_end", "reported", "legacy"]).optional(),
	activeSeconds: z.number().int().min(0).max(604800).default(0),
});
export type ReadingLogInput = z.input<typeof readingLogSchema>;
export interface ReadingLogFilters {
	book?: number;
	chapter?: number;
	from?: string;
	to?: string;
	fromDate?: string;
	toDate?: string;
	verseStart?: number;
	verseEnd?: number;
	source?: "reader" | "physical" | "legacy";
	cursor?: string;
	limit?: number;
}
export class ReadingLogError extends Error {
	constructor(
		message: string,
		public status = 400,
	) {
		super(message);
	}
}
type Tx = Prisma.TransactionClient;
type Normalized = Omit<
	ReadingLogEntry,
	"userId" | "reportedAt" | "updatedAt" | "deletedAt" | "correctedAt"
> & {
	verseRanges: { start: number; end: number }[];
};

function assertDate(day: string) {
	const parsed = new Date(`${day}T12:00:00.000Z`);
	if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day)
		throw new ReadingLogError("Invalid calendar date.");
}

const dayBoundaries = new Map<string, Date>();
/** Earliest possible instant of a reported local day, including DST midnight
 * gaps. This is only a conservative ordering/plan bound, never a claimed time. */
function localDayLowerBound(day: string, timezone: string): Date {
	const cacheKey = `${timezone}:${day}`;
	const cached = dayBoundaries.get(cacheKey);
	if (cached) return cached;
	const middle = new Date(`${day}T00:00:00.000Z`).getTime() / 1000;
	let low = middle - 36 * 3600,
		high = middle + 36 * 3600;
	while (low < high) {
		const probe = Math.floor((low + high) / 2);
		if (localDayKey(new Date(probe * 1000), timezone) >= day) high = probe;
		else low = probe + 1;
	}
	const result = new Date(low * 1000);
	if (localDayKey(result, timezone) !== day)
		throw new ReadingLogError("That calendar day did not exist in this timezone.");
	if (dayBoundaries.size >= 512) dayBoundaries.delete(dayBoundaries.keys().next().value!);
	dayBoundaries.set(cacheKey, result);
	return result;
}

async function normalize(input: ReadingLogInput, now: Date): Promise<Normalized> {
	const parsed = readingLogSchema.safeParse(input);
	if (!parsed.success)
		throw new ReadingLogError(
			parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
		);
	const value = parsed.data;
	try {
		new Intl.DateTimeFormat("en", { timeZone: value.timezone });
	} catch {
		throw new ReadingLogError("Use a valid IANA timezone.");
	}
	const book = bookByOrder(value.book);
	if (!book || value.chapter > book.chapters) throw new ReadingLogError("That chapter does not exist.");
	const verseCount = (await getKjvChapter(value.book, value.chapter)).length;
	if (!verseCount) throw new ReadingLogError("That chapter does not exist.");
	if (value.verseRanges && (value.verseStart !== undefined || value.verseEnd !== undefined))
		throw new ReadingLogError("Supply verseRanges or verseStart/verseEnd, not both.");
	if (value.verseEnd !== undefined && value.verseStart === undefined)
		throw new ReadingLogError("verseEnd requires verseStart.");
	const ranges = value.verseRanges ?? [
		{ start: value.verseStart ?? 1, end: value.verseEnd ?? value.verseStart ?? verseCount },
	];
	const merged: { start: number; end: number }[] = [];
	for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
		if (range.start > range.end || range.end > verseCount)
			throw new ReadingLogError(`This chapter has ${verseCount} verses; the requested range is invalid.`);
		const last = merged[merged.length - 1];
		if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
		else merged.push({ ...range });
	}
	const occurredAt = value.occurredAt ? new Date(value.occurredAt) : now;
	if (occurredAt.getTime() > now.getTime() + 5 * 60_000)
		throw new ReadingLogError("A reading cannot be in the future.");
	const localDate = value.localDate ?? localDayKey(occurredAt, value.timezone);
	assertDate(localDate);
	if (localDate > localDayKey(now, value.timezone))
		throw new ReadingLogError("A reading cannot be on a future day.");
	if (value.precision === "exact" && localDate !== localDayKey(occurredAt, value.timezone))
		throw new ReadingLogError("localDate does not match the timestamp and timezone.");
	// A coarse date gets an internal ordering anchor only; publicEntry never
	// exposes that anchor as an actual reading timestamp.
	const at = value.precision === "exact" ? occurredAt : localDayLowerBound(localDate, value.timezone);
	const full = merged.length === 1 && merged[0].start === 1 && merged[0].end === verseCount;
	return {
		eventId: value.eventId,
		sessionId: value.sessionId,
		revision: value.revision,
		source: value.source,
		book: value.book,
		chapter: value.chapter,
		verseRanges: merged,
		translation: value.translation,
		occurredAt: at,
		localDate,
		timezone: value.timezone,
		precision: value.precision,
		completed: value.completed && full,
		evidence: value.evidence ?? (value.source === "physical" ? "reported" : "active_view"),
		activeSeconds: value.activeSeconds,
	};
}

export function publicReadingEntry(entry: ReadingLogEntry) {
	return {
		...entry,
		bookName: bookByOrder(entry.book)?.name ?? String(entry.book),
		occurredAt:
			entry.precision === "exact" || entry.precision === "legacy" ? entry.occurredAt.toISOString() : null,
		reportedAt: entry.reportedAt.toISOString(),
		updatedAt: entry.updatedAt.toISOString(),
		deletedAt: entry.deletedAt?.toISOString() ?? null,
		correctedAt: entry.correctedAt?.toISOString() ?? null,
	};
}

/** Serialize one account's short writes, including updates and offline retries.
 * SQL uniqueness remains the final guard; lock lifetime is the transaction. */
async function lockAccount(tx: Tx, userId: string) {
	const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
	if (!rows.length) throw new ReadingLogError("Account not found.", 404);
	await tx.readingLogTotals.upsert({
		where: { userId },
		create: {
			userId,
			legacyBackfilled: !(await tx.readingEvent.findFirst({ where: { userId }, select: { id: true } })),
		},
		update: {},
	});
}

/** Summary updates execute in PostgreSQL; corrections use the same function
 * as the single-round-trip batched write path. */
async function applyDelta(tx: Tx, entry: ReadingLogEntry, sign: 1 | -1) {
	await tx.$queryRaw`SELECT sureword_reading_delta(${JSON.stringify(entry)}::jsonb, ${sign}::integer)::text`;
}

async function refreshLastRead(tx: Tx, userId: string) {
	const latest = await tx.readingLogEntry.findFirst({
		where: { userId, deletedAt: null },
		orderBy: [{ occurredAt: "desc" }, { eventId: "desc" }],
		select: { occurredAt: true },
	});
	await tx.readingLogTotals.update({ where: { userId }, data: { lastReadAt: latest?.occurredAt ?? null } });
}

async function save(tx: Tx, userId: string, value: Normalized, strictTime = true) {
	const where = { userId_eventId: { userId, eventId: value.eventId } };
	const prior = await tx.readingLogEntry.findUnique({ where });
	if (prior && (prior.deletedAt || prior.correctedAt || prior.revision > value.revision))
		return { recorded: false, entry: publicReadingEntry(prior) };
	if (prior && prior.revision === value.revision) {
		const fields = [
			"sessionId",
			"source",
			"book",
			"chapter",
			"verseRanges",
			"translation",
			"precision",
			"timezone",
			"completed",
			"evidence",
			"activeSeconds",
		] as const;
		const differs =
			fields.some((field) =>
				field === "verseRanges"
					? JSON.stringify(
							(prior.verseRanges as { start: number; end: number }[]).map((range) => [
								range.start,
								range.end,
							]),
						) !== JSON.stringify(value.verseRanges.map((range) => [range.start, range.end]))
					: JSON.stringify(prior[field]) !== JSON.stringify(value[field]),
			) ||
			(strictTime &&
				(prior.occurredAt.getTime() !== value.occurredAt.getTime() || prior.localDate !== value.localDate));
		if (differs)
			throw new ReadingLogError(
				"This eventId and revision were already saved with different content. Use a higher revision or the correction action.",
				409,
			);
		return { recorded: false, entry: publicReadingEntry(prior) };
	}
	if (
		prior &&
		(prior.sessionId !== value.sessionId ||
			prior.book !== value.book ||
			prior.chapter !== value.chapter ||
			prior.source !== value.source)
	)
		throw new ReadingLogError("A retry cannot change a reading's identity; use the correction action.", 409);
	const collision = await tx.readingLogEntry.findUnique({
		where: {
			userId_sessionId_book_chapter: {
				userId,
				sessionId: value.sessionId,
				book: value.book,
				chapter: value.chapter,
			},
		},
	});
	if (collision && collision.eventId !== value.eventId)
		throw new ReadingLogError(
			"This session already has that chapter. Update its existing eventId and revision.",
			409,
		);
	const entry = await tx.readingLogEntry.upsert({ where, create: { userId, ...value }, update: value });
	if (prior) await applyDelta(tx, prior, -1);
	await applyDelta(tx, entry, 1);
	return { recorded: true, entry: publicReadingEntry(entry) };
}

async function recordReadingsImpl(userId: string, inputs: ReadingLogInput[]) {
	if (!Array.isArray(inputs) || !inputs.length || inputs.length > 150)
		throw new ReadingLogError("Record between 1 and 150 chapter entries per request.");
	const now = new Date();
	const values = await Promise.all(inputs.map((input) => normalize(input, now)));
	try {
		const payload = values.map((value, index) => ({
			...value,
			strictTime: Boolean(inputs[index].occurredAt || inputs[index].localDate),
		}));
		const [row] = await prisma.$queryRaw<
			{ result: { recorded: boolean; entry: ReadingLogEntry }[] }[]
		>`SELECT sureword_write_readings(${userId}, ${JSON.stringify(payload)}::jsonb) AS result`;
		return row.result.map((result) => {
			const entry = result.entry;
			// JSONB timestamps have no offset because Prisma stores UTC timestamp(3).
			const utc = (value: unknown) => new Date(String(value).replace(/(?<!Z)$/, "Z"));
			return {
				recorded: result.recorded,
				entry: publicReadingEntry({
					...entry,
					occurredAt: utc(entry.occurredAt),
					reportedAt: utc(entry.reportedAt),
					updatedAt: utc(entry.updatedAt),
					deletedAt: entry.deletedAt ? utc(entry.deletedAt) : null,
					correctedAt: entry.correctedAt ? utc(entry.correctedAt) : null,
				}),
			};
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const known = message.match(/READING_LOG_(400|404|409):([^\n]+)/);
		if (known) throw new ReadingLogError(known[2], Number(known[1]));
		throw error;
	}
}
async function measuredMutation<T>(
	operation: string,
	counts: { entries: number; reader: number; physical: number },
	action: () => Promise<T>,
): Promise<T> {
	const started = Date.now();
	try {
		const result = await action();
		console.info(
			"[reading.metrics]",
			JSON.stringify({
				operation,
				...counts,
				durationMs: Date.now() - started,
				outcome: "success",
				status: 200,
			}),
		);
		return result;
	} catch (error) {
		console.info(
			"[reading.metrics]",
			JSON.stringify({
				operation,
				...counts,
				durationMs: Date.now() - started,
				outcome: "error",
				status: error instanceof ReadingLogError ? error.status : 500,
			}),
		);
		throw error;
	}
}
export async function recordReadings(userId: string, inputs: ReadingLogInput[]) {
	const values = Array.isArray(inputs) ? inputs : [];
	return measuredMutation(
		"record",
		{
			entries: values.length,
			reader: values.filter((entry) => entry?.source === "reader").length,
			physical: values.filter((entry) => entry?.source === "physical").length,
		},
		() => recordReadingsImpl(userId, inputs),
	);
}
export async function correctReading(userId: string, eventId: string, patch: Partial<ReadingLogInput>) {
	return measuredMutation("correct", { entries: 1, reader: 0, physical: 0 }, () =>
		correctReadingImpl(userId, eventId, patch),
	);
}
export async function removeReading(userId: string, eventId: string, revision?: number) {
	return measuredMutation("remove", { entries: 1, reader: 0, physical: 0 }, () =>
		removeReadingImpl(userId, eventId, revision),
	);
}

export async function recordReading(userId: string, input: ReadingLogInput) {
	return (await recordReadings(userId, [input]))[0];
}

async function correctReadingImpl(userId: string, eventId: string, patch: Partial<ReadingLogInput>) {
	return prisma.$transaction(
		async (tx) => {
			await lockAccount(tx, userId);
			const where = { userId_eventId: { userId, eventId } };
			const prior = await tx.readingLogEntry.findUnique({ where });
			if (!prior || prior.deletedAt) throw new ReadingLogError("Reading entry not found.", 404);
			if (patch.revision !== undefined && patch.revision !== prior.revision)
				throw new ReadingLogError("This entry changed. Reload it before correcting it.", 409);
			const input = {
				...prior,
				occurredAt: prior.occurredAt.toISOString(),
				source: prior.source === "physical" ? "physical" : "reader",
				precision: prior.precision === "legacy" ? "exact" : prior.precision,
				verseRanges: prior.verseRanges,
				...patch,
				eventId,
				sessionId: prior.sessionId,
				revision: prior.revision + 1,
			} as ReadingLogInput;
			if (patch.verseStart !== undefined || patch.verseEnd !== undefined) delete input.verseRanges;
			if (patch.occurredAt && patch.localDate === undefined) delete input.localDate;
			if (
				(patch.book !== undefined && patch.book !== prior.book) ||
				(patch.chapter !== undefined && patch.chapter !== prior.chapter)
			) {
				if (!patch.verseRanges && patch.verseStart === undefined) delete input.verseRanges;
			}
			const value = await normalize(input, new Date());
			if (patch.source === undefined) value.source = prior.source;
			if (
				prior.precision === "legacy" &&
				patch.precision === undefined &&
				patch.occurredAt === undefined &&
				patch.localDate === undefined
			)
				value.precision = "legacy";
			const collision = await tx.readingLogEntry.findUnique({
				where: {
					userId_sessionId_book_chapter: {
						userId,
						sessionId: prior.sessionId,
						book: value.book,
						chapter: value.chapter,
					},
				},
			});
			if (collision && collision.eventId !== eventId)
				throw new ReadingLogError(
					"This session already contains that chapter. Correct its existing entry instead.",
					409,
				);
			const entry = await tx.readingLogEntry.update({ where, data: { ...value, correctedAt: new Date() } });
			await applyDelta(tx, prior, -1);
			await applyDelta(tx, entry, 1);
			await refreshLastRead(tx, userId);
			return { corrected: true, entry: publicReadingEntry(entry) };
		},
		{ timeout: 30_000 },
	);
}
async function removeReadingImpl(userId: string, eventId: string, revision?: number) {
	return prisma.$transaction(
		async (tx) => {
			await lockAccount(tx, userId);
			const where = { userId_eventId: { userId, eventId } };
			const prior = await tx.readingLogEntry.findUnique({ where });
			if (!prior) throw new ReadingLogError("Reading entry not found.", 404);
			if (prior.deletedAt) return { removed: false, eventId };
			if (revision !== undefined && prior.revision !== revision)
				throw new ReadingLogError("This entry changed. Reload it before removing it.", 409);
			await tx.readingLogEntry.update({ where, data: { deletedAt: new Date(), revision: { increment: 1 } } });
			await applyDelta(tx, prior, -1);
			await refreshLastRead(tx, userId);
			return { removed: true, eventId };
		},
		{ timeout: 30_000 },
	);
}

export async function searchReadingLog(userId: string, filters: ReadingLogFilters = {}) {
	const where: Prisma.ReadingLogEntryWhereInput = { userId, deletedAt: null };
	if (filters.book !== undefined) {
		if (!Number.isInteger(filters.book) || !bookByOrder(filters.book))
			throw new ReadingLogError("Invalid book filter.");
		where.book = filters.book;
	}
	if (filters.chapter !== undefined) {
		if (
			!filters.book ||
			!Number.isInteger(filters.chapter) ||
			filters.chapter < 1 ||
			filters.chapter > bookByOrder(filters.book)!.chapters
		)
			throw new ReadingLogError("A chapter filter requires a valid book and chapter.");
		where.chapter = filters.chapter;
	}
	if (filters.source) {
		if (!["reader", "physical", "legacy"].includes(filters.source))
			throw new ReadingLogError("Invalid source filter.");
		where.source = filters.source;
	}
	if (filters.from || filters.to) {
		if ([filters.from, filters.to].some((value) => value && !Number.isFinite(new Date(value).getTime())))
			throw new ReadingLogError("Invalid date filter.");
		where.occurredAt = {
			...(filters.from ? { gte: new Date(filters.from) } : {}),
			...(filters.to ? { lte: new Date(filters.to) } : {}),
		};
	}
	if (filters.fromDate || filters.toDate) {
		for (const day of [filters.fromDate, filters.toDate]) if (day) assertDate(day);
		where.localDate = {
			...(filters.fromDate ? { gte: filters.fromDate } : {}),
			...(filters.toDate ? { lte: filters.toDate } : {}),
		};
	}
	const calendarOrder = Boolean(filters.fromDate || filters.toDate);
	if (filters.cursor) {
		try {
			const cursor = JSON.parse(Buffer.from(filters.cursor, "base64url").toString()) as {
				at: string;
				id: string;
				day?: string;
			};
			if (calendarOrder !== Boolean(cursor.day)) throw new Error();
			if (cursor.day) assertDate(cursor.day);
			if (
				typeof cursor.id !== "string" ||
				cursor.id.length > 160 ||
				!Number.isFinite(new Date(cursor.at).getTime())
			)
				throw new Error();
			where.AND = calendarOrder
				? [
						{
							OR: [
								{ localDate: { lt: cursor.day! } },
								{ localDate: cursor.day, occurredAt: { lt: new Date(cursor.at) } },
								{ localDate: cursor.day, occurredAt: new Date(cursor.at), eventId: { lt: cursor.id } },
							],
						},
					]
				: [
						{
							OR: [
								{ occurredAt: { lt: new Date(cursor.at) } },
								{ occurredAt: new Date(cursor.at), eventId: { lt: cursor.id } },
							],
						},
					];
		} catch {
			throw new ReadingLogError("Invalid history cursor.");
		}
	}
	const limit = filters.limit ?? 50;
	if (!Number.isInteger(limit) || limit < 1 || limit > 100)
		throw new ReadingLogError("limit must be between 1 and 100.");
	let rows: ReadingLogEntry[];
	if (filters.verseStart !== undefined || filters.verseEnd !== undefined) {
		const start = filters.verseStart ?? filters.verseEnd!;
		const end = filters.verseEnd ?? start;
		if (
			!filters.book ||
			!filters.chapter ||
			!Number.isInteger(start) ||
			!Number.isInteger(end) ||
			start < 1 ||
			start > end ||
			end > (await getKjvChapter(filters.book, filters.chapter)).length
		)
			throw new ReadingLogError("Verse filters require a valid book, chapter, and range.");
		const conditions = [
			Prisma.sql`"userId" = ${userId}`,
			Prisma.sql`"deletedAt" IS NULL`,
			Prisma.sql`book = ${filters.book}`,
			Prisma.sql`chapter = ${filters.chapter}`,
		];
		if (filters.source) conditions.push(Prisma.sql`source = ${filters.source}`);
		if (filters.from) conditions.push(Prisma.sql`"occurredAt" >= ${new Date(filters.from)}`);
		if (filters.to) conditions.push(Prisma.sql`"occurredAt" <= ${new Date(filters.to)}`);
		if (filters.fromDate) conditions.push(Prisma.sql`"localDate" >= ${filters.fromDate}`);
		if (filters.toDate) conditions.push(Prisma.sql`"localDate" <= ${filters.toDate}`);
		if (filters.cursor) {
			const cursor = JSON.parse(Buffer.from(filters.cursor, "base64url").toString()) as {
				at: string;
				id: string;
				day?: string;
			};
			if (calendarOrder)
				conditions.push(
					Prisma.sql`("localDate", "occurredAt", "eventId") < (${cursor.day!}, ${new Date(cursor.at)}, ${cursor.id})`,
				);
			else conditions.push(Prisma.sql`("occurredAt", "eventId") < (${new Date(cursor.at)}, ${cursor.id})`);
		}
		conditions.push(
			Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements("verseRanges") AS r WHERE (r->>'start')::int <= ${end} AND (r->>'end')::int >= ${start})`,
		);
		const order = calendarOrder
			? Prisma.sql`"localDate" DESC, "occurredAt" DESC, "eventId" DESC`
			: Prisma.sql`"occurredAt" DESC, "eventId" DESC`;
		rows = await prisma.$queryRaw<ReadingLogEntry[]>(
			Prisma.sql`SELECT * FROM "ReadingLogEntry" WHERE ${Prisma.join(conditions, " AND ")} ORDER BY ${order} LIMIT ${limit + 1}`,
		);
	} else {
		rows = await prisma.readingLogEntry.findMany({
			where,
			orderBy: [
				...(calendarOrder ? [{ localDate: "desc" as const }] : []),
				{ occurredAt: "desc" },
				{ eventId: "desc" },
			],
			take: limit + 1,
		});
	}
	const entries = rows.slice(0, limit);
	const last = entries[entries.length - 1];
	return {
		entries: entries.map(publicReadingEntry),
		nextCursor:
			rows.length > limit && last
				? Buffer.from(
						JSON.stringify({
							at: last.occurredAt.toISOString(),
							id: last.eventId,
							...(calendarOrder ? { day: last.localDate } : {}),
						}),
					).toString("base64url")
				: null,
	};
}

export interface ReadingStatsFilters {
	book?: number;
	chapter?: number;
	verseStart?: number;
	verseEnd?: number;
	fromDate?: string;
	toDate?: string;
}
export async function getReadingLogStats(userId: string, filters: ReadingStatsFilters = {}) {
	if (filters.book !== undefined && (!Number.isInteger(filters.book) || !bookByOrder(filters.book)))
		throw new ReadingLogError("Invalid book filter.");
	if (
		filters.chapter !== undefined &&
		(!filters.book ||
			!Number.isInteger(filters.chapter) ||
			filters.chapter < 1 ||
			filters.chapter > bookByOrder(filters.book)!.chapters)
	)
		throw new ReadingLogError("A chapter filter requires a valid book and chapter.");
	if ((filters.verseStart !== undefined || filters.verseEnd !== undefined) && !filters.chapter)
		throw new ReadingLogError("Verse filters require a chapter.");
	const verseStart = filters.verseStart ?? filters.verseEnd ?? 1;
	const verseEnd = filters.verseEnd ?? filters.verseStart ?? 176;
	if (
		!Number.isInteger(verseStart) ||
		!Number.isInteger(verseEnd) ||
		verseStart < 1 ||
		verseEnd < verseStart ||
		verseEnd >
			(filters.book && filters.chapter ? (await getKjvChapter(filters.book, filters.chapter)).length : 176)
	) {
		// No explicit verse filter allows the canonical maximum across all chapters.
		if (filters.verseStart !== undefined || filters.verseEnd !== undefined)
			throw new ReadingLogError("Invalid verse range.");
	}
	const passage = {
		...(filters.book ? { book: filters.book } : {}),
		...(filters.chapter ? { chapter: filters.chapter } : {}),
	};
	let dateWindow: { gte: string; lte: string } | undefined;
	if (filters.fromDate || filters.toDate) {
		if (!filters.fromDate || !filters.toDate)
			throw new ReadingLogError("Supply both fromDate and toDate for a dated coverage summary.");
		assertDate(filters.fromDate);
		assertDate(filters.toDate);
		const days = (new Date(filters.toDate).getTime() - new Date(filters.fromDate).getTime()) / 86400_000;
		if (days < 0 || days > 365)
			throw new ReadingLogError(
				"A dated coverage summary supports up to 366 days; request each year separately.",
			);
		dateWindow = { gte: filters.fromDate, lte: filters.toDate };
	}
	const [totals, rows, latest] = await Promise.all([
		prisma.readingLogTotals.findUnique({ where: { userId } }),
		!Object.keys(filters).length
			? Promise.resolve([])
			: dateWindow
				? prisma.readingLogChapterDay.findMany({
						where: { userId, ...passage, localDate: dateWindow, entries: { gt: 0 } },
						take: 1189 * 366,
					})
				: prisma.readingLogChapter.findMany({
						where: { userId, ...passage, entries: { gt: 0 } },
						take: 1189,
					}),
		prisma.readingLogEntry.findFirst({
			where: { userId, deletedAt: null, ...passage, ...(dateWindow ? { localDate: dateWindow } : {}) },
			orderBy: [
				...(dateWindow ? [{ localDate: "desc" as const }] : []),
				{ occurredAt: "desc" },
				{ eventId: "desc" },
			],
			select: { occurredAt: true, localDate: true, precision: true },
		}),
	]);
	const chapters = new Map<
		string,
		{ book: number; chapter: number; chapterReadings: number; partialReadings: number; verseCounts: number[] }
	>();
	for (const row of rows) {
		const id = `${row.book}:${row.chapter}`;
		const result = chapters.get(id) ?? {
			book: row.book,
			chapter: row.chapter,
			chapterReadings: 0,
			partialReadings: 0,
			verseCounts: [],
		};
		result.chapterReadings += row.chapterReadings;
		result.partialReadings += row.partialReadings;
		for (let verse = 0; verse < row.verseCounts.length; verse++)
			result.verseCounts[verse] = (result.verseCounts[verse] ?? 0) + row.verseCounts[verse];
		chapters.set(id, result);
	}
	const coverage = [...chapters.values()]
		.sort((a, b) => a.book - b.book || a.chapter - b.chapter)
		.map((entry) => {
			const ranges: { start: number; end: number }[] = [];
			for (let verse = 1; verse <= entry.verseCounts.length; verse++) {
				if (entry.verseCounts[verse - 1] <= 0 || verse < verseStart || verse > verseEnd) continue;
				const last = ranges[ranges.length - 1];
				if (last && last.end === verse - 1) last.end = verse;
				else ranges.push({ start: verse, end: verse });
			}
			const counts = entry.verseCounts.slice(verseStart - 1, Math.min(verseEnd, entry.verseCounts.length));
			return {
				book: entry.book,
				bookName: bookByOrder(entry.book)!.name,
				chapter: entry.chapter,
				chapterReadings: entry.chapterReadings,
				partialReadings: entry.partialReadings,
				coveredVerses: ranges.reduce((sum, range) => sum + range.end - range.start + 1, 0),
				verseRanges: ranges,
				// Per-verse frequency, not an invented count of full passage sessions.
				...(filters.chapter
					? { verseReadings: counts.map((count, index) => ({ verse: verseStart + index, readings: count })) }
					: {}),
			};
		});
	const filtered = Boolean(filters.book || dateWindow || filters.verseStart || filters.verseEnd);
	return {
		sessions: filtered ? null : (totals?.sessions ?? 0),
		chapterReadings: filtered
			? coverage.reduce((sum, chapter) => sum + chapter.chapterReadings, 0)
			: (totals?.chapterReadings ?? 0),
		partialReadings: filtered
			? coverage.reduce((sum, chapter) => sum + chapter.partialReadings, 0)
			: (totals?.partialReadings ?? 0),
		uniqueChapters: filtered
			? coverage.filter((chapter) => chapter.chapterReadings > 0).length
			: (totals?.uniqueChapters ?? 0),
		activeDays: filtered ? null : (totals?.activeDays ?? 0),
		lastReadAt:
			latest && ["exact", "legacy"].includes(latest.precision) ? latest.occurredAt.toISOString() : null,
		lastReadDate: latest?.localDate ?? null,
		lastReadPrecision: latest?.precision ?? null,
		historicalBackfillPending: totals
			? !totals.legacyBackfilled
			: Boolean(await prisma.readingEvent.findFirst({ where: { userId }, select: { id: true } })),
		...(filters.book
			? { coverage }
			: dateWindow
				? {
						books: BOOKS.map((book) => {
							const read = coverage.filter(
								(chapter) => chapter.book === book.order && chapter.chapterReadings > 0,
							);
							const done = new Set(read.map((chapter) => chapter.chapter));
							return {
								book: book.order,
								bookName: book.name,
								chaptersRead: done.size,
								unreadChapters: Array.from({ length: book.chapters }, (_, i) => i + 1).filter(
									(chapter) => !done.has(chapter),
								),
							};
						}),
					}
				: {}),
	};
}

/** Bounded compatibility context for old app and AI consumers. */
export async function recentReadingChapters(userId: string, since: Date, limit = 100) {
	const take = Math.min(limit, 200);
	const [entries, totals] = await Promise.all([
		prisma.readingLogEntry.findMany({
			where: { userId, deletedAt: null, occurredAt: { gte: since } },
			orderBy: [{ occurredAt: "desc" }, { eventId: "desc" }],
			take,
		}),
		prisma.readingLogTotals.findUnique({ where: { userId }, select: { legacyBackfilled: true } }),
	]);
	const recent = entries.map((entry) => ({
		book: bookByOrder(entry.book)!.name,
		chapter: entry.chapter,
		readAt: entry.occurredAt,
		completed: entry.completed,
		verseRanges: entry.verseRanges,
		precision: entry.precision,
		localDate: entry.localDate,
	}));
	if (!totals?.legacyBackfilled) {
		const legacy = await prisma.readingEvent.findMany({
			where: { userId, readAt: { gte: since } },
			orderBy: { readAt: "desc" },
			take,
		});
		const migrated = await prisma.readingLogEntry.findMany({
			where: { userId, eventId: { in: legacy.map((event) => `legacy:${event.id}`) } },
			select: { eventId: true },
		});
		const known = new Set(migrated.map((entry) => entry.eventId));
		for (const event of legacy)
			if (!known.has(`legacy:${event.id}`))
				recent.push({
					book: event.book,
					chapter: event.chapter,
					readAt: event.readAt,
					completed: true,
					verseRanges: [],
					precision: "legacy",
					localDate: event.readAt.toISOString().slice(0, 10),
				});
	}
	return recent
		.sort((a, b) => b.readAt.getTime() - a.readAt.getTime())
		.slice(0, take)
		.map((entry) => ({
			...entry,
			reference: `${entry.book} ${entry.chapter}${entry.completed ? "" : ":" + (entry.verseRanges as { start: number; end: number }[]).map((range) => (range.start === range.end ? range.start : `${range.start}-${range.end}`)).join(",") + " (partial)"}`,
		}));
}

/** Retain the old endpoint for old clients. Its heuristic is explicitly legacy. */
export async function recordLegacyReading(
	userId: string,
	bookName: string,
	chapter: number,
	translation = "KJV",
) {
	const book = BOOKS.find((item) => item.name.toLowerCase() === bookName.toLowerCase());
	if (!book) throw new ReadingLogError("Unknown Bible book.");
	const now = new Date();
	const value = await normalize(
		{
			eventId: `legacy:${crypto.randomUUID()}`,
			sessionId: `legacy:${crypto.randomUUID()}`,
			source: "reader",
			book: book.order,
			chapter,
			translation,
			occurredAt: now.toISOString(),
			timezone: "UTC",
			completed: true,
			evidence: "legacy",
		},
		now,
	);
	value.source = "legacy";
	value.precision = "legacy";
	return prisma.$transaction(async (tx) => {
		await lockAccount(tx, userId);
		const recent = await tx.readingLogEntry.findFirst({
			where: {
				userId,
				book: book.order,
				chapter,
				deletedAt: null,
				source: "legacy",
				occurredAt: { gte: new Date(now.getTime() - 3600_000) },
			},
			select: { eventId: true },
		});
		if (recent) return { recorded: false };
		const result = await save(tx, userId, value);
		await refreshLastRead(tx, userId);
		return result;
	});
}

/** Resumable backfill: one bounded account batch and cursor commit together.
 * Original ReadingEvent rows remain untouched for rollback and audit. */
export async function backfillReadingHistoryBatch(userId: string, limit = 100) {
	if (!Number.isInteger(limit) || limit < 1 || limit > 150)
		throw new ReadingLogError("Backfill batch size must be between 1 and 150.");
	return prisma.$transaction(
		async (tx) => {
			await lockAccount(tx, userId);
			const totals = await tx.readingLogTotals.findUniqueOrThrow({ where: { userId } });
			if (totals.legacyBackfilled) return { migrated: 0, complete: true, cursor: totals.legacyCursor };
			const events = await tx.readingEvent.findMany({
				where: { userId, ...(totals.legacyCursor ? { id: { gt: totals.legacyCursor } } : {}) },
				orderBy: { id: "asc" },
				take: limit,
			});
			for (const event of events) {
				const book = BOOKS.find((item) => item.name.toLowerCase() === event.book.toLowerCase());
				// Stop with an actionable original ID instead of silently losing an
				// invalid legacy record or inventing a canonical mapping.
				if (!book)
					throw new ReadingLogError(
						`Legacy reading ${event.id} has an unknown book: ${event.book}. Resolve its mapping before resuming backfill.`,
					);
				const value = await normalize(
					{
						eventId: `legacy:${event.id}`,
						sessionId: `legacy:${event.id}`,
						source: "reader",
						book: book.order,
						chapter: event.chapter,
						translation: event.translation,
						occurredAt: event.readAt.toISOString(),
						timezone: "UTC",
						completed: true,
						evidence: "legacy",
					},
					new Date(),
				);
				value.source = "legacy";
				value.precision = "legacy";
				await save(tx, userId, value);
				await tx.readingLogEntry.update({
					where: { userId_eventId: { userId, eventId: value.eventId } },
					data: { reportedAt: event.readAt },
				});
			}
			const complete = events.length < limit;
			const cursor = events[events.length - 1]?.id ?? totals.legacyCursor;
			await tx.readingLogTotals.update({
				where: { userId },
				data: { legacyCursor: cursor, legacyBackfilled: complete },
			});
			await refreshLastRead(tx, userId);
			return { migrated: events.length, complete, cursor };
		},
		{ maxWait: 10_000, timeout: 60_000 },
	);
}
