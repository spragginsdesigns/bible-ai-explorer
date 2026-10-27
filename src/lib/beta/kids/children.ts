import "server-only";

import { createBetaItem, deleteBetaItem, getBetaItem, listBetaItems, updateBetaItem } from "@/lib/beta/store";
import { KIDS_ADVENTURE_IDS } from "@/lib/beta/kids/adventures";
import {
	CHILD_ITEM_TITLE,
	KIDS_CHILD_KIND,
	KIDS_MAX_CHILDREN,
	KIDS_MODULE,
	awardChild,
	checkChildName,
	childData,
	isAgeBand,
	parseKidsChild,
	type KidsAward,
	type KidsChild,
} from "@/lib/beta/kids/kids-rules";

/**
 * SureWord Kids' child profiles (docs/beta/kids.md), on the shared study store
 * and scoped to the parent like every store call: a child id that belongs to
 * someone else reads exactly like one that does not exist.
 *
 * A profile is the whole of what SureWord keeps about a child, progress
 * included, so deleting it deletes everything, and account deletion removes it
 * with the parent's other BetaItems. Nothing here is ever sent to a model.
 */

export type KidsInputResult = { ok: true; child: KidsChild } | { ok: false; error: string; status: 400 | 404 | 409 };

function toChild(item: { id: string; module: string; kind: string; data: unknown }): KidsChild | null {
	return parseKidsChild(item, KIDS_ADVENTURE_IDS);
}

export async function listChildren(parentId: string): Promise<KidsChild[]> {
	const items = await listBetaItems(parentId, { module: KIDS_MODULE, kind: KIDS_CHILD_KIND, take: KIDS_MAX_CHILDREN * 2 });
	// Oldest first, so profiles keep the order a parent added them in.
	return items
		.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
		.map(toChild)
		.filter((child): child is KidsChild => child !== null);
}

export async function getChild(parentId: string, childId: string): Promise<KidsChild | null> {
	const item = await getBetaItem(parentId, childId);
	return item ? toChild(item) : null;
}

export async function createChild(parentId: string, input: { name?: unknown; ageBand?: unknown }): Promise<KidsInputResult> {
	const name = checkChildName(input.name);
	if (!name.ok) return { ok: false, error: name.error, status: 400 };
	if (!isAgeBand(input.ageBand)) return { ok: false, error: "Choose an age band.", status: 400 };
	const existing = await listChildren(parentId);
	if (existing.length >= KIDS_MAX_CHILDREN) {
		return { ok: false, error: `Kids keeps up to ${KIDS_MAX_CHILDREN} profiles.`, status: 409 };
	}
	const item = await createBetaItem(parentId, {
		module: KIDS_MODULE,
		kind: KIDS_CHILD_KIND,
		title: CHILD_ITEM_TITLE,
		data: { ...childData({ name: name.value, ageBand: input.ageBand, stars: [], verses: [] }) },
	});
	const child = toChild(item);
	return child ? { ok: true, child } : { ok: false, error: "Could not save the profile.", status: 400 };
}

async function save(parentId: string, child: KidsChild): Promise<KidsChild | null> {
	const item = await updateBetaItem(parentId, child.id, { data: { ...childData(child) } });
	return item ? toChild(item) : null;
}

/** Rename a child or move them to another age band; their stars stay. */
export async function updateChild(
	parentId: string,
	childId: string,
	patch: { name?: unknown; ageBand?: unknown },
): Promise<KidsInputResult> {
	const child = await getChild(parentId, childId);
	if (!child) return { ok: false, error: "Not found", status: 404 };
	let next = child;
	if (patch.name !== undefined) {
		const name = checkChildName(patch.name);
		if (!name.ok) return { ok: false, error: name.error, status: 400 };
		next = { ...next, name: name.value };
	}
	if (patch.ageBand !== undefined) {
		if (!isAgeBand(patch.ageBand)) return { ok: false, error: "Choose an age band.", status: 400 };
		next = { ...next, ageBand: patch.ageBand };
	}
	if (next === child) return { ok: false, error: "Nothing to change.", status: 400 };
	const saved = await save(parentId, next);
	return saved ? { ok: true, child: saved } : { ok: false, error: "Not found", status: 404 };
}

/** Deletes the profile and, with it, every star and verse it holds. */
export async function deleteChild(parentId: string, childId: string): Promise<boolean> {
	if (!(await getChild(parentId, childId))) return false;
	return deleteBetaItem(parentId, childId);
}

/** A star for a finished adventure, or a learned verse; repeating one changes nothing. */
export async function awardToChild(parentId: string, childId: string, adventureId: string, award: KidsAward): Promise<KidsChild | null> {
	const child = await getChild(parentId, childId);
	if (!child) return null;
	const next = awardChild(child, adventureId, award, KIDS_ADVENTURE_IDS);
	return next === child ? child : save(parentId, next);
}
