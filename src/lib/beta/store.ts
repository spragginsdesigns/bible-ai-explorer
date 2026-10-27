import "server-only";

import { Prisma, type BetaItem, type BetaLink } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { searchQuery } from "@/lib/search-query";
import { BETA_MODULES } from "@/lib/beta/modules";
import {
	betaRefKey,
	checkBetaItemInput,
	checkBetaItemPatch,
	checkBetaLinkInput,
	normalizeBetaTopics,
	parseBetaRefKey,
	type BetaItemInput,
	type BetaItemPatch,
	type BetaLinkInput,
} from "@/lib/beta/store-rules";

/**
 * SureWord Beta's shared study store (docs/beta/README.md). Every beta module
 * reads and writes its objects through these functions, never through
 * `prisma.betaItem` directly, so each call is scoped to its owner: an id that
 * belongs to someone else behaves exactly like one that does not exist.
 *
 * Validation failures throw `BetaStoreError` (a module bug or bad input to
 * turn into a 400); a missing or foreign id returns null or false.
 */

export class BetaStoreError extends Error {}

const MODULE_SLUGS = [...new Set(BETA_MODULES.map((entry) => entry.slug))];
const LIST_MAX = 500;

function fail(error: string): never {
	throw new BetaStoreError(error);
}

export async function createBetaItem(userId: string, input: BetaItemInput): Promise<BetaItem> {
	const checked = checkBetaItemInput(input, MODULE_SLUGS);
	if (!checked.ok) fail(checked.error);
	const item = checked.value;
	if (item.parentId) {
		const parent = await prisma.betaItem.findFirst({ where: { id: item.parentId, userId }, select: { id: true } });
		if (!parent) fail("parent not found");
	}
	return prisma.betaItem.create({
		data: {
			userId,
			module: item.module,
			kind: item.kind,
			title: item.title,
			parentId: item.parentId,
			body: item.body,
			data: item.data as Prisma.InputJsonObject,
			refs: [...item.refs],
			topics: [...item.topics],
		},
	});
}

export function getBetaItem(userId: string, id: string): Promise<BetaItem | null> {
	return prisma.betaItem.findFirst({ where: { id, userId } });
}

export interface BetaItemQuery {
	module?: string;
	kind?: string;
	/** An id lists that item's children; null lists only top-level items. */
	parentId?: string | null;
	/** A passage key ("43.3" or "43.3.16"): items that touch it. */
	ref?: string;
	topic?: string;
	take?: number;
}

/** The owner's items, newest change first. */
export function listBetaItems(userId: string, query: BetaItemQuery = {}): Promise<BetaItem[]> {
	const parsed = query.ref === undefined ? undefined : parseBetaRefKey(query.ref.trim());
	if (parsed === null) fail("ref must be a passage key like 43.3 or 43.3.16");
	// Stored keys are canonical ("43.3", never "43.03"), so the lookup must be too.
	const ref = parsed && betaRefKey(parsed.book, parsed.chapter, parsed.verse);
	const take = Math.min(Math.max(Math.trunc(query.take ?? 100), 1), LIST_MAX);
	return prisma.betaItem.findMany({
		where: {
			userId,
			...(query.module !== undefined && { module: query.module }),
			...(query.kind !== undefined && { kind: query.kind }),
			...(query.parentId !== undefined && { parentId: query.parentId }),
			...(ref && { refs: { has: ref } }),
			...(query.topic !== undefined && { topics: { has: normalizeBetaTopics([query.topic])?.[0] ?? "" } }),
		},
		orderBy: { updatedAt: "desc" },
		take,
	});
}

/**
 * The updated item, or null when the owner has no item with that id.
 *
 * `ifUpdatedAt` makes the write conditional (LC-17650): it only lands if the
 * item still has the `updatedAt` its caller read, so two read-modify-write
 * requests cannot silently overwrite each other. The check and the write are
 * one statement. A lost race also returns null; the caller tells it from a
 * missing item by reading the item again.
 */
export async function updateBetaItem(
	userId: string,
	id: string,
	patch: BetaItemPatch,
	options: { ifUpdatedAt?: Date } = {},
): Promise<BetaItem | null> {
	const checked = checkBetaItemPatch(patch);
	if (!checked.ok) fail(checked.error);
	const change = checked.value;
	const result = await prisma.betaItem.updateMany({
		where: { id, userId, ...(options.ifUpdatedAt && { updatedAt: options.ifUpdatedAt }) },
		data: {
			...(change.title !== undefined && { title: change.title }),
			...(change.body !== undefined && { body: change.body }),
			...(change.data !== undefined && { data: change.data as Prisma.InputJsonObject }),
			...(change.refs !== undefined && { refs: [...change.refs] }),
			...(change.topics !== undefined && { topics: [...change.topics] }),
		},
	});
	return result.count ? getBetaItem(userId, id) : null;
}

