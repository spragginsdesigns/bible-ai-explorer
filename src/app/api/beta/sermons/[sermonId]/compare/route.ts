import { requireBetaApi } from "@/lib/beta/access";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { readBody, sermonsFailure, sermonsJson, sermonsServerError } from "@/lib/beta/sermons/http";
import { comparePassage, isSermonsError } from "@/lib/beta/sermons/server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Params = { params: Promise<{ sermonId: string }> };

/**
 * POST /api/beta/sermons/<id>/compare (Sermon to Study, LC-17643): compare how
 * the sermon used `{ key }` (one of its passages) with what the passage says
 * in its KJV context. One model call, only on this request.
 */
export async function POST(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const { sermonId } = await params;
	return compare(req, gate.userId, sermonId);
}

const compare = withIncludedAiRequest(async (req: Request, userId: string, sermonId: string): Promise<Response> => {
	const body = await readBody(req);
	const key = typeof body?.key === "string" ? body.key : "";
	if (!/^\d{1,2}\.\d{1,3}(\.\d{1,3})?$/.test(key)) return sermonsJson({ error: "Choose a passage from the sermon." }, 400);
	try {
		const result = await comparePassage(userId, sermonId, key);
		return isSermonsError(result) ? sermonsFailure(result) : sermonsJson(result, 201);
	} catch (error) {
		return sermonsServerError("compare", error, "That comparison could not be written right now. Please try again.");
	}
}, "beta-sermons");
