import { requireBetaApi } from "@/lib/beta/access";
import { sermonsFailure, sermonsJson, sermonsServerError } from "@/lib/beta/sermons/http";
import { finishSermon, isSermonsError } from "@/lib/beta/sermons/server";

export const dynamic = "force-dynamic";
// Reads the whole bundled KJV once per server to match quotations.
export const maxDuration = 60;

type Params = { params: Promise<{ sermonId: string }> };

/** POST /api/beta/sermons/<id>/finish (Sermon to Study, LC-17643): find every passage the transcript names or quotes. No AI. */
export async function POST(_req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	try {
		const result = await finishSermon(gate.userId, (await params).sermonId);
		return isSermonsError(result) ? sermonsFailure(result) : sermonsJson(result);
	} catch (error) {
		return sermonsServerError("finish", error, "The passages could not be found right now.");
	}
}