/** Deletes the item, its children and every link touching them. */
export async function deleteBetaItem(userId: string, id: string): Promise<boolean> {
	const result = await prisma.betaItem.deleteMany({ where: { id, userId } });
	return result.count > 0;
}

/** Creates the link, or updates its reason and origin if it already exists. */
export async function linkBetaItems(userId: string, input: BetaLinkInput): Promise<BetaLink | null> {
	const checked = checkBetaLinkInput(input);
	if (!checked.ok) fail(checked.error);
	const link = checked.value;
	const owned = await prisma.betaItem.count({ where: { userId, id: { in: [link.fromId, link.toId] } } });
	if (owned !== 2) return null;
	return prisma.betaLink.upsert({
		where: { fromId_toId_kind: { fromId: link.fromId, toId: link.toId, kind: link.kind } },
		create: { userId, fromId: link.fromId, toId: link.toId, kind: link.kind, reason: link.reason, origin: link.origin },
		update: { reason: link.reason, origin: link.origin },
	});
}

/** Every link to or from one of the owner's items. */
export function listBetaLinks(userId: string, itemId: string): Promise<BetaLink[]> {
	return prisma.betaLink.findMany({
		where: { userId, OR: [{ fromId: itemId }, { toId: itemId }] },
		orderBy: { createdAt: "desc" },
		take: LIST_MAX,
	});
}

export async function unlinkBetaItems(userId: string, linkId: string): Promise<boolean> {
	const result = await prisma.betaLink.deleteMany({ where: { id: linkId, userId } });
	return result.count > 0;
}

/**
 * When the owner's items were made and last changed since `since`, newest
 * change first: timestamps only, never titles, bodies or data. Habits &
 * Reflection counts a "study" day from these (docs/beta/growth.md).
 */
export function listBetaActivity(
	userId: string,
	query: { since: Date; excludeModule?: string },
): Promise<{ module: string; kind: string; createdAt: Date; updatedAt: Date }[]> {
	return prisma.betaItem.findMany({
		where: {
			userId,
			// updatedAt is never before createdAt, so this also covers everything made since.
			updatedAt: { gte: query.since },
			...(query.excludeModule !== undefined && { module: { not: query.excludeModule } }),
		},
		select: { module: true, kind: true, createdAt: true, updatedAt: true },
		orderBy: { updatedAt: "desc" },
		take: LIST_MAX * 4,
	});
}

// ---------------------------------------------------------------------------
// Reads for the Knowledge Vault (LC-17645, docs/beta/vault.md), which searches
// every module's items: words, dates and passages beyond what listBetaItems
// filters on. Owner-scoped like everything above.
// ---------------------------------------------------------------------------

export interface BetaItemSearch {
	ids?: readonly string[];
	since?: Date | null;
	until?: Date | null;
	/** Postgres full-text: a websearch query, or a prepared `to_tsquery` OR expression. */
	words?: { kind: "web" | "or"; value: string } | null;
	/** A topic label, matched as a label or as a phrase in the words. */
	topic?: string | null;
	/** "45" (any chapter of the book) or "45.8": items whose refs touch it. */
	refPrefix?: string | null;
	take?: number;
}

export type BetaItemHit = Pick<BetaItem, "id" | "module" | "kind" | "title" | "body" | "refs" | "topics" | "createdAt" | "updatedAt"> & { rank: number };

