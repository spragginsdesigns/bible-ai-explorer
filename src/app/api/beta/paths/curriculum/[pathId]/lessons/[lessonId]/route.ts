import { requireBetaApi } from "@/lib/beta/access";
import { AiCredentialError } from "@/lib/ai/provider";
import { withIncludedAiRequest } from "@/lib/billing/usage";
import { CurriculumUnavailableError, writeCurriculumLesson } from "@/lib/beta/paths/curriculum";
import { pathsFailure, pathsJson, pathsServerError } from "@/lib/beta/paths/http";
import { isPathsError } from "@/lib/beta/paths/server";

export const dynamic = "force-dynamic";
// One structured lesson call, two at most when too few questions survive the KJV checks.
export const maxDuration = 120;

type Params = { params: Promise<{ pathId: string; lessonId: string }> };

/**
 * POST /api/beta/paths/curriculum/<pathId>/lessons/<lessonId> (Learning
 * Paths, LC-17648): write a personal curriculum lesson's teaching and
 * questions the first time it is opened. A lesson already written costs
 * nothing and answers `{ written: false }`.
 */
export async function POST(req: Request, context: Params) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const { pathId, lessonId } = await context.params;
	return write(req, gate.userId, pathId, lessonId);
}

const write = withIncludedAiRequest(async (_req: Request, userId: string, pathId: string, lessonId: string): Promise<Response> => {
	try {
		const result = await writeCurriculumLesson(userId, pathId, lessonId);
		return isPathsError(result) ? pathsFailure(result) : pathsJson(result);
	} catch (error) {
		if (error instanceof AiCredentialError) return pathsJson({ error: error.message }, 403);
		if (error instanceof CurriculumUnavailableError) {
			console.error("[api/beta/paths/curriculum lesson]", error.message);
			return pathsJson({ error: "This lesson could not be written right now. Please try again." }, 502);
		}
		return pathsServerError("curriculum lesson", error);
	}
}, "beta-paths");
