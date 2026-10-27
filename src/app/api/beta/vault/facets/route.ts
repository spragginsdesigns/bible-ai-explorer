import { requireBetaApi } from "@/lib/beta/access";
import { vaultFacets } from "@/lib/beta/vault/facets";
import { vaultFailure, vaultJson } from "@/lib/beta/vault/http";

/** GET /api/beta/vault/facets: how many of each kind, and the topic labels in use. */
export const dynamic = "force-dynamic";

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return vaultJson(await vaultFacets(gate.userId));
	} catch (error) {
		return vaultFailure(error, "/facets", "Your vault's filters could not be loaded.");
	}
}
