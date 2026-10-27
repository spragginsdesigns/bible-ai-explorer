import { requireBetaApi } from "@/lib/beta/access";
import { suggestStudyConnections } from "@/lib/beta/graph/graph";
import { graphFailure, graphJson, readObject } from "@/lib/beta/graph/http";

/**
 * POST /api/beta/graph/suggest `{ itemId? }`: suggest connections between the
 * founder's studies (all of them, or one study and the rest), each kept as a
 * `BetaLink` with `origin: "suggested"` and its reason. Made only from the
 * founder's own passages, topics and the cross-references between them, only
 * when asked; no model call. Founders only; everyone else 404s.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const body = await readObject(req);
		const itemId = typeof body.itemId === "string" && body.itemId.trim() ? body.itemId.trim() : null;
		const suggestions = await suggestStudyConnections(gate.userId, itemId);
		return graphJson({ suggested: suggestions.length });
	} catch (error) {
		return graphFailure(error, "/suggest", "Connections could not be suggested just now. Please try again.");
	}
}
