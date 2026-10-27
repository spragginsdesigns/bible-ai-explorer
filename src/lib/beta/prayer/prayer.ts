import "server-only";

import { randomUUID } from "node:crypto";
import type { BetaItem, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { asPrayerStatus, prayerStatusUpdate, type PrayerStatus } from "@/lib/memory";
import { localDayKey, resolveReadingTimezone } from "@/lib/reading-history";
import { bookByOrder, resolveReference } from "@/lib/bible/books";
import { createBetaItem, deleteBetaItem, listBetaItems, updateBetaItem } from "@/lib/beta/store";
import { betaRefKey } from "@/lib/beta/store-rules";
import {
	PRAYER_ENTRY_KIND,
	PRAYER_ENTRY_TITLE,
	PRAYER_MODULE,
	PRAYER_PASSAGES_MAX,
	PRAYER_UPDATES_MAX,
	buildTimeline,
	checkOutcome,
	checkRemindOn,
	checkUpdateText,
	isReminderDue,
	readPrayerEntry,
	type PrayerEntryData,
	type PrayerOutcome,
	type PrayerResult,
	type PrayerUpdate,
	type TimelineMonth,
} from "@/lib/beta/prayer/prayer-rules";

/**
 * Prayer & Testimony (LC-17723, docs/beta/prayer.md). The prayer request is
 * the founder's own prayer list row (`UserMemory`, category `prayer`), never
 * a second store; this module keeps what grows around it in one private
 * `BetaItem` per request: dated updates, linked passages, a reminder, and the
 * outcome the founder confirmed in their own words.
 *
 * Private by default: the words live only in the item's `data` (marked
 * `private: true`) under a fixed title, so the Knowledge Vault and the Living
 * Study Graph see only that a prayer touches a passage, never what it says.
 * Nothing here calls an AI. Sharing into a group is the Groups prayer circle's
 * own copy-on-purpose path, run from the page.
 */

export class PrayerInputError extends Error {}

const ENTRIES_TAKE = 500;

function unwrap<T>(result: PrayerResult<T>): T {
	if (!result.ok) throw new PrayerInputError(result.error);
	return result.value;
}

export function prayerTimezone(requested: string | null): string {
	return resolveReadingTimezone(requested);
}

interface PrayerRow {
	id: string;
	content: string;
	status: string | null;
	askedAt: Date | null;
	createdAt: Date;
}

const PRAYER_ROW_SELECT = { id: true, content: true, status: true, askedAt: true, createdAt: true } as const;

function loadRequest(userId: string, memoryId: string): Promise<PrayerRow | null> {
	return prisma.userMemory.findFirst({ where: { id: memoryId, userId, category: "prayer" }, select: PRAYER_ROW_SELECT });
}

async function loadEntries(userId: string): Promise<{ item: BetaItem; data: PrayerEntryData }[]> {
	const items = await listBetaItems(userId, { module: PRAYER_MODULE, kind: PRAYER_ENTRY_KIND, take: ENTRIES_TAKE });
	const seen = new Set<string>();
	// Newest change first, so a duplicate from a lost creation race loses to the live one.
	return items.flatMap((item) => {
		const data = readPrayerEntry(item.data);
		if (!data || seen.has(data.memoryId)) return [];
		seen.add(data.memoryId);
		return [{ item, data }];
	});
}

async function findEntry(userId: string, memoryId: string): Promise<{ item: BetaItem; data: PrayerEntryData } | null> {
	return (await loadEntries(userId)).find((entry) => entry.data.memoryId === memoryId) ?? null;
}

function freshEntry(row: PrayerRow): PrayerEntryData {
	return {
		private: true,
		memoryId: row.id,
		request: row.content,
		askedAt: (row.askedAt ?? row.createdAt).toISOString(),
		updates: [],
		passages: [],
		remindOn: null,
		outcome: null,
	};
}

/** "phil 4:6" -> "Philippians 4:6" and its passage key. */
function resolvePassage(input: string): { label: string; ref: string } {
	const text = input.trim();
	const reference = resolveReference(text);
	const book = reference ? bookByOrder(reference.order) : null;
	if (!reference || !book) throw new PrayerInputError(`"${text.slice(0, 40)}" is not a passage SureWord knows. Try one like Philippians 4:6.`);
	const label = reference.verse === undefined ? `${book.name} ${reference.chapter}` : `${book.name} ${reference.chapter}:${reference.verse}`;
	return { label, ref: betaRefKey(reference.order, reference.chapter, reference.verse) };
}

/** The reader at a linked passage; null for a label SureWord no longer resolves. */
function passageLinks(passages: readonly string[]): { label: string; href: string }[] {
	return passages.flatMap((label) => {
		const reference = resolveReference(label);
		if (!reference) return [];
		return [{ label, href: `/bible/chapter?book=${reference.order}&chapter=${reference.chapter}&verse=${reference.verse ?? 1}&translation=KJV` }];
	});
}

function refsFor(passages: readonly string[]): string[] {
	return passages.map((label) => resolvePassage(label).ref);
}

/**
 * Read-modify-write on one request's entry, created on first use. The write is
 * conditional on the version it read (the store's `ifUpdatedAt`), so two tabs
 * cannot overwrite each other; a lost race is retried once on fresh data.
 * Null when the founder has no such prayer request.
 */
async function changeEntry(userId: string, memoryId: string, change: (data: PrayerEntryData, row: PrayerRow) => PrayerEntryData): Promise<PrayerEntryData | null> {
	const row = await loadRequest(userId, memoryId);
	if (!row) return null;
	for (let attempt = 0; attempt < 2; attempt++) {
		const existing = await findEntry(userId, memoryId);
		// The request's own words may have been edited on the prayer list; the copy follows them.
		const next = change({ ...(existing?.data ?? freshEntry(row)), request: row.content }, row);
		const data = { ...next } as unknown as Prisma.InputJsonObject;
		if (!existing) {
			await createBetaItem(userId, { module: PRAYER_MODULE, kind: PRAYER_ENTRY_KIND, title: PRAYER_ENTRY_TITLE, data, refs: refsFor(next.passages) });
			return next;
		}
		const saved = await updateBetaItem(userId, existing.item.id, { data, refs: refsFor(next.passages) }, { ifUpdatedAt: existing.item.updatedAt });
		if (saved) return next;
	}
	throw new PrayerInputError("This prayer changed somewhere else. Reload and try again.");
}

// ----- What the page reads -----

export interface PrayerRequestView {
	/** The prayer list row's id; the request's identity everywhere. */
	id: string;
	request: string;
	/** open, answered or closed; null for an entry whose request left the prayer list. */
	status: PrayerStatus | null;
	askedAt: string;
	/** False when the request was removed from the prayer list but its testimony is kept. */
	onList: boolean;
	updates: PrayerUpdate[];
	passages: string[];
	/** The reader at each linked passage. */
	passageLinks: { label: string; href: string }[];
	remindOn: string | null;
	due: boolean;
	outcome: PrayerOutcome | null;
}

export interface PrayerOverview {
	today: string;
	requests: PrayerRequestView[];
	timeline: TimelineMonth[];
}

export async function prayerOverview(userId: string, options: { timezone: string; now?: Date }): Promise<PrayerOverview> {
	const today = localDayKey(options.now ?? new Date(), options.timezone);
	const [rows, entries] = await Promise.all([
		prisma.userMemory.findMany({ where: { userId, category: "prayer" }, select: PRAYER_ROW_SELECT, orderBy: { createdAt: "asc" }, take: 200 }),
		loadEntries(userId),
	]);
	const byMemory = new Map(entries.map((entry) => [entry.data.memoryId, entry.data]));
	const listed = rows.map((row): PrayerRequestView => {
		const data = byMemory.get(row.id) ?? freshEntry(row);
		const status = asPrayerStatus(row.status) ?? "open";
		return {
			id: row.id,
			request: row.content,
			status,
			askedAt: data.askedAt,
			onList: true,
			updates: data.updates,
			passages: data.passages,
			passageLinks: passageLinks(data.passages),
			remindOn: data.remindOn,
			due: isReminderDue(data.remindOn, today, status === "open"),
			outcome: data.outcome,
		};
	});
	const listedIds = new Set(rows.map((row) => row.id));
	const kept = entries
		.filter((entry) => !listedIds.has(entry.data.memoryId))
		.map(({ data }): PrayerRequestView => ({
			id: data.memoryId,
			request: data.request,
			status: null,
			askedAt: data.askedAt,
			onList: false,
			updates: data.updates,
			passages: data.passages,
			passageLinks: passageLinks(data.passages),
			remindOn: null,
			due: false,
			outcome: data.outcome,
		}));
	const requests = [...listed, ...kept];
	return {
		today,
		requests,
		timeline: buildTimeline(
			requests.map((request) => ({ memoryId: request.id, request: request.request, askedAt: request.askedAt, updates: request.updates, passages: request.passages, outcome: request.outcome })),
			options.timezone,
		),
	};
}

// ----- What the founder writes -----

/** A dated update. Writing one is revisiting the prayer, so a reminder that has come due is done. */
export async function addPrayerUpdate(userId: string, memoryId: string, input: { text?: unknown }, timezone: string, now = new Date()): Promise<PrayerEntryData | null> {
	const text = unwrap(checkUpdateText(input.text));
	const today = localDayKey(now, timezone);
	return changeEntry(userId, memoryId, (data) => {
		if (data.updates.length >= PRAYER_UPDATES_MAX) throw new PrayerInputError(`A prayer keeps up to ${PRAYER_UPDATES_MAX} updates.`);
		return {
			...data,
			updates: [...data.updates, { id: randomUUID(), at: now.toISOString(), text }],
			remindOn: data.remindOn !== null && data.remindOn <= today ? null : data.remindOn,
		};
	});
}

/** False, with nothing written, when the request or that update does not exist. */
export async function deletePrayerUpdate(userId: string, memoryId: string, updateId: string): Promise<boolean> {
	const existing = await findEntry(userId, memoryId);
	if (!existing?.data.updates.some((update) => update.id === updateId)) return false;
	const saved = await changeEntry(userId, memoryId, (data) => ({ ...data, updates: data.updates.filter((update) => update.id !== updateId) }));
	return Boolean(saved);
}

/** Linked passages and the reminder day; either may be sent alone. */
export async function setPrayerDetails(
	userId: string,
	memoryId: string,
	input: { passages?: unknown; remindOn?: unknown },
	timezone: string,
	now = new Date(),
): Promise<PrayerEntryData | null> {
	if (input.passages === undefined && input.remindOn === undefined) throw new PrayerInputError("Nothing to change.");
	let passages: string[] | undefined;
	if (input.passages !== undefined) {
		if (!Array.isArray(input.passages) || input.passages.some((value) => typeof value !== "string")) throw new PrayerInputError("Passages are a list, like [\"Philippians 4:6\"].");
		const labels = [...new Set((input.passages as string[]).filter((value) => value.trim()).map((value) => resolvePassage(value).label))];
		if (labels.length > PRAYER_PASSAGES_MAX) throw new PrayerInputError(`Link up to ${PRAYER_PASSAGES_MAX} passages.`);
		passages = labels;
	}
	const remindOn = input.remindOn === undefined ? undefined : unwrap(checkRemindOn(input.remindOn, localDayKey(now, timezone)));
	return changeEntry(userId, memoryId, (data) => ({
		...data,
		...(passages !== undefined && { passages }),
		...(remindOn !== undefined && { remindOn }),
	}));
}

/**
 * The outcome, only when the founder confirms it, in their own words. The
 * prayer list row moves to answered or closed the same way its own buttons do,
 * so chat stops following it up.
 */
export async function recordPrayerOutcome(userId: string, memoryId: string, input: Record<string, unknown>, now = new Date()): Promise<PrayerEntryData | null> {
	const outcome = unwrap(checkOutcome(input));
	const row = await loadRequest(userId, memoryId);
	if (!row) return null;
	await prisma.userMemory.updateMany({
		where: { id: memoryId, userId, category: "prayer" },
		data: { ...prayerStatusUpdate(outcome.kind, now), ...(row.askedAt ? {} : { askedAt: row.createdAt }) },
	});
	return changeEntry(userId, memoryId, (data) => ({ ...data, remindOn: null, outcome: { ...outcome, at: now.toISOString() } }));
}

/**
 * Pray on: the request opens again. A recorded outcome is never thrown away;
 * its words become a dated update, so the testimony keeps them.
 */
export async function reopenPrayer(userId: string, memoryId: string, now = new Date()): Promise<PrayerEntryData | null> {
	const row = await loadRequest(userId, memoryId);
	if (!row) return null;
	await prisma.userMemory.updateMany({ where: { id: memoryId, userId, category: "prayer" }, data: prayerStatusUpdate("open", now) });
	return changeEntry(userId, memoryId, (data) => {
		if (!data.outcome) return data;
		const earlier = data.outcome.kind === "answered" ? "Earlier I recorded this as answered" : "Earlier I laid this down";
		const note = [`${earlier}: ${data.outcome.words}`, data.outcome.reflection].filter(Boolean).join("\n\n");
		return { ...data, outcome: null, updates: [...data.updates, { id: randomUUID(), at: now.toISOString(), text: note.slice(0, 4_000) }] };
	});
}

/** Removes a request's testimony (updates, passages, reminder, outcome). The prayer list row is untouched. */
export async function deletePrayerEntry(userId: string, memoryId: string): Promise<boolean> {
	const items = await listBetaItems(userId, { module: PRAYER_MODULE, kind: PRAYER_ENTRY_KIND, take: ENTRIES_TAKE });
	const mine = items.filter((item) => readPrayerEntry(item.data)?.memoryId === memoryId);
	for (const item of mine) await deleteBetaItem(userId, item.id);
	return mine.length > 0;
}
