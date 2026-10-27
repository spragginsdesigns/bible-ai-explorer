import { requireBetaApi } from "@/lib/beta/access";
import { BetaStoreError } from "@/lib/beta/store";
import { mapsJson, readJsonObject } from "@/lib/beta/maps/http";
import { checkMapAgainstKjv } from "@/lib/beta/maps/passages";
import { deleteSavedMap, getSavedMap, updateSavedMap } from "@/lib/beta/maps/store";

/**
 * One saved Concept Map (LC-17654). Every call is scoped to the founder: an
 * id that is someone else's, or another module's item, is a 404 exactly like
 * one that does not exist.
 *
 * GET    -> { map: SavedMap }
 * PATCH  { map } -> { map: SavedMap }, checked against the bundled KJV like a new one
 * DELETE -> { deleted: true }
 */
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const notFound = () => mapsJson({ error: "Not found" }, 404);

export async function GET(_req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const { id } = await params;
	const saved = await getSavedMap(gate.userId, id);
	return saved ? mapsJson({ map: saved }) : notFound();
}

export async function PATCH(req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const { id } = await params;
	const body = await readJsonObject(req);
	if (!body) return mapsJson({ error: "Send the map as JSON: { map }." }, 400);
	const checked = await checkMapAgainstKjv(body.map);
	if (!checked.ok) return mapsJson({ error: checked.error }, 400);
	try {
		const saved = await updateSavedMap(gate.userId, id, checked.value);
		return saved ? mapsJson({ map: saved }) : notFound();
	} catch (error) {
		if (error instanceof BetaStoreError) return mapsJson({ error: error.message }, 400);
		throw error;
	}
}

export async function DELETE(_req: Request, { params }: Context) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const { id } = await params;
	return (await deleteSavedMap(gate.userId, id)) ? mapsJson({ deleted: true }) : notFound();
}