/** The owner's items matching words, a topic, a passage and a date range; best match first, else newest. */
export async function searchBetaItems(userId: string, query: BetaItemSearch = {}): Promise<BetaItemHit[]> {
	const take = Math.min(Math.max(Math.trunc(query.take ?? 50), 1), LIST_MAX);
	const vector = Prisma.sql`to_tsvector('english', i."title" || ' ' || coalesce(i."body", '') || ' ' || array_to_string(i."topics", ' '))`;
	const tsquery = query.words
		? query.words.kind === "web"
			? Prisma.sql`websearch_to_tsquery('english', ${query.words.value})`
			: Prisma.sql`to_tsquery('english', ${query.words.value})`
		: null;
	const topic = query.topic ? normalizeBetaTopics([query.topic])?.[0] ?? null : null;
	const prefix = query.refPrefix?.trim() || null;
	const conditions: Prisma.Sql[] = [Prisma.sql`i."userId" = ${userId}`];
	if (query.ids) conditions.push(Prisma.sql`i."id" = ANY(${[...query.ids]}::text[])`);
	if (query.since) conditions.push(Prisma.sql`i."updatedAt" >= ${query.since}`);
	if (query.until) conditions.push(Prisma.sql`i."updatedAt" <= ${query.until}`);
	if (tsquery) conditions.push(Prisma.sql`${vector} @@ ${tsquery}`);
	if (topic) conditions.push(Prisma.sql`(${topic} = ANY(i."topics") OR ${vector} @@ phraseto_tsquery('english', ${topic}))`);
	if (prefix) {
		conditions.push(
			prefix.includes(".")
				? Prisma.sql`${prefix} = ANY(i."refs")`
				: Prisma.sql`EXISTS (SELECT 1 FROM unnest(i."refs") r WHERE r LIKE ${`${prefix}.%`})`,
		);
	}
	const rank = tsquery ? Prisma.sql`ts_rank_cd(${vector}, ${tsquery})` : Prisma.sql`0`;
	const rows = await searchQuery<BetaItemHit>(Prisma.sql`
		SELECT i."id", i."module", i."kind", i."title", left(i."body", 20000) AS "body", i."refs", i."topics", i."createdAt", i."updatedAt", (${rank})::float8 AS "rank"
		FROM "BetaItem" i
		WHERE ${Prisma.join(conditions, " AND ")}
		ORDER BY "rank" DESC, i."updatedAt" DESC
		LIMIT ${take}
	`);
	return rows.map((row) => ({ ...row, rank: Number(row.rank) || 0 }));
}

/** Every item's id and last change, for the Vault's meaning-search index to see what moved. */
export function betaItemVersions(userId: string): Promise<{ id: string; updatedAt: Date }[]> {
	return prisma.betaItem.findMany({ where: { userId }, select: { id: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 5000 });
}

// ---------------------------------------------------------------------------
// Reads for the Living Study Graph (LC-17646, docs/beta/graph.md), which draws
// every module's items and every link between them. Owner-scoped like
// everything above. `private` reports an item whose `data` is private, so the
// graph can keep it to its title, passages and dates; the data never leaves.
// ---------------------------------------------------------------------------

export interface BetaGraphItem {
	id: string;
	module: string;
	kind: string;
	title: string;
	parentId: string | null;
	refs: string[];
	topics: string[];
	private: boolean;
	createdAt: Date;
	updatedAt: Date;
}

/** The owner's items as graph nodes, newest change first: never `body` or `data`. */
export async function betaGraphItems(userId: string, take = LIST_MAX): Promise<BetaGraphItem[]> {
	const limit = Math.min(Math.max(Math.trunc(take), 1), LIST_MAX);
	const rows = await prisma.$queryRaw<BetaGraphItem[]>(Prisma.sql`
		SELECT i."id", i."module", i."kind", i."title", i."parentId", i."refs", i."topics",
			coalesce(i."data"->>'private', '') = 'true' AS "private", i."createdAt", i."updatedAt"
		FROM "BetaItem" i WHERE i."userId" = ${userId}
		ORDER BY i."updatedAt" DESC LIMIT ${limit}
	`);
	return rows.map((row) => ({ ...row, private: row.private === true }));
}

/** Every one of the owner's links, newest first. */
export function listOwnerBetaLinks(userId: string): Promise<BetaLink[]> {
	return prisma.betaLink.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: LIST_MAX * 4 });
}

/** One of the owner's links, or null when it is missing or someone else's. */
export function getBetaLink(userId: string, id: string): Promise<BetaLink | null> {
	return prisma.betaLink.findFirst({ where: { id, userId } });
}

/**
 * Which of these items are private (`data.private: true`, docs/beta/README.md),
 * so a reader that hands study to an AI can drop them whole. Owner-scoped;
 * reads only the flag, never the data.
 */
export async function privateBetaItemIds(userId: string, ids: readonly string[]): Promise<Set<string>> {
	if (ids.length === 0) return new Set();
	const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
		SELECT i."id" FROM "BetaItem" i
		WHERE i."userId" = ${userId} AND i."id" = ANY(${[...ids]}::text[]) AND coalesce(i."data"->>'private', '') = 'true'
	`);
	return new Set(rows.map((row) => row.id));
}
