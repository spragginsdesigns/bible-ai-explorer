import { requireBetaApi } from "@/lib/beta/access";
import { readBody, sermonsFailure, sermonsJson, sermonsServerError } from "@/lib/beta/sermons/http";
import { isSermonsError, saveSermonToProject } from "@/lib/beta/sermons/server";

export const dynamic = "force-dynamic";
// One store write per passage and question; a long sermon has a few dozen.
export const maxDuration = 60;

type Params = { params: Promise<{ sermonId: string }> };

/**
 * POST /api/beta/sermons/<id>/project (Sermon to Study, LC-17643): save the
 * sermon into a Study Project, `{ projectId }` for one of the founder's
 * projects or `{ create: true }` for a new one named after the sermon. The
 * transcript becomes a source and the passages and questions marked for
 * research are gathered, through Study Projects' own functions. No AI.
 */
export async function POST(req: Request, { params }: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const body = await readBody(req);
	if (!body) return sermonsJson({ error: "Choose a project, or start a new one." }, 400);
	try {
		const result = await saveSermonToProject(gate.userId, (await params).sermonId, { projectId: body.projectId, create: body.create });
		return isSermonsError(result) ? sermonsFailure(result) : sermonsJson(result, result.created ? 201 : 200);
	} catch (error) {
		return sermonsServerError("project", error, "The sermon could not be saved to the project right now.");
	}
}
