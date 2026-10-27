import "server-only";

import type { BetaItem } from "@prisma/client";
import { createBetaItem, deleteBetaItem, getBetaItem, listBetaItems, updateBetaItem } from "@/lib/beta/store";
import { checkConceptMap, mapOutlineText, type ConceptMap, type MapOrigin } from "./map-rules";
import { MAP_BOOKS, mapRefKeys } from "./passages";

/**
 * Saved Concept Maps (LC-17654) are `BetaItem`s in the shared study store:
 * module "maps", kind "map", the map itself in `data.map`, its outline in
 * `body` and its passages in `refs`, so the Knowledge Vault can search them
 * and the Living Study Graph can connect them by passage and topic.
 */

export const MAPS_MODULE = "maps";
export const MAP_ITEM_KIND = "map";

export interface SavedMapSummary {
	id: string;
	title: string;
	summary: string;
	nodes: number;
	questions: number;
	origin: MapOrigin;
	topics: string[];
	updatedAt: string;
}

export interface SavedMap {
	id: string;
	map: ConceptMap;
	updatedAt: string;
}

/** The map an item holds, or null when the item is not a readable map. */
function mapOf(item: BetaItem): ConceptMap | null {
	if (item.module !== MAPS_MODULE || item.kind !== MAP_ITEM_KIND) return null;
	const data = item.data as { map?: unknown } | null;
	const checked = checkConceptMap(data?.map, { books: MAP_BOOKS });
	return checked.ok ? checked.value : null;
}

async function itemFields(map: ConceptMap) {
	return {
		title: map.title,
		body: mapOutlineText(map),
		data: { version: 1, map } as unknown as Record<string, unknown>,
		refs: await mapRefKeys(map),
		topics: map.topics,
	};
}

export async function listSavedMaps(userId: string): Promise<SavedMapSummary[]> {
	const items = await listBetaItems(userId, { module: MAPS_MODULE, kind: MAP_ITEM_KIND, take: 200 });
	return items.flatMap((item) => {
		const map = mapOf(item);
		if (!map) return [];
		return [{
			id: item.id,
			title: map.title,
			summary: map.summary,
			nodes: map.nodes.length,
			questions: map.nodes.filter((node) => node.kind === "question").length,
			origin: map.origin,
			topics: map.topics,
			updatedAt: item.updatedAt.toISOString(),
		}];
	});
}

export async function getSavedMap(userId: string, id: string): Promise<SavedMap | null> {
	const item = await getBetaItem(userId, id);
	const map = item && mapOf(item);
	return item && map ? { id: item.id, map, updatedAt: item.updatedAt.toISOString() } : null;
}

/** Saves a map already checked against the KJV (`checkMapAgainstKjv`). */
export async function createSavedMap(userId: string, map: ConceptMap): Promise<SavedMap> {
	const item = await createBetaItem(userId, { module: MAPS_MODULE, kind: MAP_ITEM_KIND, ...(await itemFields(map)) });
	return { id: item.id, map, updatedAt: item.updatedAt.toISOString() };
}

/**
 * True when the owner has a map item with that id. Writes check ownership and
 * kind only, never `checkConceptMap`, so a map saved under older rules can
 * still be replaced or deleted after the rules tighten.
 */
async function ownsMapItem(userId: string, id: string): Promise<boolean> {
	const item = await getBetaItem(userId, id);
	return item?.module === MAPS_MODULE && item.kind === MAP_ITEM_KIND;
}

/** Null when the owner has no saved map with that id (another module's item included). */
export async function updateSavedMap(userId: string, id: string, map: ConceptMap): Promise<SavedMap | null> {
	if (!(await ownsMapItem(userId, id))) return null;
	const item = await updateBetaItem(userId, id, await itemFields(map));
	return item ? { id: item.id, map, updatedAt: item.updatedAt.toISOString() } : null;
}

export async function deleteSavedMap(userId: string, id: string): Promise<boolean> {
	if (!(await ownsMapItem(userId, id))) return false;
	return deleteBetaItem(userId, id);
}
