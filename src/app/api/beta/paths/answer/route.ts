import { z } from "zod";
import { requireBetaApi } from "@/lib/beta/access";
import { pathsFailure, pathsJson, pathsServerError, readBody } from "@/lib/beta/paths/http";
import { answerQuestion, isPathsError } from "@/lib/beta/paths/server";

export const dynamic = "force-dynamic";

const answerSchema = z.object({
	pathId: z.string().min(1).max(60),
	sessionId: z.string().min(1).max(60),
	exerciseId: z.string().min(1).max(80),
	response: z.unknown(),
});

/**
 * POST /api/beta/paths/answer (Learning Paths, LC-17648): grade the session's
 * current question on the server and record it (mastery, the review list, the
 * place to resume). Body `{ pathId, sessionId, exerciseId, response }`. A 409
 * means the session moved on in another tab; the page reloads it.
 */
export async function POST(req: Request) {
	const gate = await requireBetaApi();
	if (!gate.ok) return gate.response;
	const parsed = answerSchema.safeParse(await readBody(req));
	if (!parsed.success) return pathsJson({ error: "Send { pathId, sessionId, exerciseId, response }." }, 400);
	try {
		const { pathId, sessionId, exerciseId, response } = parsed.data;
		const result = await answerQuestion(gate.userId, pathId, sessionId, exerciseId, response);
		return isPathsError(result) ? pathsFailure(result) : pathsJson(result);
	} catch (error) {
		return pathsServerError("answer", error);
	}
}
