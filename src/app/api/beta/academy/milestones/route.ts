import { requireBetaApi } from "@/lib/beta/access";
import { syncMilestones } from "@/lib/beta/academy/academy";
import { academyJson, academyServerError, courseIdOf } from "@/lib/beta/academy/http";

export const dynamic = "force-dynamic";

/**
 * POST /api/beta/academy/milestones { courseId } (SureWord Academy, LC-17660):
 * record every milestone the founder has reached in the course and not yet
 * recorded, and the record of the course once it is complete. Answers
 * `{ added, recordId }`; calling it again records nothing twice.
 * Founders only; everyone else gets the ordinary 404.
 */
export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const body = (await req.json().catch(() => null)) as { courseId?: unknown } | null;
	const courseId = courseIdOf(body?.courseId);
	if (!courseId) return academyJson({ error: "Send { courseId }." }, 400);
	try {
		const result = await syncMilestones(gate.userId, courseId);
		if ("error" in result) return academyJson({ error: result.error }, result.status);
		return academyJson(result);
	} catch (error) {
		return academyServerError("milestones", error);
	}
}
