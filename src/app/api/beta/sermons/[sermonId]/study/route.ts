import { requireBetaApi } from "@/lib/beta/access";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { sermonsFailure, sermonsJson, sermonsServerError } from "@/lib/beta/sermons/http";
import { generateStudy, isSermonsError } from "@/lib/beta/sermons/server";

export const dynamic = "force-dynamic";
// One structured call over the whole transcript.
export const maxDuration = 120;

type Params = { params: Promise<{ sermonId: string }> };

/**
 * POST /api/beta/sermons/<id>/study (Sermon to Study, LC-17643): write the
 * study notes, discussion questions and memory verses, only on this request.
 * Gated before the usage meter, so anyone off the list gets the ordinary 404.
 */
export async function POST(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const { sermonId } = await params;
	return study(req, gate.userId, sermonId);
}

const study = withIncludedAiRequest(async (_req: Request, userId: string, sermonId: string): Promise<Response> => {
	try {
		const result = await generateStudy(userId, sermonId);
		return isSermonsError(result) ? sermonsFailure(result) : sermonsJson(result, 201);
	} catch (error) {
		return sermonsServerError("study", error, "The study could not be written right now. Please try again.");
	}
}, "beta-sermons");
