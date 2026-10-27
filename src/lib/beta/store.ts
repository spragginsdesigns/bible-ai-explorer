import "server-only";

import type { BetaItem, BetaLink, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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

/** The updated item, or null when the owner has no item with that id. */
export async function updateBetaItem(userId: string, id: string, patch: BetaItemPatch): Promise<BetaItem | null> {
	const checked = checkBetaItemPatch(patch);
	if (!checked.ok) fail(checked.error);
	const change = checked.value;
	const result = await prisma.betaItem.updateMany({
		where: { id, userId },
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
