import { requireBetaApi } from "@/lib/beta/access";
import { loadStudyGraph } from "@/lib/beta/graph/graph";
import { graphFailure, graphJson } from "@/lib/beta/graph/http";

/**
 * GET /api/beta/graph: the founder's Living Study Graph (docs/beta/graph.md),
 * laid out: passages, topics, notes, chats, sermon studies and every beta
 * item, with wikilinks, links, suggestions and cross-references between them.
 * Founders only; everyone else 404s.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		return graphJson(await loadStudyGraph(gate.userId));
	} catch (error) {
		return graphFailure(error, "", "Your study graph could not be drawn just now. Please try again.");
	}
}
