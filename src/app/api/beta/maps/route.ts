import { requireBetaApi } from "@/lib/beta/access";
import { BetaStoreError } from "@/lib/beta/store";
import { mapsJson, readJsonObject } from "@/lib/beta/maps/http";
import { checkMapAgainstKjv } from "@/lib/beta/maps/passages";
import { createSavedMap, listSavedMaps } from "@/lib/beta/maps/store";

/**
 * Concept Maps (LC-17654, docs/beta/maps.md).
 *
 * GET  /api/beta/maps -> { maps: SavedMapSummary[] }, the founder's saved maps, newest change first.
 * POST /api/beta/maps { map } -> 201 { map: SavedMap }: saves a map (a generated draft, an
 *      edited copy of a ready-made one, or a founder's own) after every passage is checked
 *      against the bundled KJV. 400 { error } names the first problem.
 */
export const dynamic = "force-dynamic";

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	return mapsJson({ maps: await listSavedMaps(gate.userId) });
}

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const body = await readJsonObject(req);
	if (!body) return mapsJson({ error: "Send the map as JSON: { map }." }, 400);
	const checked = await checkMapAgainstKjv(body.map);
	if (!checked.ok) return mapsJson({ error: checked.error }, 400);
	try {
		return mapsJson({ map: await createSavedMap(gate.userId, checked.value) }, 201);
	} catch (error) {
		if (error instanceof BetaStoreError) return mapsJson({ error: error.message }, 400);
		throw error;
	}
}
